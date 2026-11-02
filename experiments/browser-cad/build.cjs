const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '../..');

(async () => {
  const result = await esbuild.build({
    entryPoints:[path.join(__dirname,'worker.mjs')], bundle:true, platform:'browser',
    format:'iife', target:['chrome100'], minify:true, legalComments:'inline', write:false,
  });
  const worker = result.outputFiles[0].text;
  const license = fs.readFileSync(path.join(__dirname,'node_modules/@node-projects/acad-ts/LICENSE'),'utf8');
  const escapeHtml = str => str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const embedded = str => JSON.stringify(str).replace(/</g,'\\u003c');
  const html = fs.readFileSync(path.join(__dirname,'page.html'),'utf8')
    .replace('__LICENSE__',escapeHtml(license))
    .replace('__SAMPLE__',embedded(fs.readFileSync(path.join(__dirname,'fixtures/warehouse-source.dwg')).toString('base64')))
    .replace('__WORKER__',embedded(worker));
  fs.writeFileSync(path.join(root,'docs/cad-proof.html'),html);
  fs.writeFileSync(path.join(__dirname,'THIRD-PARTY-LICENSE.txt'),license);
  console.log(`Built standalone CAD proof: ${Buffer.byteLength(html).toLocaleString()} bytes; no runtime dependencies.`);
})().catch(error => { console.error(error); process.exitCode=1; });
