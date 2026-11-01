const assert=require('node:assert/strict'),fs=require('node:fs');
global.ClipperLib=require('./vendor/clipper.js');require('./domain.js');require('./layout.js');require('./layout-optimizer.js');require('./viewer-model.js');
const D=LogEnDomain,L=LogEnLayout,O=LogEnOptimizer,G=O.geometry;
const settings={...D.createDefaultSettings(),shiftsPerDay:1,coverageMode:'custom',customCoverageDays:1,stackingMode:'imported',maxFloorRowDepth:1300,gangwayWidth:1000};
const parts=Array.from({length:12},(_,i)=>({partNumber:'LINE-'+(i+1),qtyBox:1,qtyOnPallet:1,consumptionPerShift:2,doh:1,length:1200,width:900,height:1000,stacking:2,inputErrors:[]}));
const geometry={units:4,entities:[{id:'B',type:'LWPOLYLINE',layer:'B',closed:true,boundaryEligible:true,points:[[0,0],[40000,0],[40000,30000],[0,30000]],bounds:[0,0,40000,30000]}]},plan=D.calculateImplementation(parts,settings,{greenfield:true,storageMode:'ground'}),options={scale:1,boundaryId:'B',obstacleClearance:0,wallClearance:0,allowWallStorage:false,storageMode:'ground',groundStartVertical:'right',groundStartHorizontal:'top',geometryReviewed:true,constraintsConfirmed:true};
const clone=v=>JSON.parse(JSON.stringify(v));
function separated(layout,sourcePlan=plan,sourceSettings=settings){
 const l=clone(layout),original=l.groups[0],rows=original.groundRows,bySide={};for(const row of rows)(bySide[row.side]??=[]).push(row);
 const picks=[[],[]];for(const items of Object.values(bySide)){items.sort((a,b)=>a.x-b.x);items.forEach((row,i)=>picks[i<Math.ceil(items.length/2)?0:1].push(row));}
 const gap=2500,lo=original.rotated?l.env.box.minY:l.env.box.minX,hi=original.rotated?l.env.box.maxY:l.env.box.maxX,start=Math.max(lo+1000,Math.min(original.rotated?original.y:original.x,hi-1000-original.w-gap));
 l.groups=picks.map((chosen,i)=>{const cursors={front:0,back:0,wall:0},objects=[],groundRows=[];
   for(const row of chosen){const x=cursors[row.side];groundRows.push({...row,x});for(const o of original.objects.filter(o=>o.groundRowId===row.id))objects.push({...o,dx:o.dx-row.x+x});cursors[row.side]+=row.w;}
   const w=Math.max(...Object.values(cursors));return {...original,id:original.id+':section-'+i,w,groundRows,objects,...(original.groundLane?{centerLine:[[0,original.backY],[w,original.backY]]}:{})};
 });
 const [a,b]=l.groups,axis=a.rotated?'y':'x';a[axis]=start;b[axis]=start+a.w+gap;Object.assign(l,O.validate(l,sourcePlan,sourceSettings));assert(l.complete,JSON.stringify(l.validationErrors));return l;
}
function inventory(l){return l.groups.flatMap(g=>g.objects.map(o=>[o.id,o.quantity,o.stacking,o.w,o.h,o.length,o.width])).sort((a,b)=>a[0].localeCompare(b[0]));}
(async()=>{
 for(const orientation of ['horizontal','vertical']){
   const result=await O.optimize(plan,settings,geometry,{...options,warehouseOrientation:orientation}),before=separated(result.layout),expected=inventory(before),after=clone(before);O.compactGround(after,plan,settings);
   assert.equal(after.groups.length,1,'Clear sections on one center line must join without an internal gangway');assert(after.complete);assert.deepEqual(inventory(after),expected);assert.equal(after.accommodatedPallets,24);assert.equal(after.generatedGround,12);
   const lane=after.groups[0];for(const face of ['front','back']){let x=0;for(const row of lane.groundRows.filter(r=>r.side===face).sort((a,b)=>a.x-b.x)){assert.equal(row.x,x,'No empty frontage before a later box');x+=row.w;}}
   assert.equal(lane.centerLine[1][0],lane.w);const model=LogEnViewerModel.build({layout:after,parts,settings,geometry});assert.equal(model.pallets.length,24);assert(model.pallets.every(p=>p.stackLayer<=2));
   if(orientation==='horizontal')fs.writeFileSync('.tooling/ground-gap-review.json',JSON.stringify({before,after,settings,parts,geometry}));
   for(const role of ['obstacle','route']){const l=clone(before),a=l.groups[0],box={x:a.x+a.w+1100,y:a.y-1000,w:200,h:a.h+2000},shape=G.path(L.corners(box));
     if(role==='obstacle'){l.env.physical=G.union([...l.env.physical,shape]);l.env.blocked=G.union([...l.env.blocked,shape]);l.env.zone=G.diff(l.env.zone,[shape]);}else l.env.baseAccess=G.union([...l.env.baseAccess,shape]);
     Object.assign(l,O.validate(l,plan,settings));assert(l.complete,role+JSON.stringify(l.validationErrors));O.compactGround(l,plan,settings);assert.equal(l.groups.length,2,'Keep '+role+' clear');assert(l.complete);assert.deepEqual(inventory(l),expected);
   }
 }
 for(const wall of ['bottom','left','right','top']){const r=await O.optimize(plan,settings,geometry,{...options,allowWallStorage:true,wallRackMode:wall,wallStartSide:wall}),l=separated(r.layout),expected=inventory(l);O.compactGround(l,plan,settings);assert.equal(l.groups.length,1,'No run-end gangway between ground sections on '+wall+' wall');assert(l.complete);assert.deepEqual(inventory(l),expected);}
 const mixedParts=parts.map((p,i)=>({...p,partNumber:'MIX-'+(i+1),length:i<6?800:1700})),mixedSettings={...settings,maxFloorRowDepth:2000},mixedPlan=D.calculateImplementation(mixedParts,mixedSettings,{greenfield:true,storageMode:'ground'});
 for(const orientation of ['horizontal','vertical']){const result=await O.optimize(mixedPlan,mixedSettings,geometry,{...options,warehouseOrientation:orientation}),before=separated(result.layout,mixedPlan,mixedSettings);
   for(const g of before.groups){const depth=Math.max(...g.groundRows.map(row=>row.h));for(const row of g.groundRows){const y=row.side==='front'?depth-row.h:depth;for(const o of g.objects.filter(o=>o.groundRowId===row.id))o.dy+=y-row.y;row.y=y;}g.h=2*depth;g.backY=depth;g.centerLine=[[0,depth],[g.w,depth]];g.y=before.env.inner.minY+5000;}
   Object.assign(before,O.validate(before,mixedPlan,mixedSettings));assert(before.complete,JSON.stringify(before.validationErrors));assert.notEqual(before.groups[0].backY,before.groups[1].backY,'Regression must have different depths and center lines');const after=clone(before);O.compactGround(after,mixedPlan,mixedSettings);assert.equal(after.groups.length,1,'Different pallet depths must not leave a hole in the same band');assert(after.complete,JSON.stringify(after.validationErrors));assert.deepEqual(inventory(after),inventory(before));assert.equal(after.accommodatedPallets,24);
   if(orientation==='horizontal')fs.writeFileSync('.tooling/ground-gap-review.json',JSON.stringify({before,after,settings:mixedSettings,parts:mixedParts,geometry}));
 }
 console.log('Ground sections fill one continuous line: horizontal/vertical, every wall, exact inventory/stacking/3D, obstacles and main routes preserved.');
})().catch(e=>{console.error(e);process.exitCode=1;});
