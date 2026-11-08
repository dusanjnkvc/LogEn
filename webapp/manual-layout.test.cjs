const test=require('node:test'),assert=require('node:assert/strict');
global.ClipperLib=require('./vendor/clipper.js');require('./domain.js');require('./layout.js');require('./warehouse-geometry.js');require('./layout-optimizer.js');require('./existing-layout.js');require('./manual-layout.js');require('./viewer-model.js');
const D=LogEnDomain,L=LogEnLayout,O=LogEnOptimizer,M=LogEnManualLayout;
const settings={...D.createDefaultSettings(),shiftsPerDay:1,coverageMode:'custom',customCoverageDays:1};
const parts=[{partNumber:'QA',qtyBox:1,qtyOnPallet:1,consumptionPerShift:12,doh:1,length:1200,width:800,height:1000,stacking:1,inputErrors:[]}];
const plan=D.calculateImplementation(parts,settings,{greenfield:true,improvementThreshold:100});
const geometry={units:4,entities:[{id:'B',type:'LWPOLYLINE',layer:'Boundary',closed:true,boundaryEligible:true,points:[[0,0],[40000,0],[40000,40000],[0,40000]],bounds:[0,0,40000,40000]}]};
const options={scale:1,boundaryId:'B',layerRoles:{Boundary:'boundary'},allowWallStorage:false,obstacleClearance:0,wallClearance:0,geometryReviewed:true,constraintsConfirmed:true};
let base;test.before(async()=>{base=(await O.optimize(plan,settings,geometry,options)).layout;});
test('Edge snapping uses CAD dimensions and aisle offsets',()=>{const l=M.clone(base),g=l.groups[0],n=M.clone(g);n.id+='other';n.x+=g.w+10000;n.objects.forEach(o=>o.id+='other');l.groups.push(n);const a=M.box(g),b=M.box(n),proposal=M.snap(l,[g.id],b.minX-a.maxX-20,0,settings,50,100);assert(Math.abs(a.maxX+proposal.dx-b.minX)<.1);assert(proposal.guides.length);});
test('Group movement preserves inventory and alignment, undo and redo',()=>{const l=M.clone(base),before=L.cadObjects(l),h=M.session(l);h.checkpoint();M.translate(l,l.groups.map(g=>g.id),123,456);const after=L.cadObjects(l);before.forEach((o,i)=>{assert(Math.abs(after[i].center[0]-o.center[0]-123)<.2);assert.deepEqual(after[i].allocations,o.allocations);});assert(h.undo());assert.deepEqual(L.cadObjects(l),before);assert(h.redo());assert.deepEqual(L.cadObjects(l),after);});
test('Individual selection and rotation retain allocations and actual size',()=>{const l=M.clone(base),all=L.cadObjects(l),id=M.split(l,l.groups[0].objects[0].id);assert.deepEqual(L.cadObjects(l).map(o=>o.id).sort(),all.map(o=>o.id).sort());const g=l.groups.find(g=>g.id===id),alloc=M.clone(g.objects[0].allocations);M.rotate(l,[id]);assert.deepEqual(g.objects[0].allocations,alloc);assert.equal(g.w*g.h,g.objects[0].w*g.objects[0].h);M.validate(l,plan,settings,geometry);});
test('Invalid draft retained, pillar and slot errors explain affected objects',()=>{const l=M.clone(base),g=l.groups[0],b=M.box(g);const p={id:'P03',layer:'Pillar',points:[[b.minX,b.minY],[b.minX+200,b.minY],[b.minX+200,b.minY+200],[b.minX,b.minY+200]],closed:true};l.options.layerRoles.Pillar='pillar';g.objects[0].allocations[0].length=99999;const v=M.validate(l,plan,settings,{...geometry,entities:[...geometry.entities,p]});assert(v.errors.some(e=>e.message.includes('P03')));assert(v.errors.some(e=>e.message.includes('exceeds slot')));assert(!l.accessValid);M.translate(l,[g.id],-100000,0);M.validate(l,plan,settings,geometry);assert(l.groups.some(v=>v.x<0));assert(l.validationErrors.length);});
test('Duplicate empty storage and delete preserve total inventory',()=>{const l=M.clone(base),qty=L.cadObjects(l).reduce((n,o)=>n+(o.allocations?.length||0),0);const ids=M.duplicate(l,[l.groups[0].id],1000);assert.equal(L.cadObjects(l).reduce((n,o)=>n+(o.allocations?.length||0),0),qty);M.remove(l,[l.groups[0].id]);assert(l.unplaced.length);assert.equal([...l.groups,...l.unplaced].flatMap(g=>g.objects).reduce((n,o)=>n+(o.allocations?.length||0),0),qty);assert(ids.length);});
test('Save/reopen, CAD geometry and 3D positions share manual coordinates',()=>{const l=M.clone(base);M.translate(l,l.groups.map(g=>g.id),200,300);const reopened=JSON.parse(JSON.stringify(l));assert.deepEqual(L.cadObjects(reopened),L.cadObjects(l));const model=LogEnViewerModel.build({layout:reopened,geometry,parts,settings});for(const bay of model.bays){const o=L.cadObjects(l).find(o=>'bay:'+o.id===bay.id);assert(o);assert(Math.abs(o.center[0]-bay.cadCenter[0])<.1);assert(Math.abs(o.center[1]-bay.cadCenter[1])<.1);}});
test('Manual toolbar saves invalid drafts and blocks final export in the live DOM',async()=>{
 const {JSDOM}=require('../.tooling/qa/node_modules/jsdom'),fs=require('fs');
 const dom=new JSDOM('<!doctype html><body></body>',{runScripts:'outside-only',url:'https://example.test'}),w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))};
 for(const f of ['vendor/clipper.js','domain.js','layout.js','warehouse-geometry.js','layout-optimizer.js','existing-layout.js','manual-layout.js','layout-ui.js'])w.eval(fs.readFileSync(__dirname+'/'+f,'utf8'));
 let saved=null,exports=0;const l=M.clone(base),d=w.LogEnLayoutUI.open({plan,settings,geometry:M.clone(geometry),options,saved:l,name:'QA',onSave:async v=>{saved=v},onExport:async()=>{exports++}});
 assert(d.querySelector('[data-manual="snap"]'));d.querySelector('[data-manual="snap"]').click();assert.equal(d.querySelector('[data-manual="snap"]').textContent,'Snap OFF');
 // Select using the accessible SVG keyboard path, then nudge into an invalid draft.
 const shape=d.querySelector('[data-storage]');shape.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
 for(let i=0;i<3;i++)d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowLeft',shiftKey:true,bubbles:true}));
 l.groups[0].x=-100000;d.querySelector('[data-manual="validate"]').click();assert(d.querySelector('.manual-validation'));assert(d.querySelector('[data-layout-export]').disabled);
 const fixButton=d.querySelector('.manual-validation [data-manual="fix"]');assert(fixButton);fixButton.click();await new Promise(r=>setTimeout(r,10));assert(d.querySelector('.layout-inline-error').textContent.includes('No safe spacing repair'));
 d.querySelector('[data-layout-save]').click();await new Promise(r=>setTimeout(r,5));assert(saved?.layout);assert(saved.layout.manualEdited);
 d.querySelector('[data-manual="undo"]').click();d.querySelector('[data-manual="redo"]').click();
 assert.equal(exports,0);d.close();dom.window.close();
});
test('Undersized aisle reports measured and required clearances',()=>{const l=M.clone(base),g=l.groups[0],n=M.clone(g);n.id+='adjacent';n.objects.forEach(o=>o.id+='adjacent');n.y=g.y+g.h+1000;l.groups.push(n);const v=M.validate(l,plan,settings,geometry);assert(v.errors.some(e=>e.message.includes('1000 mm')&&e.message.includes(String(settings.gangwayWidth))));});
test('Pallet assignments can move within rack slots without changing inventory',()=>{const l=M.clone(base),g=l.groups[0],o=g.objects[0],a=o.allocations[0],before={...a};M.moveAssignment(l,o.id,0,100,0);assert.equal(a.pn,before.pn);assert.equal(o.allocations.length,base.groups[0].objects[0].allocations.length);assert(a.x!==before.x||a.y!==before.y);a.x=99999;assert(M.validate(l,plan,settings,geometry).errors.some(e=>e.message.includes('exceeds slot')));});
test('Ground boxes remain in one block with fixed clearances through move, snap, rotate and undo',()=>{
 for(const angle of [0,Math.PI/6])for(const rotated of [false,true]){
  const g={id:'ground-block',kind:'ground',x:6000,y:7000,w:1000,h:2800,rotated,frame:{angle,sx:1,sy:1},groundLane:true,backY:1400,objects:[{id:'ground:A:1',kind:'ground',pn:'A',dx:50,dy:50,w:900,h:1200,quantity:1,stacking:1,rotation:0},{id:'ground:A:2',kind:'ground',pn:'A',dx:50,dy:1550,w:900,h:1200,quantity:1,stacking:1,rotation:0}]};
  const l={groups:[g],unplaced:[],env:{box:{minX:0,minY:0,maxX:40000,maxY:40000}},options:{allowWallStorage:false}},before=M.clone(g),h=M.session(l),distance=()=>{const [a,b]=L.placedObjects(l.groups[0]);return Math.hypot(a.center[0]-b.center[0],a.center[1]-b.center[1]);},initialDistance=distance();
  h.checkpoint();assert.equal(M.split(l,'ground:A:1'),'ground-block');assert.equal(l.groups.length,1);
  const proposal=M.snap(l,[g.id],317,469,settings,50,100);M.translate(l,[g.id],proposal.dx,proposal.dy);
  assert.deepEqual(g.objects,before.objects);assert.equal(g.backY,before.backY);assert.equal(g.w,before.w);assert.equal(g.h,before.h);assert(Math.abs(distance()-initialDistance)<.1);
  M.rotate(l,[g.id]);assert(Math.abs(distance()-initialDistance)<.1);assert.deepEqual(g.objects,before.objects);
  assert(h.undo());assert.deepEqual(l.groups[0],before);assert(h.redo());assert.deepEqual(l.groups[0].objects,before.objects);
 }
});
test('Ground continuation beside racks snaps with box clearance instead of touching',()=>{
 const c=settings.floorPalletClearance,l={groups:[{id:'rack',kind:'rack',x:6000,y:6000,w:3000,h:1200,objects:[{id:'rack:1',kind:'rack',dx:0,dy:0,w:3000,h:1200,rotation:0}]},{id:'floor',kind:'ground',x:10000,y:6000,w:1000,h:1200,objects:[{id:'floor:1',kind:'ground',dx:0,dy:0,w:1000,h:1200,rotation:0,quantity:1}]}],env:{},options:{}};
 l.aisles=[{points:[[9000,0],[9000,6000],[6000,6000],[6000,0]]}];
 const p=M.snap(l,['floor'],-1000,0,settings,c+1,100);M.translate(l,['floor'],p.dx,p.dy);assert.equal(M.box(l.groups[1]).minX-M.box(l.groups[0]).maxX,c);
 const n=M.clone(l.groups[1]);n.id='floor2';n.x+=1000+500;n.objects[0].id='floor:2';l.groups.push(n);const q=M.snap(l,['floor2'],-500,0,settings,c+1,100);M.translate(l,['floor2'],q.dx,q.dy);assert.equal(M.box(n).minX-M.box(l.groups[1]).maxX,c);
});
test('Rotated footprints with overlapping bounding boxes do not produce false overlap errors',()=>{
 const l=M.clone(base),g=l.groups[0];g.frame={angle:Math.PI/4,sx:1,sy:1};g.x=10000;g.y=10000;g.objects=[{id:'ground:test1',kind:'ground',pn:'QA',dx:0,dy:0,w:1200,h:1000,quantity:1,height:1000,stacking:1,rotation:0},{id:'ground:test2',kind:'ground',pn:'QA',dx:1300,dy:0,w:1200,h:1000,quantity:1,height:1000,stacking:1,rotation:0}];g.kind='ground';g.w=2500;g.h=1000;l.groups=[g];const v=M.validate(l,plan,settings,geometry);assert(!v.errors.some(e=>e.message.startsWith('ground:test')||e.message.startsWith('Storage clearance between')));
});
async function damagedGround(){const s={...settings,maxFloorRowDepth:4000},p=D.calculateImplementation([{...parts[0],consumptionPerShift:6}],s,{greenfield:true,storageMode:'ground'}),l=(await O.optimize(p,s,geometry,{...options,storageMode:'ground'})).layout;const g=l.groups.find(g=>g.kind==='ground'&&g.objects.length>2),row=g.groundRows.find(r=>r.objectIds.length>1),objects=g.objects.filter(o=>row.objectIds.includes(o.id)).sort((a,b)=>a.dy-b.dy);assert(objects.length>1);objects[1].dy=objects[0].dy+objects[0].h+41;return {l,p,s,g};}
test('Fix Errors restores missing clearance inside ground blocks without losing assignments',async()=>{
 const {l,p,s}=await damagedGround(),h=M.session(l),before=M.clone(l),inventory=()=>l.groups.flatMap(g=>g.objects).map(o=>[o.id,o.pn,o.quantity,o.w,o.h]).sort();const stock=inventory();h.checkpoint();
 assert(M.validate(l,p,s,geometry).errors.some(e=>e.code==='storage-clearance'));const result=await M.fixErrors(l,p,s,geometry);assert(result.changes>0);assert(!l.manualValidation.errors.some(e=>e.code==='storage-clearance'||e.code==='storage-overlap'));assert.deepEqual(inventory(),stock);assert(h.undo());assert.deepEqual(l,before);assert(h.redo());assert.deepEqual(inventory(),stock);
});
test('Fix Errors is a no-op for valid layouts and respects fixed infrastructure',async()=>{
 const l=M.clone(base),positions=JSON.stringify(l.groups);let r=await M.fixErrors(l,plan,settings,geometry);assert.equal(r.changes,0);assert.equal(JSON.stringify(l.groups),positions);
 const f=await damagedGround();for(const g of f.l.groups)g.existing=true;const fixed=JSON.stringify(f.l.groups);r=await M.fixErrors(f.l,f.p,f.s,geometry);assert.equal(r.changes,0);assert.equal(JSON.stringify(f.l.groups),fixed);assert(r.remaining>0);
});
test('Fix Errors can separate colliding rack bays without changing assigned parts',async()=>{
 const p=D.calculateImplementation([{...parts[0],consumptionPerShift:80}],settings,{greenfield:true,improvementThreshold:100}),l=(await O.optimize(p,settings,geometry,options)).layout,g=l.groups.find(g=>g.kind==='rack'&&g.objects.length>1);assert(g);const id=M.split(l,g.objects[0].id),a=l.groups.find(g=>g.id===id),b=l.groups.find(g=>g.id!==id&&g.kind==='rack'),pos=L.placedObjects(a)[0].center,target=L.placedObjects(b)[0].center;M.translate(l,[id],target[0]-pos[0],target[1]-pos[1]);const assignments=JSON.stringify(l.groups.flatMap(g=>g.objects).map(o=>[o.id,o.allocations]).sort());
 assert(M.validate(l,p,settings,geometry).errors.some(e=>e.code==='storage-overlap'));const result=await M.fixErrors(l,p,settings,geometry);assert(result.changes>0);assert(!l.manualValidation.errors.some(e=>e.code==='storage-overlap'));assert.equal(JSON.stringify(l.groups.flatMap(g=>g.objects).map(o=>[o.id,o.allocations]).sort()),assignments);
});
test('Selecting a ground row moves only that row, preserving spacing, assignments and Undo',async()=>{
 for(const rotated of [false,true])for(const angle of [0,Math.PI/6]){
  const {l,g}=await damagedGround();g.rotated=rotated;g.frame={angle,sx:1,sy:1};const chosen=g.groundRows[0],ids=new Set(chosen.objectIds),before=new Map(L.cadObjects(l).map(o=>[o.id,o])),snapshot=M.clone(l),h=M.session(l);h.checkpoint();
  const id=M.split(l,chosen.objectIds[0]),row=l.groups.find(v=>v.id===id);assert(row.manualRow);assert.deepEqual(new Set(row.objects.map(o=>o.id)),ids);assert(row.objects.length<g.objects.length);
  for(const o of L.cadObjects(l)){const p=before.get(o.id);o.points.forEach((v,i)=>{assert(Math.abs(v[0]-p.points[i][0])<.001);assert(Math.abs(v[1]-p.points[i][1])<.001);});}
  M.translate(l,[id],321,456);
  for(const o of L.cadObjects(l)){const p=before.get(o.id),dx=ids.has(o.id)?321:0,dy=ids.has(o.id)?456:0;assert(Math.abs(o.center[0]-p.center[0]-dx)<.2);assert(Math.abs(o.center[1]-p.center[1]-dy)<.2);assert.equal(o.quantity,p.quantity);assert.equal(o.w,p.w);assert.equal(o.h,p.h);}
  const moved=M.clone(l);assert(h.undo());assert.deepEqual(l,snapshot);assert(h.redo());assert.deepEqual(l,moved);assert.deepEqual(L.cadObjects(JSON.parse(JSON.stringify(l))),L.cadObjects(l));
 }
});
test('Isolated ground rows retain their original access side without an artificial block overlap',async()=>{
 const {l,p,s,g}=await damagedGround();const a=g.groundRows[0];M.split(l,a.objectIds[0]);const result=M.validate(l,p,s,geometry);assert(!result.errors.some(e=>e.message.includes('Single ground rows must')));assert(!result.errors.some(e=>e.message.includes('required accessible face')));
});
test('Pointer drag moves one ground row instead of the complete block',async()=>{
 const {JSDOM}=require('../.tooling/qa/node_modules/jsdom'),fs=require('fs'),f=await damagedGround(),before=new Map(L.cadObjects(f.l).map(o=>[o.id,o])),row=f.g.groundRows[0],ids=new Set(row.objectIds),dom=new JSDOM('<!doctype html><body></body>',{runScripts:'outside-only',url:'https://example.test'}),w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.dispatchEvent(new w.Event('close'))};w.SVGSVGElement.prototype.createSVGPoint=function(){return {x:0,y:0,matrixTransform(){return {x:this.x,y:this.y}}}};w.SVGSVGElement.prototype.getScreenCTM=function(){return {inverse(){return {}}}};w.SVGSVGElement.prototype.setPointerCapture=function(){};w.SVGSVGElement.prototype.hasPointerCapture=function(){return false};
 for(const file of ['vendor/clipper.js','domain.js','layout.js','warehouse-geometry.js','layout-optimizer.js','existing-layout.js','manual-layout.js','layout-ui.js'])w.eval(fs.readFileSync(__dirname+'/'+file,'utf8'));
 let saved;const d=w.LogEnLayoutUI.open({plan:f.p,settings:f.s,geometry:M.clone(geometry),options:{...options,storageMode:'ground'},saved:f.l,name:'Row drag',onSave:async v=>{saved=v}}),svg=d.querySelector('.layout-canvas');const rowButton=d.querySelector('[data-manual="move-row"]');assert(rowButton);rowButton.click();d.querySelector('[data-manual="snap"]').click();
 d.querySelector('[data-object="'+row.objectIds[0]+'"]').dispatchEvent(new w.MouseEvent('pointerdown',{bubbles:true,button:0,clientX:1000,clientY:1000}));
 svg.dispatchEvent(new w.MouseEvent('pointermove',{bubbles:true,clientX:1321,clientY:544}));svg.dispatchEvent(new w.MouseEvent('pointerup',{bubbles:true,clientX:1321,clientY:544}));
 d.querySelector('[data-layout-save]').click();await new Promise(r=>setTimeout(r,5));assert(saved?.layout);
 for(const o of L.cadObjects(saved.layout)){const original=before.get(o.id);assert(Math.abs(o.center[0]-original.center[0]-(ids.has(o.id)?321:0))<.2);assert(Math.abs(o.center[1]-original.center[1]-(ids.has(o.id)?456:0))<.2);}
 d.close();dom.window.close();
});
test('Older saved 3-by-7 grids select only the clicked three-box line',()=>{
 for(const rotated of [false,true]){
  const g={id:'saved-grid',kind:'ground',manualRow:true,x:6000,y:7000,w:7000,h:3900,rotated,frame:{angle:Math.PI/6,sx:1,sy:1},objects:[]};
  for(let col=0;col<7;col++)for(let row=0;row<3;row++)g.objects.push({id:`box:${col}:${row}`,kind:'ground',pn:'PN-'+row,dx:col*1000+50,dy:row*1300+50,w:900,h:1200,quantity:1,stacking:1,rotation:0});
  g.groundRows=[{id:'old-grid-row',x:0,y:0,w:7000,h:3900,side:'front',objectIds:g.objects.map(o=>o.id)}];
  const l={groups:[g],unplaced:[]},before=new Map(L.cadObjects(l).map(o=>[o.id,o])),id=M.split(l,'box:0:1'),selected=l.groups.find(g=>g.id===id);assert.equal(selected.objects.length,3);assert(selected.objects.every(o=>o.id.startsWith('box:0:')));M.translate(l,[id],-1500,0);
  for(const o of L.cadObjects(l)){const p=before.get(o.id);assert(Math.abs(o.center[0]-p.center[0]-(o.id.startsWith('box:0:')?-1500:0))<.2);assert(Math.abs(o.center[1]-p.center[1])<.2);assert.equal(o.quantity,p.quantity);}
 }
});
