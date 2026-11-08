/* Local access gate for the offline/static application; not server authentication. */
(() => {
  'use strict';
  let unlock;
  globalThis.LogEnAccess=Object.freeze({ready:new Promise(resolve=>{unlock=resolve;})});
  const form=document.getElementById('login-form'),button=form.querySelector('button[type="submit"]'),error=document.getElementById('login-error'),hint=document.getElementById('password-hint'),hintButton=document.getElementById('password-hint-button');
  const salt='32e187cd607a31e108342786cdfb52cf',expected='3d0cbaba1ab89153da65b20daadf45ff005879c50afb40b78649284340ce08ab';
  hintButton.addEventListener('click',()=>{const open=hintButton.getAttribute('aria-expanded')!=='true';hintButton.setAttribute('aria-expanded',String(open));hint.hidden=!open;});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(button.disabled)return;button.disabled=true;button.textContent='Signing in…';error.textContent='';
    try{
      if(!globalThis.crypto?.subtle)throw new Error('Please open LogEn using its HTTPS website or a browser that supports secure local files.');
      const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(form.elements.password.value),{name:'PBKDF2'},false,['deriveBits']);
      const bytes=Uint8Array.from(salt.match(/../g),v=>parseInt(v,16)),bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:bytes,iterations:210000,hash:'SHA-256'},key,256),actual=Array.from(new Uint8Array(bits),b=>b.toString(16).padStart(2,'0')).join('');
      let different=0;for(let i=0;i<expected.length;i++)different|=actual.charCodeAt(i)^expected.charCodeAt(i);
      if(form.elements.username.value.trim()!=='DusanJankovic'||different){error.textContent='Incorrect username or password.';form.elements.password.value='';form.elements.password.focus();return;}
      form.elements.password.value='';document.body.removeAttribute('data-locked');document.getElementById('login-screen').remove();unlock();
      requestAnimationFrame(()=>document.getElementById('main').focus());
    }catch(e){error.textContent=e.message||'Unable to sign in. Please try again.';}
    finally{button.disabled=false;button.textContent='Log in';}
  });
  document.getElementById('logout-button').addEventListener('click',()=>location.reload());
})();
