const assert=require('node:assert/strict');
global.ClipperLib=require('./vendor/clipper.js');require('./domain.js');require('./layout.js');require('./layout-optimizer.js');require('./viewer-model.js');
const D=LogEnDomain,L=LogEnLayout,O=LogEnOptimizer,V=LogEnViewerModel,G=O.geometry;
const settings={...D.createDefaultSettings(),shiftsPerDay:1,coverageMode:'custom',customCoverageDays:1,stackingMode:'imported',gangwayWidth:1500};
const part=(pn,n,l=1200,w=800)=>({partNumber:pn,qtyBox:1,qtyOnPallet:1,consumptionPerShift:n,doh:1,length:l,width:w,height:1000,stacking:2,inputErrors:[]});
const geometry=(w=40000,h=60000,angle=0)=>{const c=Math.cos(angle),s=Math.sin(angle),points=[[0,0],[w,0],[w,h],[0,h]].map(([x,y])=>[x*c-y*s,x*s+y*c]);return {units:4,entities:[{id:'B',type:'LWPOLYLINE',layer:'Boundary',closed:true,boundaryEligible:true,points,bounds:[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))]}]};};
const options={scale:1,boundaryId:'B',storageMode:'ground',allowWallStorage:false,wallClearance:0,obstacleClearance:0,groundStartVertical:'right',groundStartHorizontal:'top',geometryReviewed:true,constraintsConfirmed:true};
global.ExcelJS=require('./vendor/exceljs.min.js');require('./workbook.js');
const rectangle=r=>G.path(L.corners(r));
function check(layout,plan,geo,s=settings){
 assert(layout.accessValid,JSON.stringify(layout.validationErrors));const m=layout.metrics;assert(Math.abs(m.totalWarehouseArea-m.groundFootprint-m.rackFootprint-m.gangwayArea-m.mandatoryClearanceArea-m.obstacleArea-m.unusedUsableArea-m.unusableArea)<.02,'Storage, gangways and free areas must partition the building');
 assert.equal(layout.accommodatedPallets+layout.shortage.pallets,plan.rows.reduce((n,r)=>n+r.required,0));
 const all=layout.groups.flatMap(g=>g.objects);assert.equal(new Set(all.map(o=>o.id)).size,all.length);
 for(const group of layout.groups.filter(g=>g.kind==='ground')){
  assert(group.wallSide||group.paired,'Interior ground rows must remain paired');
  if(!group.wallSide){assert.equal(group.rows,2);assert(group.groundRows.length>0);assert(group.centerLine);for(const row of group.groundRows){if(row.side==='front')assert(Math.abs(row.y+row.h-group.backY)<.11);else assert(Math.abs(row.y-group.backY)<.11);}assert.equal(group.separation,0);
   for(const y of [group.y-s.gangwayWidth,group.y+group.h])assert(G.area(G.diff([rectangle({x:group.x,y,w:group.w,h:s.gangwayWidth})],layout.metrics.accessPaths))<.11,'Both outer faces need a full-width gangway');
  }else assert(!group.paired,'Wall rows stay single');
  const objects=O.placedObjects(group);for(let i=0;i<objects.length;i++)for(let j=i+1;j<objects.length;j++){assert(G.area(G.intersect([G.path(objects[i].points)],[G.path(objects[j].points)]))<.11,'Ground positions cannot overlap');}
 }
 const model=V.build({layout,parts:plan.rows.map(r=>r.input),settings:s,geometry:geo});assert.equal(model.pallets.length,layout.accommodatedPallets);assert.equal(new Set(model.pallets.map(p=>p.location)).size,model.pallets.length,'3D locations must be unique across both rows and PNs');
 for(const slot of model.groundSlots){const group=layout.groups.find(g=>g.objects.some(o=>'ground-slot:'+o.id===slot.id)),object=group.objects.find(o=>'ground-slot:'+o.id===slot.id),row=group.groundRows.find(r=>r.id===object.groundRowId);assert.equal(slot.rowArea,group.groundLane?group.w*(object.groundFace==='front'?group.backY:group.h-group.backY)/1e6:group.wallSide?group.w*group.h/1e6:row.w*row.h/1e6);}
}
(async()=>{
 const parts=[part('A',8),part('B',6,1000,900),part('C',8)],plan=D.calculateImplementation(parts,settings,{greenfield:true,storageMode:'ground'}),before=JSON.stringify(plan);
 for(const angle of [0,Math.PI/6]){const geo=geometry(40000,60000,angle),result=await O.optimize(plan,settings,geo,options);for(const layout of Object.values(result.alternatives)){assert(layout.complete);check(layout,plan,geo);if(angle===0){const bytes=await new LogEnWorkbook().layoutBytes({name:'Synthetic ground pairs',settings,parts,implementation:{}},plan,layout),book=new ExcelJS.Workbook();await book.xlsx.load(bytes);const rows=book.getWorksheet('Ground Positions');assert.equal(rows.rowCount-1,layout.generatedGround);for(let i=2;i<=rows.rowCount;i++)assert(L.makeObjects(plan,settings).groups.some(g=>g.id===rows.getRow(i).getCell(13).value),'Excel keeps dedicated ground row IDs');}assert.equal(layout.accommodatedPallets,parts.reduce((n,p)=>n+p.consumptionPerShift,0),'Odd rows must not invent stock');}}
 assert.equal(JSON.stringify(plan),before,'Pairing must not mutate demand, stacking or source rows');
 for(const side of ['left','right','top','bottom']){const geo=geometry(),result=await O.optimize(plan,settings,geo,{...options,allowWallStorage:true,wallRackMode:side,wallStartSide:side});check(result.layout,plan,geo);assert(result.layout.groups.some(g=>g.wallSide));const wall=result.layout.groups.find(g=>g.wallSide);assert.throws(()=>O.move(result.layout,wall.id,20000,30000,!!wall.rotated,plan,settings),/Single ground rows/,'A single wall row cannot be moved into the middle');}
 const smallSettings={...settings,gangwayWidth:1000},smallPlan=D.calculateImplementation([part('ONE',1)],smallSettings,{greenfield:true,storageMode:'ground'}),smallGeo=geometry(4000,4000),small=await O.optimize(smallPlan,smallSettings,smallGeo,options);assert(!small.layout.complete);assert.equal(small.layout.shortage.pallets,1);assert(small.layout.unplaced.every(g=>g.paired),'Do not split failed ground pairs into single rows');
 console.log('Back-to-back ground rows checked: both outer gangways, mirrored positions, all walls, rotated building, imported stacking, odd row reservation, unique 3D locations and shortage accounting.');
})().catch(e=>{console.error(e);process.exitCode=1;});
