/* Synthetic large all-ground regression and reproducible CLI benchmark.
 * node webapp/layout-large-ground.test.cjs --count=400 --optimizer=../.tooling/layout-optimizer-baseline.js
 * Optional --report=.tooling/ground-baseline.json writes timings and semantic summary.
 */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{performance}=require('node:perf_hooks');
const arg=name=>process.argv.find(v=>v.startsWith('--'+name+'='))?.split('=').slice(1).join('=');
const width=Number(arg('width')||40000),depth=Number(arg('depth')||60000);assert(width>0&&depth>0);
const count=Number(arg('count')||400);assert(Number.isSafeInteger(count)&&count>0&&count<=1500);
global.ClipperLib=require('./vendor/clipper.js');require('./domain.js');require('./layout.js');require(arg('optimizer')||'./layout-optimizer.js');
const D=LogEnDomain,L=LogEnLayout,O=LogEnOptimizer,settings={...D.createDefaultSettings(),shiftsPerDay:1,coverageMode:'custom',customCoverageDays:1,stackingMode:'imported'},parts=Array.from({length:count},(_,i)=>({partNumber:'SYNTHETIC-'+String(i+1).padStart(4,'0'),qtyBox:1,qtyOnPallet:1,consumptionPerShift:6,doh:1,length:i%3===0?1000:1200,width:800,height:1000,stacking:3,inputErrors:[]})),config={greenfield:true,storageMode:'ground'},plan=D.calculateImplementation(parts,settings,config),geometry={units:4,entities:[{id:'B',type:'LWPOLYLINE',layer:'Boundary',points:[[0,0],[width,0],[width,depth],[0,depth]],closed:true,boundaryEligible:true,bounds:[0,0,width,depth]}]},options={scale:1,boundaryId:'B',obstacleClearance:0,wallClearance:0,allowWallStorage:true,racksAroundWalls:true,wallRackMode:'all',wallStartSide:'left',warehouseOrientation:'auto',groundStartVertical:'right',groundStartHorizontal:'top',storageMode:'ground',geometryReviewed:true,constraintsConfirmed:true};
(async()=>{
  const original=JSON.stringify({plan,settings,geometry,options}),marks=[];let previous=performance.now(),started=previous;
  const result=await O.optimize(plan,settings,geometry,options,(n,total)=>{const now=performance.now();if(n>1)marks.push({candidate:n-1,ms:now-previous});previous=now;process.stderr.write(`Candidate ${n}/${total}\n`);});marks.push({candidate:marks.length+1,ms:performance.now()-previous});
  assert.equal(JSON.stringify({plan,settings,geometry,options}),original,'Optimization must not mutate source data');
  assert(result.alternatives.horizontal&&result.alternatives.vertical,'Compare both orientations');
  const summaries={};
  for(const [orientation,layout]of Object.entries(result.alternatives)){
    assert.equal(layout.requiredPallets,count*6);assert.equal(layout.generatedRack,0);assert(layout.accommodatedPallets>=0&&layout.accommodatedPallets<=count*6);
    const objects=layout.groups.flatMap(g=>g.objects);assert.equal(new Set(objects.map(o=>o.id)).size,objects.length,'No duplicate physical positions');
    assert(objects.every(o=>o.quantity===3&&o.stacking===3),'Imported stacking stays intact');
    const m=layout.metrics;assert(Math.abs(m.totalWarehouseArea-m.groundFootprint-m.rackFootprint-m.gangwayArea-m.mandatoryClearanceArea-m.obstacleArea-m.unusedUsableArea-m.unusableArea)<.02,'Storage and gangway areas do not overlap');
    const missing=layout.shortage;assert.equal(layout.accommodatedPallets+missing.pallets,count*6,'Every pallet must be placed or reported missing');
    summaries[orientation]={complete:layout.complete,accessValid:layout.accessValid,accommodatedPallets:layout.accommodatedPallets,generatedGround:layout.generatedGround,groups:layout.groups.length,unplaced:layout.unplaced.length,missingPallets:missing.pallets,groundFootprint:layout.metrics.groundFootprint,gangwayArea:layout.metrics.gangwayArea,validationErrors:layout.validationErrors};
  }
  assert.equal(marks.length,8,'All-ground all-wall search keeps eight distinct candidates');
  const report={parts:count,width,depth,totalMs:performance.now()-started,candidates:marks,winner:result.winner,alternatives:summaries};
  if(arg('report'))fs.writeFileSync(path.resolve(arg('report')),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
})().catch(error=>{console.error(error);process.exitCode=1;});
