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
   if(value instanceof Blob){const bytes=await value.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes),key='blob:'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');await this.store.putFile(key,value);return {type:'blob',key,mime:value.type,name:value.name||null,lastModified:value.lastModified||0};}
   if(value===undefined)return {type:'undefined'};
   if(typeof value==='number'&&!Number.isFinite(value))return {type:'number',value:String(value)};
   if(value instanceof Date)return {type:'date',value:value.toISOString()};
   if(ArrayBuffer.isView(value)||value instanceof ArrayBuffer){const bytes=value instanceof ArrayBuffer?value:value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength);return {type:'binary',kind:value instanceof ArrayBuffer?'ArrayBuffer':value.constructor.name,blob:await this.pack(new Blob([bytes]))};}
   if(Array.isArray(value))return {type:'array',value:await Promise.all(value.map(v=>this.pack(v)))};
   if(value&&typeof value==='object')return {type:'object',value:await Promise.all(Object.entries(value).map(async([k,v])=>[k,await this.pack(v)]))};
   return {type:'value',value};
  }
  async unpack(node){
   if(!node||typeof node.type!=='string')throw Error('Invalid drawing snapshot.');
   switch(node.type){
    case 'blob':{const blob=await this.store.getFile(node.key);if(!blob)throw Error('A private drawing attachment is missing.');return node.name?new File([blob],node.name,{type:node.mime,lastModified:node.lastModified}):new Blob([blob],{type:node.mime});}
    case 'binary':{const bytes=await (await this.unpack(node.blob)).arrayBuffer();if(node.kind==='ArrayBuffer')return bytes;const constructors={Uint8Array,Uint8ClampedArray,Int8Array,Uint16Array,Int16Array,Uint32Array,Int32Array,Float32Array,Float64Array,DataView};if(!constructors[node.kind])throw Error('Unsupported binary format.');return new constructors[node.kind](bytes);}
    case 'undefined':return undefined;
    case 'number':return Number(node.value);
    case 'date':return new Date(node.value);
    case 'array':return Promise.all(node.value.map(v=>this.unpack(v)));
    case 'object':return Object.fromEntries(await Promise.all(node.value.map(async([k,v])=>[k,await this.unpack(v)])));
    case 'value':return node.value;
    default:throw Error('Unsupported drawing snapshot.');
   }
  }
  async getDrawing(key){this.check();const r=await this.store.getRecord('drawing:'+key);this.check();this.drawings.set(key,r?.revision||0);return r?this.unpack(r.payload):undefined;}
  async putDrawing(value,key){
   const previous=this.locks.get(key)||Promise.resolve();
   const task=previous.then(async()=>{this.check();if(!this.drawings.has(key)){const r=await this.store.getRecord('drawing:'+key);if(r)throw Error('This drawing already exists in your account. Reload it before replacing it.');this.drawings.set(key,0);}
    const payload=await this.pack(value);this.check();const r=await this.store.saveRecord('drawing:'+key,payload,this.drawings.get(key));this.check();this.drawings.set(key,r.revision);return key;});
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
