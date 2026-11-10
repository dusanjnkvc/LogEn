/* Real authentication for the online build. The offline gate is not bundled here. */
(()=>{
 'use strict';
 let unlock;
 globalThis.LogEnAccess=Object.freeze({ready:new Promise(resolve=>{unlock=resolve;})});
 const store=new LogEnCloudStore({url:'https://butukbeoxxgyoaluctdi.supabase.co',publishableKey:'sb_publishable_AZkbG4MT5-T_lEiSSPCv-A_b3aheVvl'});
 const form=document.getElementById('login-form'),button=form.querySelector('[type=submit]'),error=document.getElementById('login-error');
 form.elements.username.type='email';form.elements.username.previousElementSibling.textContent='Email';form.elements.username.autocomplete='username';
 document.querySelector('#login-screen .muted').textContent='Sign in to your private account. Your projects and drawings follow you across devices.';
 document.getElementById('password-hint-button').remove();document.getElementById('password-hint').remove();
 document.querySelector('.offline-badge').textContent='Private cloud account';
 const recovery=document.createElement('button');recovery.type='button';recovery.className='btn btn-secondary';recovery.textContent='Download unsynced recovery copy';recovery.hidden=true;recovery.style.display='none';form.append(recovery);
 let workspace;
 recovery.onclick=()=>{if(!workspace)return;const raw=localStorage.getItem(workspace.key+'.pending');if(!raw)return;const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([raw],{type:'application/json'}));a.download='LogEn_Unsynced_Recovery.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);if(confirm('After saving the recovery download, continue with the latest cloud projects? A second recovery copy will stay on this device.')){localStorage.setItem(workspace.key+'.recovery.'+Date.now(),raw);localStorage.removeItem(workspace.key+'.pending');error.textContent='Recovery copy retained. Enter your password to reopen the cloud projects.';recovery.hidden=true;recovery.style.display='none';}};
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(button.disabled)return;button.disabled=true;error.textContent='';button.textContent='Signing in…';
  try{
   await store.signIn(form.elements.username.value.trim(),form.elements.password.value);form.elements.password.value='';
   workspace=new LogEnCloudWorkspace(store,{onStatus:(message,failed)=>{const status=document.getElementById('save-status');status.textContent=message;status.title=failed?'Your unsynced work is retained on this device. Download a workspace backup before reloading.':'';}});
   await workspace.open();globalThis.LogEnCloud=workspace;
   document.body.removeAttribute('data-locked');document.getElementById('login-screen').remove();unlock();
   requestAnimationFrame(()=>document.getElementById('main').focus());
   if(store.userId==='6a615985-a901-45af-b473-d5ebd501c056'&&localStorage.getItem('logen.offline.workspace.v1')){
    const importButton=document.createElement('button');importButton.className='btn btn-secondary';importButton.textContent='Import projects from this device';importButton.style.maxWidth='100%';importButton.style.whiteSpace='normal';const actions=document.querySelector('.topbar-right');actions.style.maxWidth='100%';actions.style.flexWrap='wrap';actions.prepend(importButton);
    importButton.onclick=async()=>{
     importButton.disabled=true;
     try{
      await workspace.flush();const raw=localStorage.getItem('logen.offline.workspace.v1'),legacy=JSON.parse(raw);
      if(!Array.isArray(legacy.projects)||!legacy.projects.length)throw Error('No valid local workspace was found.');
      const current=await store.getRecord('workspace'),currentProjects=JSON.parse(current?.payload?.serialized||'{}').projects||[];
      if(currentProjects.some(p=>p.id!=='example-warehouse'))throw Error('Your account already has projects. Export both workspaces before merging; no data was replaced.');
      const ids=[...legacy.projects,...(legacy.deletedProjects||[])].map(p=>p.id);
      const entries=await new Promise((resolve,reject)=>{const r=indexedDB.open('logen.project.drawings',1);r.onupgradeneeded=()=>r.result.createObjectStore('drawings');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('drawings','readonly'),os=tx.objectStore('drawings'),keys=os.getAllKeys(),values=os.getAll();tx.oncomplete=()=>{const all=keys.result.map((key,i)=>[key,values.result[i]]).filter(([k])=>typeof k==='string'&&ids.some(id=>k===id||k.startsWith(id+':')));db.close();resolve(all);};tx.onerror=()=>{db.close();reject(tx.error);};};});
      const files=[],backupCodec=new LogEnCloudWorkspace({userId:store.userId,putFile:async(key,blob)=>files.push({name:key.replace(':','_'),data:blob})},{storage:localStorage});
      const manifest=await backupCodec.pack(entries),zip=await LogEnOutputZIP.pack([{name:'workspace.json',data:new Blob([raw])},{name:'drawings.json',data:new Blob([JSON.stringify(manifest)])},...files]);
      const a=document.createElement('a');a.href=URL.createObjectURL(zip);a.download='LogEn_Before_Cloud_Import.zip';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),30000);
      if(!confirm('A complete backup ZIP has been downloaded. Check that it is saved before continuing. Import '+legacy.projects.length+' projects and '+entries.length+' drawing records into your private account?'))return;
      for(const [key,value] of entries){await workspace.getDrawing(key);await workspace.putDrawing(value,key);}
      workspace.save(raw);await workspace.flush();localStorage.setItem(workspace.key,raw);location.reload();
     }catch(e){alert('Import stopped. Your original device data is unchanged. '+e.message);}
     finally{importButton.disabled=false;}
    };
   }
  }catch(e){error.textContent=e.message;form.elements.password.value='';recovery.hidden=!workspace?.error;recovery.style.display=recovery.hidden?'none':'';}
  finally{button.disabled=false;button.textContent='Log in';}
 });
 document.getElementById('logout-button').addEventListener('click',async()=>{
  try{await workspace?.flush();}catch(e){if(!confirm(e.message+' Unsynced work will remain on this device. Log out now?'))return;}try{await store.signOut();}finally{location.reload();}
 });
 window.addEventListener('beforeunload',event=>{if(workspace&&(workspace.running||workspace.error)){event.preventDefault();event.returnValue='';}});
})();
