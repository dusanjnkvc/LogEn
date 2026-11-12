/* Cloud adapter preparation. Not loaded by the live/offline app until deployment. */
(function(scope){
 'use strict';
 class LogEnCloudStore {
  #session=null; #epoch=0; #refresh=null; #fetch; #url; #key; #timeout; #fileTimeout;
  constructor({url,publishableKey,fetchImpl=globalThis.fetch.bind(globalThis),requestTimeoutMs=30000,fileTimeoutMs=120000}){
   const base=new URL(url);if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||base.pathname!=='/')throw Error('Use the HTTPS Supabase project origin.');
   if(!publishableKey||publishableKey.startsWith('sb_secret_'))throw Error('Only a public publishable key belongs in the browser.');
   if(publishableKey.split('.').length===3){let role;try{role=JSON.parse(atob(publishableKey.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role;}catch{throw Error('Invalid public API key.');}if(role!=='anon')throw Error('Privileged API keys must never be used in the browser.');}
   if(!Number.isFinite(requestTimeoutMs)||requestTimeoutMs<=0||!Number.isFinite(fileTimeoutMs)||fileTimeoutMs<=0)throw Error('Use positive cloud request timeouts.');
   this.#url=base.origin;this.#key=publishableKey;this.#fetch=fetchImpl;this.#timeout=requestTimeoutMs;this.#fileTimeout=fileTimeoutMs;
  }
  async #fetchWithTimeout(url,options={},timeout=this.#timeout){
   const controller=new AbortController();let timer;
   try{return await Promise.race([this.#fetch(url,{...options,signal:controller.signal}),new Promise((_,reject)=>{timer=setTimeout(()=>{const e=Error('LogEn’s account service took too long to respond. Try again shortly. Keep this browser’s data to retain any unsynced work.');e.code='CLOUD_TIMEOUT';reject(e);controller.abort();},timeout);})]);}
   catch(cause){if(cause?.code==='CLOUD_TIMEOUT')throw cause;const e=Error('Cannot reach LogEn’s account service. Check your connection and try again. Keep this browser’s data to retain any unsynced work.');e.code='CLOUD_NETWORK';e.cause=cause;throw e;}
   finally{clearTimeout(timer);}
  }
  get userId(){return this.#session?.user?.id||null;}
  async #decode(response){const body=await response.json().catch(()=>null);if(!response.ok){if(response.status>=500){const e=Error('LogEn’s account service is temporarily unavailable (HTTP '+response.status+'). Try again shortly. Keep this browser’s data to retain any unsynced work.');e.status=response.status;e.code='CLOUD_UNAVAILABLE';throw e;}if(response.status===413)throw Error('This drawing exceeds the cloud storage upload limit. Keep the original file and use a smaller drawing.');const e=new Error(['40001','PT409'].includes(body?.code)?'Project changed on another device. Reload before saving.':response.status===401||response.status===403?'Sign in again to access your projects.':'Cloud request failed. Your local work is retained.');e.status=response.status;e.code=body?.code;throw e;}return body;}
  async signIn(email,password){
   const epoch=++this.#epoch;this.#session=null;this.#refresh=null;
   const response=await this.#fetchWithTimeout(this.#url+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:this.#key,'Content-Type':'application/json'},body:JSON.stringify({email,password}),cache:'no-store'});
   const value=await this.#decode(response);if(epoch!==this.#epoch)throw Error('Account changed during sign-in.');
   this.#accept(value);return this.userId;
  }
  #accept(value){if(!value?.access_token||!value.refresh_token||!value.user?.id||!Number.isFinite(value.expires_in))throw Error('Invalid authentication response.');this.#session={...value,expiresAt:Date.now()+value.expires_in*1000};}
  async #token(){
   if(!this.#session)throw Error('Sign in first.');if(this.#session.expiresAt>Date.now()+30000)return this.#session.access_token;
   if(!this.#refresh){const epoch=this.#epoch,refresh_token=this.#session.refresh_token;this.#refresh=(async()=>{try{const r=await this.#fetchWithTimeout(this.#url+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:this.#key,'Content-Type':'application/json'},body:JSON.stringify({refresh_token}),cache:'no-store'}),v=await this.#decode(r);if(epoch!==this.#epoch)throw Error('Account changed during refresh.');this.#accept(v);}catch(e){if(epoch===this.#epoch){this.#session=null;++this.#epoch;}throw e;}finally{if(epoch===this.#epoch)this.#refresh=null;}})();}
   await this.#refresh;if(!this.#session)throw Error('Sign in first.');return this.#session.access_token;
  }
  async #request(path,options={}){
   const epoch=this.#epoch,token=await this.#token();if(epoch!==this.#epoch)throw Error('Account changed.');
   const response=await this.#fetchWithTimeout(this.#url+path,{...options,headers:{...options.headers,apikey:this.#key,Authorization:'Bearer '+token},cache:'no-store'},path.startsWith('/storage/')?this.#fileTimeout:this.#timeout);
   if(epoch!==this.#epoch)throw Error('Account changed.');return {response,epoch};
  }
  async getRecord(key){const {response,epoch}=await this.#request('/rest/v1/logen_records?record_key=eq.'+encodeURIComponent(key)+'&select=record_key,payload,revision');const rows=await this.#decode(response);if(epoch!==this.#epoch)throw Error('Account changed.');if(!Array.isArray(rows)||rows.length>1)throw Error('Invalid record response.');return rows[0]||null;}
  async listRecordVersions(){const records=[];for(let offset=0;;offset+=1000){const {response,epoch}=await this.#request('/rest/v1/logen_records?select=record_key,revision&record_key=like.drawing%3A*&order=record_key&limit=1000&offset='+offset);const rows=await this.#decode(response);if(epoch!==this.#epoch)throw Error('Account changed.');if(!Array.isArray(rows))throw Error('Invalid drawing index.');records.push(...rows);if(rows.length<1000)return records;}}
  async saveRecord(key,payload,revision){if(!Number.isSafeInteger(revision)||revision<0)throw Error('A valid expected revision is required.');const {response,epoch}=await this.#request('/rest/v1/rpc/save_logen_record',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({p_key:key,p_payload:payload,p_revision:revision})});const rows=await this.#decode(response);if(epoch!==this.#epoch)throw Error('Account changed.');if(!Array.isArray(rows)||rows.length!==1)throw Error('Invalid save response.');return rows[0];}
  async #filePath(key){if(!this.userId)throw Error('Sign in first.');const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));return this.userId+'/'+Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');}
  async getFile(key){const epoch=this.#epoch,path=await this.#filePath(key);if(epoch!==this.#epoch)throw Error('Account changed.');const {response}=await this.#request('/storage/v1/object/authenticated/logen-private/'+path);if(response.status===404)return null;if(!response.ok)await this.#decode(response);const value=await response.blob();if(epoch!==this.#epoch)throw Error('Account changed.');return value;}
  async putFile(key,blob){const epoch=this.#epoch,path=await this.#filePath(key);if(epoch!==this.#epoch)throw Error('Account changed.');const {response}=await this.#request('/storage/v1/object/logen-private/'+path,{method:'POST',headers:{'Content-Type':blob.type||'application/octet-stream','x-upsert':'true'},body:blob});await this.#decode(response);if(epoch!==this.#epoch)throw Error('Account changed.');return path;}
  async signOut(){const token=this.#session?.access_token;this.#session=null;this.#refresh=null;++this.#epoch;if(token){const r=await this.#fetchWithTimeout(this.#url+'/auth/v1/logout',{method:'POST',headers:{apikey:this.#key,Authorization:'Bearer '+token},cache:'no-store'});if(!r.ok)throw Error('Signed out locally. The server could not be reached to revoke the session.');}}
 }
 scope.LogEnCloudStore=LogEnCloudStore;if(typeof module!=='undefined')module.exports=LogEnCloudStore;
})(globalThis);
