/* Account-scoped workspace and attachment synchronization. */
(function(scope){
 'use strict';
 class LogEnCloudWorkspace {
  constructor(store,{storage=globalThis.localStorage,onStatus=()=>{}}={}){
   if(!store.userId)throw Error('Sign in before opening a workspace.');
   this.store=store;this.userId=store.userId;this.storage=storage;this.onStatus=onStatus;
   this.key='logen.cloud.workspace.v1.'+this.userId;this.revision=0;this.pending=null;this.running=null;this.error=null;this.drawings=new Map();this.locks=new Map();
  }
  check(){if(this.store.userId!==this.userId)throw Error('Account changed. Sign in again.');}
  async open(){
   this.check();const record=await this.store.getRecord('workspace');this.check();
   this.revision=record?.revision||0;
   for(const row of await this.store.listRecordVersions()){if(row.record_key.startsWith('drawing:'))this.drawings.set(row.record_key.slice(8),row.revision);}this.check();
   const local=this.storage.getItem(this.key+'.pending');
   if(local){this.error=Error('Unsynced work exists on this device. Download the recovery copy before replacing it.');throw this.error;}
   if(record){if(typeof record.payload?.serialized!=='string')throw Error('Invalid cloud workspace.');this.storage.setItem(this.key,record.payload.serialized);}
   else this.storage.removeItem(this.key);
   return this.key;
  }
  save(serialized){
   this.check();this.storage.setItem(this.key+'.pending',serialized);this.pending=serialized;
   if(this.error){this.onStatus('Cloud save stopped. Download a backup and reload.',true);return;}
   this.onStatus('Saving to your account…');
   if(!this.running)this.running=this.drain().finally(()=>{this.running=null;});
  }
  async drain(){
   try{
    while(this.pending!==null){this.check();const serialized=this.pending;this.pending=null;
     const record=await this.store.saveRecord('workspace',{serialized},this.revision);this.check();this.revision=record.revision;
     if(this.pending===null&&this.storage.getItem(this.key+'.pending')===serialized)this.storage.removeItem(this.key+'.pending');
    }
    this.onStatus('Saved to your account');
   }catch(e){this.error=e;this.onStatus(e.message,true);}
  }
  async flush(){if(this.running)await this.running;if(this.error)throw this.error;}
  async pack(value){
   const jobs=[],blobs=new WeakMap(),ancestors=new WeakSet();
   const encode=v=>{
    if(v instanceof Blob){if(blobs.has(v))return blobs.get(v);const node={type:'blob',key:null,mime:v.type,name:v.name||null,lastModified:v.lastModified||0};blobs.set(v,node);jobs.push({blob:v,node});return node;}
    if(v===undefined)return {type:'undefined'};
    if(typeof v==='number'&&!Number.isFinite(v))return {type:'number',value:String(v)};
    if(v instanceof Date)return {type:'date',value:v.toISOString()};
    if(ArrayBuffer.isView(v)||v instanceof ArrayBuffer){const bytes=v instanceof ArrayBuffer?v:v.buffer.slice(v.byteOffset,v.byteOffset+v.byteLength);return {type:'binary',kind:v instanceof ArrayBuffer?'ArrayBuffer':v.constructor.name,blob:encode(new Blob([bytes]))};}
    if(v&&typeof v==='object'){if(ancestors.has(v))throw Error('Drawing snapshot contains a circular reference.');ancestors.add(v);try{return Array.isArray(v)?{type:'array',value:v.map(encode)}:{type:'object',value:Object.entries(v).map(([k,item])=>[k,encode(item)])};}finally{ancestors.delete(v);}}
    return {type:'value',value:v};
   };
   // Traverse ordinary geometry synchronously. Do not create a Promise for
   // every coordinate; upload the much smaller set of actual files in order.
   const result=encode(value);
   for(const {blob,node}of jobs){this.check();const digest=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());node.key='blob:'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');await this.store.putFile(node.key,blob);this.check();}
   return result;
  }
  async unpack(node){
   if(node?.type==='snapshot'){
    if(node.version!==1||!['gzip','json'].includes(node.encoding))throw Error('Unsupported drawing snapshot format.');
    const blob=await this.unpack(node.blob);let json;
    if(node.encoding==='gzip'){if(typeof DecompressionStream!=='function')throw Error('Update your browser to open this compressed drawing.');json=await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text();}else json=await blob.text();
    return this.unpack(JSON.parse(json));
   }
   const jobs=new Map();
   const collect=(n,binary=false)=>{if(!n||typeof n.type!=='string')throw Error('Invalid drawing snapshot.');if(n.type==='blob'){const job=jobs.get(n.key)||{node:n,binary:false};job.binary||=binary;jobs.set(n.key,job);}else if(n.type==='binary')collect(n.blob,true);else if(n.type==='array')n.value.forEach(v=>collect(v));else if(n.type==='object')n.value.forEach(([,v])=>collect(v));};collect(node);
   for(const [key,job]of jobs){this.check();job.blob=await this.store.getFile(key);this.check();if(!job.blob)throw Error('A private drawing attachment is missing.');if(job.binary)job.bytes=await job.blob.arrayBuffer();}
   const decode=n=>{switch(n.type){
    case 'blob':{const blob=jobs.get(n.key).blob;return n.name?new File([blob],n.name,{type:n.mime,lastModified:n.lastModified}):new Blob([blob],{type:n.mime});}
    case 'binary':{const bytes=jobs.get(n.blob.key).bytes.slice(0);if(n.kind==='ArrayBuffer')return bytes;const constructors={Uint8Array,Uint8ClampedArray,Int8Array,Uint16Array,Int16Array,Uint32Array,Int32Array,Float32Array,Float64Array,DataView};if(!constructors[n.kind])throw Error('Unsupported binary format.');return new constructors[n.kind](bytes);}
    case 'undefined':return undefined;
    case 'number':return Number(n.value);
    case 'date':return new Date(n.value);
    case 'array':return n.value.map(decode);
    case 'object':return Object.fromEntries(n.value.map(([k,v])=>[k,decode(v)]));
    case 'value':return n.value;
    default:throw Error('Unsupported drawing snapshot.');
   }};return decode(node);
  }
  async drawingPayload(value){
   const inline=await this.pack(value),json=new Blob([JSON.stringify(inline)],{type:'application/json'});
   if(json.size<=128*1024)return inline;
   let blob=json,encoding='json';if(typeof CompressionStream==='function'){blob=await new Response(json.stream().pipeThrough(new CompressionStream('gzip'))).blob();encoding='gzip';}
   return {type:'snapshot',version:1,encoding,blob:await this.pack(blob)};
  }
  async getDrawing(key){this.check();const r=await this.store.getRecord('drawing:'+key);this.check();this.drawings.set(key,r?.revision||0);return r?this.unpack(r.payload):undefined;}
  async putDrawing(value,key){
   const previous=this.locks.get(key)||Promise.resolve();
   const task=previous.then(async()=>{this.check();if(!this.drawings.has(key)){const r=await this.store.getRecord('drawing:'+key);if(r)throw Error('This drawing already exists in your account. Reload it before replacing it.');this.drawings.set(key,0);}
    const payload=await this.drawingPayload(value);this.check();const r=await this.store.saveRecord('drawing:'+key,payload,this.drawings.get(key));this.check();this.drawings.set(key,r.revision);return key;});
   this.locks.set(key,task.catch(()=>{}));return task;
  }
  async drawingStore(mode,action){
   let operation;
   const task=action({get:key=>(operation=this.getDrawing(key),{}),put:(value,key)=>{if(mode!=='readwrite')throw Error('Read-only drawing transaction.');operation=this.putDrawing(value,key);return {};}});
   if(!task||!operation)throw Error('Unsupported drawing operation.');return operation;
  }
 }
 scope.LogEnCloudWorkspace=LogEnCloudWorkspace;if(typeof module!=='undefined')module.exports=LogEnCloudWorkspace;
})(globalThis);
