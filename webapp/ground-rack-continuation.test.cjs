const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');global.ClipperLib=require('./vendor/clipper.js');require('./domain.js');require('./layout.js');
vm.runInThisContext(fs.readFileSync(__dirname+'/layout-optimizer.js','utf8').replace('  function placementError(', '  globalThis.checkContinuation=placementError;\n  function placementError('));
const G=LogEnOptimizer.geometry,ring=G.path([[0,0],[30000,0],[30000,30000],[0,30000]]),settings={...LogEnDomain.createDefaultSettings(),floorPalletClearance:100,gangwayWidth:4500},env={zone:[ring],boundary:[ring],baseAccess:[],blocked:[],inner:{minX:0,minY:0,maxX:30000,maxY:30000},box:{minX:0,minY:0,maxX:30000,maxY:30000}},rack={id:'rack',kind:'rack',x:6000,y:6000,w:3000,h:1200,objects:[{id:'rack1',dx:0,dy:0,w:3000,h:1200}]},floor={id:'floor',kind:'ground',x:9100,y:6000,w:1000,h:1800,objects:[{id:'box1',dx:0,dy:0,w:1000,h:1800}]};
assert.equal(checkContinuation(floor,[rack],env,settings),null,'Ground can extend beyond rack depth when its front shares a clear aisle');
assert(checkContinuation({...floor,x:9050},[rack],env,settings)?.includes('100 mm'),'Require actual box clearance beside rack');
assert(checkContinuation({...floor,x:6000,y:7300},[rack],env,settings)?.includes('accessible face'),'Continuation must not reduce the real forklift aisle');
assert(checkContinuation({...floor,x:8900},[rack],env,settings),'Physical rack overlaps remain invalid');
assert.equal(checkContinuation({...floor,rotated:true,x:6000,y:9100},[{...rack,rotated:true}],env,settings),null,'Same continuation rule works for perpendicular rows');
console.log('Rack/ground continuation checked: clear aisle, configured clearance, unequal depths, rotated row and blocked aisle.');

const lane={...floor,groundLane:true,paired:true,backY:900};
assert.equal(checkContinuation(lane,[rack],env,settings),null,'Ground lane end joins rack without a cross-aisle');
assert.equal(checkContinuation(rack,[lane],env,settings),null,'Join is valid from the rack side too');
assert.equal(checkContinuation({...lane,rotated:true,x:6000,y:9100},[{...rack,rotated:true}],env,settings),null,'Rotated ground lane joins rack end');
const synthetic={...env,baseAccess:[G.path([[9000,0],[13500,0],[13500,30000],[9000,30000]])],doors:[]};
assert.equal(checkContinuation(lane,[rack],synthetic,settings),null,'Joined storage can replace an automatic circulation extension');
assert(checkContinuation(lane,[rack],{...synthetic,existingAccess:synthetic.baseAccess},settings),'Explicit CAD gangway stays protected');
assert(checkContinuation(lane,[rack],{...synthetic,doors:[{id:'door'}]},settings),'Door circulation stays protected');
