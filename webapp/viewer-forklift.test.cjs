const assert=require('node:assert/strict');global.ClipperLib=require('./vendor/clipper.js');require('./domain.js');require('./layout.js');require('./layout-optimizer.js');require('./viewer-forklift.js');
const F=LogEnForklift,G=LogEnOptimizer.geometry;
const rect=(x,z,w,d)=>[[x,0,z],[x+w,0,z],[x+w,0,z+d],[x,0,z+d]],model={buildingHeight:5,boundary:rect(0,0,30,25),surfaces:[{kind:'aisle',points:rect(0,0,30,4.5)},{kind:'aisle',points:rect(0,0,4.5,25)},{kind:'aisle',points:rect(0,20.5,30,4.5)}],bays:[],pallets:[],walls:[],obstacles:[]};
const before=JSON.stringify(model),route=F.plan(model);assert(!route.reason,route.reason);assert(route.length>20);assert.equal(JSON.stringify(model),before);assert(route.points.length>2);
function path(points){const p=G.path(points.map(v=>[v[0]*1000,v[2]*1000]));if(!ClipperLib.Clipper.Orientation(p))p.reverse();return p;}
const aisle=G.union(model.surfaces.map(s=>path(s.points)));
for(let distance=0;distance<=route.length;distance+=.3){const p=F.sample(route,distance);for(const angle of [p.yaw,0,.7,Math.PI/2]){const c=Math.cos(angle),s=Math.sin(angle),w=route.vehicle.width/2,d=route.vehicle.length/2,foot=[[-w,-d],[w,-d],[w,d],[-w,d]].map(([x,z])=>[p.x+x*c+z*s,0,p.z-x*s+z*c]);assert(G.area(G.diff([path(foot)],aisle))<.11,'Forklift footprint must remain inside actual aisles, including turns');}}
assert(F.plan({...model,surfaces:[{kind:'aisle',points:rect(0,0,30,1.5)}]}).reason,'Narrow gangway must not invent a drive-through route');
const split=F.plan({...model,surfaces:[{kind:'aisle',points:rect(0,0,30,4.5)}],obstacles:[{points:rect(14,0,2,4.5)}]});assert(split.componentCount===2);for(const p of split.points)assert(p[0]<14||p[0]>16);
const empty=F.plan({...model,surfaces:[]});assert(empty.reason);assert(!empty.points.length);console.log('Forklift route checked: continuous actual aisles, vehicle envelope at turns, obstacles, disconnected aisles, narrow/no-route cases and unchanged source.');
