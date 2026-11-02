const assert=require('node:assert/strict');global.ClipperLib=require('./vendor/clipper');require('./layout');require('./layout-optimizer');require('./viewer-forklift');
const G=LogEnOptimizer.geometry,poly=(x,z,w,d)=>[[x,0,z],[x+w,0,z],[x+w,0,z+d],[x,0,z+d]],aisle=poly(13,0,4,30),walkway=poly(0,12,30,2);
const model={buildingHeight:6,boundary:poly(0,0,30,30),bays:[],pallets:[],walls:[],obstacles:[],surfaces:[{kind:'aisle',points:aisle}],movementRestrictions:[{points:walkway,hole:false}]};
const closed=LogEnForklift.plan(model);assert(!closed.reason,closed.reason);assert.equal(closed.componentCount,2,'An unapproved pedestrian route must separate forklift navigation.');
const cut=G.diff([G.path(walkway.map(p=>[p[0]*1000,p[2]*1000]))],[G.path(aisle.map(p=>[p[0]*1000,p[2]*1000]))]);
const approved=structuredClone(model);approved.movementRestrictions=cut.map(p=>({points:G.points(p).map(p=>[p[0]/1000,0,p[1]/1000]),hole:!ClipperLib.Clipper.Orientation(p)}));
const open=LogEnForklift.plan(approved);assert(!open.reason,open.reason);assert.equal(open.componentCount,1,'A transverse approved crossing must reconnect the forklift route.');
const blocked=structuredClone(approved);blocked.obstacles=[{points:poly(13,12.5,4,.5)}];const route=LogEnForklift.plan(blocked);assert(!route.reason,route.reason);assert.equal(route.componentCount,2,'A physical pillar remains impassable inside an approved crossing.');
console.log('3 recognition-routing checks passed: unapproved pedestrian blockage, approved transverse crossing, physical obstacle remains blocked.');
