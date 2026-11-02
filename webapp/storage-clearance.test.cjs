const assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('../.tooling/qa/node_modules/jsdom');
global.ClipperLib=require('./vendor/clipper');require('./domain');require('./layout');require('./warehouse-geometry');require('./layout-optimizer');require('./viewer-model');
const A=LogEnWarehouseGeometry,L=LogEnLayout,D=LogEnDomain,O=LogEnOptimizer;
const rect=(id,layer,x,y,w,h)=>({id,layer,type:'LWPOLYLINE',closed:true,boundaryEligible:true,points:L.corners({x,y,w,h}),bounds:[x,y,x+w,y+h]});
const room=rect('room','0',0,0,40000,40000),pillar=rect('column','Pillars',10000,10000,1000,1000),base={scale:1,boundaryId:'detected:regions',obstacleClearance:0,geometryReviewed:true,constraintsConfirmed:true};
const settings={...D.createDefaultSettings(),rackLevels:2,gangwayWidth:2000,maxFloorRowDepth:1300,stockMode:'consumption',stackingMode:'imported',shiftsPerDay:1,coverageMode:'custom',customCoverageDays:1};
const analyze=(entities,o={})=>A.analyze({units:4,entities},{...base,...o},settings);
const column=analyze([room,pillar]);assert.equal(column.excludedArea,9,'One metre from every side of a 1 m pillar reserves 9 m²');assert.equal(A.area(column.physical),1,'Clearance is not a bigger physical pillar');
assert.equal(analyze([room,pillar],{pillarClearance:2000,obstacleClearance:100}).excludedArea,25,'Other obstacle clearance must not add to the selected pillar clearance');
assert(Math.abs(analyze([room,rect('restricted','Restricted',10000,10000,1000,1000)],{restrictedClearance:200}).excludedArea-1.96)<1e-7);
assert(Math.abs(analyze([room,rect('walk','Gangways',5000,5000,1000,10000)],{pedestrianClearance:300}).excludedArea-16.96)<1e-7);
assert.equal(A.role({layer:'Gangways'}),'pedestrian');assert.equal(A.role({layer:'Forklift gangway'}),'gangway');assert.equal(A.role({layer:'Gangways'},{layerRoles:{Gangways:'gangway'}}),'gangway','An explicit forklift classification remains editable');
assert.equal(analyze([room,rect('door','Doors',10000,10000,1000,2000)],{doorClearance:500}).excludedArea,6);
assert.throws(()=>analyze([room],{pillarClearance:-1}),/non-negative pillar/);
const part={partNumber:'TEST',qtyBox:1,qtyOnPallet:1,consumptionPerShift:120,doh:1,length:1200,width:1000,height:1000,stacking:1,inputErrors:[]};
async function main(){
 const groundGeometry=A.prepare({units:4,entities:[rect('ground-area','0',0,0,30000,18000),rect('ground-column','Pillars',14500,9800,500,500)]}),groundPlan=D.calculateImplementation([part],settings,{greenfield:true,storageMode:'ground'}),ground=await O.optimize(groundPlan,settings,groundGeometry,base),groundMask=A.analyze(groundGeometry,base,settings);
 assert(ground.layout.generatedGround>0);assert(ground.layout.groups.some(g=>g.skipStartAccess||g.skipEndAccess),'A ground lane should continue beside the pillar clearance without adding a cross-aisle at that break');
 for(const o of L.cadObjects(ground.layout))assert(A.area(A.intersect([A.ring(o.points)],groundMask.pillarClearancePaths))<1e-7,'Ground storage entered the pillar clearance');
 const upper=rect('upper','0',0,25000,12000,8000),lower=rect('lower','0',0,0,30000,18000),rackGeometry=A.prepare({units:4,entities:[upper,lower,pillar]}),rackPart={...part,consumptionPerShift:60},rackPlan=D.calculateImplementation([rackPart],settings,{greenfield:true,storageMode:'rack'}),rack=await O.optimize(rackPlan,settings,rackGeometry,base),mask=A.analyze(rackGeometry,base,settings),objects=L.cadObjects(rack.layout);
 assert.equal(rack.layout.accommodatedPallets,60);assert.equal(rack.layout.validationErrors.length,0);assert(objects.some(o=>o.points.every(p=>L.core.inside(p,lower.points))),'The lower usable area must receive storage');
 for(const o of objects)assert(A.area(A.intersect([A.ring(o.points)],mask.pillarClearancePaths))<1e-7,'Rack structure entered the pillar clearance');
 const walkway=rect('walk','Gangways',0,18000,30000,1500),modelGeometry=A.prepare({units:4,entities:[upper,lower,walkway]}),model=LogEnViewerModel.build({layout:rack.layout,geometry:modelGeometry,parts:[rackPart],settings});
 assert.equal(model.walls.length,0,'Usable-area edges must not become walls in 3D');assert(model.surfaces.some(v=>v.kind==='pedestrian'));assert(!model.obstacles.some(v=>v.id==='walk'));
 const framed=A.prepare({units:4,entities:[upper,lower,walkway,rect('outer-wall','Walls',-1000,-1000,45000,45000),rect('inner-wall','Walls',-700,-700,44400,44400)]}),frameModel=LogEnViewerModel.build({layout:rack.layout,geometry:framed,parts:[rackPart],settings});
 assert.equal(frameModel.walls.filter(v=>v.kind==='external-wall').length,4,'Only the actual exterior gets exterior walls; the pedestrian divider remains open');
 const dom=new JSDOM('<!doctype html><body></body>',{runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;w.ClipperLib=ClipperLib;w.structuredClone=structuredClone;w.HTMLDialogElement.prototype.showModal=function(){};
 for(const file of ['domain.js','layout.js','warehouse-geometry.js','layout-optimizer.js','layout-ui.js'])w.eval(fs.readFileSync('webapp/'+file,'utf8'));
 let saved;const dialog=w.LogEnLayoutUI.open({name:'Clearance test',settings,geometry:{units:4,entities:[room,pillar]},plan:groundPlan,options:base,onSave:async v=>{saved=v;}});
 assert.equal(dialog.querySelector('[data-geometry-setting="pillarClearance"]').value,'1000');
 for(const [key,value]of Object.entries({pillarClearance:1500,doorClearance:700,restrictedClearance:250,pedestrianClearance:300})){const input=dialog.querySelector('[data-geometry-setting="'+key+'"]');input.value=value;input.dispatchEvent(new w.Event('change',{bubbles:true}));}
 dialog.querySelector('[data-layout-save]').click();await new Promise(r=>setTimeout(r,0));for(const [key,value]of Object.entries({pillarClearance:1500,doorClearance:700,restrictedClearance:250,pedestrianClearance:300}))assert.equal(saved.options[key],value);
 dom.window.close();console.log('Storage clearance checks passed: separate buffers/defaults, all-area rack recovery, ground rows around pillars, pedestrian 3D and saved UI controls.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
