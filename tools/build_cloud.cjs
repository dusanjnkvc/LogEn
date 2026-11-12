/* Compatibility entry point: GitHub Pages now uses the local-only static app. */
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'LogEn.html'),'utf8');
if(/id="login-form"|sb_publishable_|supabase\.co|new LogEnCloudStore/.test(html))throw Error('Rebuild the local-only app before publishing.');
fs.writeFileSync(path.join(root,'docs/index.html'),html);
console.log('Built GitHub Pages edition: no login, local browser storage.');
