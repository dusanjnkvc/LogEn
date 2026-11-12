/* Portable project archives: JSON + binary IndexedDB records. No account or CAD service. */
(function(scope){
 'use strict';
 const encoder=new TextEncoder(),decoder=new TextDecoder(),limit=1024*1024*1024;
 const json=v=>encoder.encode(JSON.stringify(v,(_,x)=>typeof x==='number'&&!Number.isFinite(x)?{$number:String(x)}:x));
 const parse=b=>JSON.parse(decoder.decode(b),(_,x)=>x&&Object.keys(x).length===1&&'$number'in x?Number(x.$number):x);
 const belongs=(key,ids)=>typeof key==='string'&&ids.some(id=>key===id||key.startsWith(id+':'));
 async function create(workspace,records,extra=[]){
  const files=[],ids=[...workspace.projects,...(workspace.deletedProjects||[])].map(p=>p.id);let seq=0;
  async function encode(value){
   if(value instanceof Blob||value instanceof ArrayBuffer||ArrayBuffer.isView(value)){const name='attachments/'+(++seq)+'.bin',data=value instanceof Blob?value:value instanceof ArrayBuffer?new Uint8Array(value):new Uint8Array(value.buffer,value.byteOffset,value.byteLength);files.push({name,data});return {$binary:name,kind:value instanceof File?'File':value instanceof Blob?'Blob':value instanceof ArrayBuffer?'ArrayBuffer':'TypedArray',type:value.type||'',name:value.name,lastModified:value.lastModified,arrayType:value.constructor.name};}
   if(value instanceof Map)return {$map:await Promise.all([...value].map(async([k,v])=>[await encode(k),await encode(v)]))};
   if(value instanceof Set)return {$set:await Promise.all([...value].map(encode))};
   if(value instanceof Date)return {$date:value.toISOString()};
   if(Array.isArray(value))return Promise.all(value.map(encode));
   if(value&&typeof value==='object'){const out={};for(const [k,v]of Object.entries(value))Object.defineProperty(out,k,{value:await encode(v),enumerable:true,writable:true,configurable:true});return out;}return value;
  }
  const saved=[];for(const record of records)if(belongs(record.key,ids))saved.push({key:record.key,value:await encode(record.value)});
  files.push({name:'workspace.json',data:json(workspace)},{name:'records.json',data:json(saved)},...extra);
  const byteSize=files.reduce((n,f)=>n+(f.data instanceof Blob?f.data.size:f.data.byteLength),0);if(byteSize>limit-1024*1024)throw Error('Complete backup exceeds the 1 GB restore limit. Download project files separately before reducing stored exports.');
  const manifest={format:'LogEn complete backup',version:1,createdAt:new Date().toISOString(),projects:ids.length,records:saved.length,files:[]};
  for(const file of files){const bytes=file.data instanceof Blob?await file.data.arrayBuffer():file.data;const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');manifest.files.push({name:file.name,size:bytes.byteLength,sha256:hash});}
  files.push({name:'manifest.json',data:json(manifest)},{name:'RESTORE.txt',data:encoder.encode('In LogEn open Projects > Restore complete backup and choose this ZIP. Projects are added as new copies, preserving existing projects. This archive includes saved drawings, geometry, editable layouts, cached native exports and generated Excel reports when available. Native DWG/PDF exports are included only if previously generated and saved; their absence does not prevent restoration. Keep this ZIP private: it contains your inventory and warehouse drawings.')});return scope.LogEnOutputZIP.pack(files);
 }
 async function read(file){
  if(file.size>limit)throw Error('Backup exceeds the 1 GB restore limit.');const bytes=new Uint8Array(await file.arrayBuffer()),view=new DataView(bytes.buffer),files=new Map();let offset=0,total=0;
  while(offset+4<=bytes.length&&view.getUint32(offset,true)===0x04034b50){if(offset+30>bytes.length)throw Error('Truncated backup.');const flags=view.getUint16(offset+6,true),method=view.getUint16(offset+8,true),size=view.getUint32(offset+18,true),plain=view.getUint32(offset+22,true),n=view.getUint16(offset+26,true),x=view.getUint16(offset+28,true),start=offset+30+n+x,end=start+size,name=decoder.decode(bytes.subarray(offset+30,offset+30+n));if(method!==0||flags&9||size!==plain||end>bytes.length||total+size>limit||files.has(name)||name.includes('..')||name.startsWith('/'))throw Error('Unsupported or damaged LogEn backup. Use the original complete backup ZIP.');files.set(name,bytes.subarray(start,end));total+=size;offset=end;}
  const required=name=>{if(!files.has(name))throw Error('Missing backup file: '+name);return files.get(name);};
  const manifest=parse(required('manifest.json'));if(manifest.format!=='LogEn complete backup'||manifest.version!==1||!Array.isArray(manifest.files))throw Error('Not a supported complete LogEn backup.');
  const checked=new Set();for(const f of manifest.files){if(checked.has(f.name))throw Error('Duplicate manifest entry.');checked.add(f.name);const bytes=required(f.name),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(bytes.length!==f.size||hash!==f.sha256)throw Error('Backup integrity check failed: '+f.name);}
  if(!checked.has('workspace.json')||!checked.has('records.json'))throw Error('Incomplete backup manifest.');
  function decode(value){if(!value||typeof value!=='object')return value;if(value.$binary){if(!checked.has(value.$binary))throw Error('Unverified backup attachment.');const bytes=required(value.$binary),copy=bytes.slice();if(value.kind==='File')return new File([copy],value.name,{type:value.type,lastModified:value.lastModified});if(value.kind==='Blob')return new Blob([copy],{type:value.type});if(value.kind==='ArrayBuffer')return copy.buffer;const types={Uint8Array,Int8Array,Uint16Array,Int16Array,Uint32Array,Int32Array,Float32Array,Float64Array,Uint8ClampedArray,DataView};const Type=types[value.arrayType];if(!Type)throw Error('Unsupported attachment array.');return new Type(copy.buffer);}if(value.$map)return new Map(value.$map.map(([k,v])=>[decode(k),decode(v)]));if(value.$set)return new Set(value.$set.map(decode));if(value.$date)return new Date(value.$date);if(Array.isArray(value))return value.map(decode);const out={};for(const [k,v]of Object.entries(value))Object.defineProperty(out,k,{value:decode(v),enumerable:true,writable:true,configurable:true});return out;}
  const workspace=parse(required('workspace.json')),raw=parse(required('records.json'));if(!Array.isArray(workspace.projects)||!Array.isArray(raw))throw Error('Invalid backup structure.');const ids=[...workspace.projects,...(workspace.deletedProjects||[])].map(p=>p.id),keys=new Set();const records=raw.map(r=>{if(!belongs(r.key,ids)||keys.has(r.key))throw Error('Invalid or duplicate drawing record.');keys.add(r.key);return {key:r.key,value:decode(r.value)};});return {workspace,records,manifest};
 }
 scope.LogEnProjectBackup=Object.freeze({create,read,belongs});
})(globalThis);
