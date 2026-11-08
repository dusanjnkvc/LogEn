/* Build the online account edition from the verified self-contained offline bundle. */
const fs=require('node:fs'),path=require('node:path');const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const offline=read('LogEn.html'),match=offline.match(/<script>([\s\S]*?)<\/script>/);if(!match)throw Error('Missing offline scripts');
let scripts=match[1];const login=read('webapp/login.js');if(!scripts.includes(login))throw Error('Offline login source differs; rebuild the offline bundle first.');
scripts=scripts.replace(login,['webapp/cloud-store.js','webapp/cloud-workspace.js','webapp/cloud-login.js'].map(read).join('\n;\n'));
if(!scripts.includes(read('webapp/app.js')))throw Error('Controller differs; rebuild offline bundle first.');
let html=offline.replace(match[1],()=>scripts.replace(/<\/script/gi,'<\\/script'));
html=html.replace('Offline by design','Private account').replace('Your data stays on this device.','Your projects are private to your account.');
html=html.replace('connect-src http://127.0.0.1:8765;', 'connect-src http://127.0.0.1:8765 https://butukbeoxxgyoaluctdi.supabase.co;');
if(html.includes('3d0cbaba1ab89153da65b20daadf45ff005879c50afb40b78649284340ce08ab'))throw Error('Local verifier leaked into online build');
fs.writeFileSync(path.join(root,'docs/index.html'),html.replace(/\n/g,'\r\n'));console.log('Built online account edition: docs/index.html');
