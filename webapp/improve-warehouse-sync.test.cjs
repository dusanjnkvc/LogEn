const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM,VirtualConsole}=require('../.tooling/qa/node_modules/jsdom');
require('./domain'); const D=LogEnDomain;
const settings={...D.createDefaultSettings(),shiftsPerDay:1,coverageMode:'custom',customCoverageDays:1};
const part=(pn,n,category='Bulk')=>({partNumber:pn,category,qtyBox:1,qtyOnPallet:1,consumptionPerShift:n,doh:1,length:1200,width:800,height:1000,stacking:1,inputErrors:[]});
const parts=[part('ONE',1),part('TWO',2),part('THREE',3),part('PULL',2,'Pull')];
for(const greenfield of [true,false])test('Automatic uses Overview split and ignores old overrides, greenfield='+greenfield,()=>{
 for(const category of [null,'Bulk','Pull'])for(const threshold of [0,2,3]){
  const split=D.calculateStorageSplit(parts,settings,threshold,category),config={greenfield,storageMode:'auto',improvementThreshold:threshold,storageOverrides:{ONE:'ground',THREE:'rack'},useExistingRacks:true,existingRacks:[]},before=JSON.stringify(config),plan=D.calculateImplementation(parts,settings,config,category);
  assert(plan.available);assert.equal(plan.assignmentSource,'improve-warehouse');
  assert.deepEqual(plan.rows.filter(r=>r.rackPallets>0).map(r=>r.input.partNumber).sort(),split.rackRows.map(r=>r.input.partNumber).sort());
  assert.deepEqual(plan.rows.filter(r=>r.groundPallets>0).map(r=>r.input.partNumber).sort(),split.groundRows.map(r=>r.input.partNumber).sort());
  assert.equal(plan.rackPallets,split.rackPallets);assert.equal(plan.groundPallets,split.groundPallets);
  assert.equal(plan.rack.withoutGangways,split.rack.rackWithoutGangways);assert.equal(plan.groundWithoutGangways,split.groundWithoutGangways);assert.equal(JSON.stringify(config),before);
 }
});
test('Manual, all-ground and all-racks remain explicit choices',()=>{
 const base={greenfield:true,improvementThreshold:2};
 assert.equal(D.calculateImplementation(parts,settings,{...base,storageMode:'ground'}).groundPallets,8);
 assert.equal(D.calculateImplementation(parts,settings,{...base,storageMode:'rack'}).rackPallets,8);
 const m=D.calculateImplementation(parts,settings,{...base,storageMode:'manual',storageOverrides:{ONE:'ground',THREE:'rack'}});
 assert.equal(m.rows.find(r=>r.input.partNumber==='ONE').groundPallets,1);assert.equal(m.rows.find(r=>r.input.partNumber==='THREE').rackPallets,3);
});
test('Overview threshold and category changes appear in Designer; switching Automatic clears overrides',async t=>{
 const vc=new VirtualConsole(),errors=[];vc.on('jsdomError',e=>errors.push(e));
 const html=fs.readFileSync(__dirname+'/index.html','utf8').replace('__STYLES__','').replace('__SCRIPTS__','');
 const dom=new JSDOM(html,{url:'https://logen.test/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc}),w=dom.window; t.after(()=>w.close());
 w.scrollTo=()=>{};w.ExcelJS=require('./vendor/exceljs.min');w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
 w.localStorage.setItem('logen.offline.workspace.v1',JSON.stringify({version:3,activeId:'sync',projects:[{id:'sync',name:'Sync',parts,settings,implementation:{greenfield:true,storageMode:'auto',storageOverrides:{ONE:'ground',THREE:'rack'}}}]}));
 for(const file of ['domain.js','workbook.js','editors.js','app.js'])w.eval(fs.readFileSync(__dirname+'/'+file,'utf8'));
 const $=s=>{const e=w.document.querySelector(s);assert(e,s);return e;},change=(s,v,type='change')=>{const e=$(s);e.value=v;e.dispatchEvent(new w.Event(type,{bubbles:true}));},designer=()=>Object.fromEntries([...w.document.querySelectorAll('[data-storage-pn]')].map(e=>[e.dataset.storagePn,e.value]));
 change('#category-filter',JSON.stringify('Bulk'));$('[data-action="improve-warehouse"]').click();change('#rack-planning-threshold','3','input');
 const overview=Object.fromEntries([...w.document.querySelectorAll('[data-improvement-pn]')].map(e=>[e.dataset.improvementPn,e.dataset.improvementStorage]));
 $('[data-split-close]').click();$('[data-view="implementation"]').click();assert.deepEqual(designer(),overview);
 change('[data-storage-pn="THREE"]','ground');await new Promise(r=>setTimeout(r,10));assert.equal($('#implementation-storage-mode').value,'manual');
 change('#implementation-storage-mode','auto');await new Promise(r=>setTimeout(r,10));assert.deepEqual(designer(),overview);
 const saved=JSON.parse(w.localStorage.getItem('logen.offline.workspace.v1')).projects[0];assert.deepEqual(saved.implementation.storageOverrides,{});assert.equal(saved.improvementThreshold,3);assert.deepEqual(errors,[]);
});

test('Existing Layout follows the Overview list and respects construction OFF',async()=>{
 global.ClipperLib=require('./vendor/clipper');require('./layout');require('./layout-optimizer');require('./existing-layout');
 const rect=(id,x,y,w,h)=>({id,layer:id,type:'LWPOLYLINE',closed:true,boundaryEligible:true,points:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]],bounds:[x,y,x+w,y+h]});
 const geometry={units:4,entities:[rect('B',0,0,40000,30000),rect('R',5000,5000,5700,1400),rect('G',15000,5000,6000,5000),rect('A',5000,500,16000,4500)]};
 const plan=D.calculateImplementation(parts,settings,{greenfield:false,storageMode:'auto',improvementThreshold:2}),options={scale:1,boundaryId:'B',obstacleClearance:0,existingMode:true,allowNewStorageConstruction:false,geometryReviewed:true,constraintsConfirmed:true,entityRoles:{R:'existing-rack',G:'existing-ground',A:'gangway'},existingStorage:{R:{bays:2,positionsPerLevel:2}},storageMode:'auto',storageOverrides:{ONE:'ground',THREE:'rack'}};
 const snapshot=JSON.stringify(geometry),result=(await LogEnExistingLayout.generate(plan,settings,geometry,options)).layout;
 assert(result.accessValid,JSON.stringify(result.issues));assert.equal(result.targets.ONE,'rack');assert.equal(result.targets.TWO,'rack');assert.equal(result.targets.THREE,'ground');assert.equal(result.targets.PULL,'rack');
 assert(result.groups.every(g=>g.existing));assert.equal(result.stats.existingRackAllocated,5);assert.equal(result.stats.newRackPositions,0);assert.equal(JSON.stringify(geometry),snapshot);
 const key=LogEnLayout.sourceKey(plan,settings,{greenfield:false,storageMode:'auto'},'drawing-v1');assert.equal(JSON.parse(key).assignmentSource,'improve-warehouse');assert.equal(JSON.parse(key).assignmentVersion,1);
});
