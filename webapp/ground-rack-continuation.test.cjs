const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');global.ClipperLib=require('./vendor/clipper.js');require('./domain.js');require('./layout.js');
vm.runInThisContext(fs.readFileSync(__dirname+'/layout-optimizer.js','utf8').replace('  function placementError(', '  globalThis.checkContinuation=placementError;\n  function placementError('));
const G=LogEnOptimizer.geometry,ring=G.path([[0,0],[30000,0],[30000,30000],[0,30000]]),settings={...LogEnDomain.createDefaultSettings(),floorPalletClearance:100,gangwayWidth:4500},env={zone:[ring],boundary:[ring],baseAccess:[],blocked:[],inner:{minX:0,minY:0,maxX:30000,maxY:30000},box:{minX:0,minY:0,maxX:30000,maxY:30000}},rack={id:'rack',kind:'rack',x:6000,y:6000,w:3000,h:1200,objects:[{id:'rack1',dx:0,dy:0,w:3000,h:1200}]},floor={id:'floor',kind:'ground',x:9100,y:6000,w:1000,h:1800,objects:[{id:'box1',dx:0,dy:0,w:1000,h:1800}]};
assert.equal(checkContinuation(floor,[rack],env,settings),null,'Ground can extend beyond rack depth when its front shares a clear aisle');
assert(checkContinuation({...floor,x:9050},[rack],env,settings)?.includes('100 mm'),'Require actual box clearance beside rack');
assert(checkContinuation({...floor,y:6100},[rack],env,settings)?.includes('accessible face'),'Continuation must not reduce the real forklift aisle');
assert(checkContinuation({...floor,x:8900},[rack],env,settings),'Physical rack overlaps remain invalid');
assert.equal(checkContinuation({...floor,rotated:true,x:6000,y:9100},[{...rack,rotated:true}],env,settings),null,'Same continuation rule works for perpendicular rows');
console.log('Rack/ground continuation checked: clear aisle, configured clearance, unequal depths, rotated row and blocked aisle.');
