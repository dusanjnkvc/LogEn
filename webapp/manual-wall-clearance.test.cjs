const assert=require('node:assert/strict');global.ClipperLib=require('./vendor/clipper');require('./domain');require('./layout');require('./warehouse-geometry');require('./layout-optimizer');require('./existing-layout');require('./manual-layout');
const D=LogEnDomain,O=LogEnOptimizer,L=LogEnLayout,M=LogEnManualLayout;
const settings={...D.createDefaultSettings(),gangwayWidth:4500,shiftsPerDay:1,coverageMode:'custom',customCoverageDays:1,maxFloorRowDepth:2000};
const parts=[{partNumber:'WALL-QA',qtyBox:1,qtyOnPallet:1,consumptionPerShift:2,doh:1,length:1200,width:900,height:1000,stacking:1,inputErrors:[]}];
const plan=D.calculateImplementation(parts,settings,{greenfield:true,storageMode:'ground'});
const makeGeometry=angle=>{const c=Math.cos(angle),s=Math.sin(angle),points=[[0,0],[40000,0],[40000,30000],[0,30000]].map(([x,y])=>[c*x-s*y,s*x+c*y]),b=L.bounds(points);return {units:4,entities:[{id:'B',layer:'Boundary',type:'LWPOLYLINE',closed:true,boundaryEligible:true,points,bounds:[b.minX,b.minY,b.maxX,b.maxY]}]};};
(async()=>{
for(const angle of [0,Math.PI/6])for(const orientation of ['horizontal','vertical']){
 const geometry=makeGeometry(angle),options={scale:1,boundaryId:'B',allowWallStorage:true,wallClearance:200,obstacleClearance:0,warehouseOrientation:orientation,geometryReviewed:true,constraintsConfirmed:true};
 const layout=(await O.optimize(plan,settings,geometry,options)).layout;
 const g=layout.groups.find(g=>g.kind==='ground');assert(g);const id=M.split(layout,g.objects[0].id),row=layout.groups.find(g=>g.id===id);row.manualRow=true;row.groundLane=false;row.wallSide=null;row.paired=false;row.x=layout.env.box.minX+10000;row.y=layout.env.box.minY+10000;
 const vertical=!!row.rotated,b=layout.env.box,axis=vertical?'y':'x',size=vertical?row.w:row.w;
 const far=vertical?b.maxY:b.maxX;
 row[axis]=far-size-1000;M.validate(layout,plan,settings,geometry);assert(layout.manualValidation.errors.some(e=>/warehouse wall.*1000 mm; required 4500 mm/.test(e.message)),angle+' '+orientation+': too close to terminal wall must be flagged');assert(!layout.accessValid);row.wallSide='bottom';M.validate(layout,plan,settings,geometry);assert.equal(row.wallSide,null,'A stale wall attachment in an old saved manual row must be cleared');assert(!layout.accessValid);
 row[axis]=far-size-4500;M.validate(layout,plan,settings,geometry);assert(!layout.manualValidation.errors.some(e=>/warehouse wall at the ground row end/.test(e.message)),'Exactly 4500 mm must pass');
 // Configured gangway width is live, not hardcoded to 4500.
 M.validate(layout,plan,{...settings,gangwayWidth:6000},geometry);assert(layout.manualValidation.errors.some(e=>/required 6000 mm/.test(e.message)));
 // A real neighbour can continue the same row; no aisle is inserted within it.
 const neighbor=M.clone(row);neighbor.id+=':next';neighbor.objects=neighbor.objects.map(o=>({...o,id:o.id+':next',manualEmpty:true,quantity:0}));row[axis]=far-size*2-5000-settings.floorPalletClearance;neighbor[axis]=row[axis]+size+settings.floorPalletClearance;
 // A shared junction needs pallet clearance, not another forklift aisle.
 neighbor.wallSide=null;neighbor.manualRow=true;layout.groups.push(neighbor);M.validate(layout,plan,settings,geometry);assert(!layout.manualValidation.errors.some(e=>e.groupId===row.id&&/warehouse wall at the ground row end/.test(e.message)),'Shared row junction must remain allowed');
 // Moving off the wall removes the wall exception; moving along it retains it.
 neighbor.wallSide='bottom';const old=M.origin(neighbor);M.translate(layout,[neighbor.id],Math.cos(neighbor.frame.angle)*100,Math.sin(neighbor.frame.angle)*100);assert.equal(neighbor.wallSide,'bottom');M.translate(layout,[neighbor.id],-Math.sin(neighbor.frame.angle)*100,Math.cos(neighbor.frame.angle)*100);assert.equal(neighbor.wallSide,null);
}
console.log('Manual terminal wall clearance checked: both orientations, rotated buildings, exact/insufficient/live gangway widths, shared row joins and wall-attachment edits.');
})().catch(e=>{console.error(e);process.exitCode=1;});
