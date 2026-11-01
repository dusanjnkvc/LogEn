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
// Graph samples must produce long driving legs, not repeated turns at 0.65 m nodes.
for(const start of route.components[0].filter((_,i)=>i%17===0).slice(0,12)){
 let seed=start+1;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296),n=route.nodes[start],neighbor=route.nodes[n.links[0]];
 let node=start,previous=-1,pose={x:n.x,z:n.z,yaw:Math.atan2(neighbor.x-n.x,neighbor.z-n.z)},leg=F.nextLeg(route,node,previous,pose,random),distance=0,still=0,longest=0;
 for(let i=0;i<1800;i++){if(Math.hypot(leg.target.x-pose.x,leg.target.z-pose.z)<.3){node=leg.end;previous=leg.previous;leg=F.nextLeg(route,node,previous,pose,random);}const next=F.steer(route,pose,leg.target,1/30,1.2);if(next){const moved=Math.hypot(next.x-pose.x,next.z-pose.z);distance+=moved;still=moved>.0001?0:still+1/30;pose=next;assert(F.fits(route,pose));}else still+=1/30;longest=Math.max(longest,still);}
 assert(distance>25,`Vehicle must drive through gangways, not spin: ${distance.toFixed(2)} m from node ${start}`);assert(longest<5,`Vehicle rotates without driving for ${longest}s`);
}
console.log('Long-leg forklift driving checked from 12 aisle locations: forward progress, bounded turning and clearance throughout.');
