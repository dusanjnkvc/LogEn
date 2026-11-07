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
