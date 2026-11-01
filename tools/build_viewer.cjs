// Reproducible offline renderer build. Tool dependencies stay outside app/runtime code.
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const esbuild=require(path.join(root,'.tooling/viewer-build/node_modules/esbuild'));
esbuild.buildSync({entryPoints:[path.join(root,'webapp/viewer-3d.entry.js')],bundle:true,minify:true,format:'iife',target:['chrome110','safari16'],outfile:path.join(root,'webapp/vendor/viewer-3d.min.js'),legalComments:'eof'});
console.log('Bundled Three.js renderer for offline use.');
