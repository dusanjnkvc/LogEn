const assert=require('node:assert/strict');require('../webapp/domain.js');const D=global.LogEnDomain;
function near(a,b){assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);}
const a=D.calculateBoxRack(10,1200,1000,1000,2700,1100,1100,5);
assert.equal(a.fits,true);assert.equal(a.boxesPerSlot,2);assert.equal(a.capacityPerBay,10);assert.equal(a.bays,1);near(a.withoutGangways,2.97);near(a.availableShelfArea,14.85);near(a.occupiedShelfArea,12);near(a.unusedShelfArea,2.85);near(a.utilizationPercent,80.8080808080808);
const b=D.calculateBoxRack(10,2000,1000,1000,2700,1100,1100,5);
assert.equal(b.boxesPerSlot,1);assert.equal(b.bays,2);near(b.withoutGangways,5.94);near(b.availableShelfArea,29.7);near(b.occupiedShelfArea,20);near(b.unusedShelfArea,9.7);near(b.unusedPerLevel,1.94);near(b.utilizationPercent,67.3400673400673);
const c=D.calculateBoxRack(10,2800,1200,1000,2700,1100,1100,5);assert.equal(c.fits,false);assert.equal(c.bays,0);assert.equal(c.nonFittingBoxes,10);assert.equal(c.utilizationPercent,null);
console.log('Rack examples A/B/C pass: 2.97 / 5.94 m², shelf waste and utilization match.');
// Integration: Required storage pallets feed the rack engine; ground sizing remains independent.
const fs=require('node:fs');
const settings={...D.createDefaultSettings(),shiftsPerDay:1,rackSlotLength:2700,rackSlotDepth:1100,rackSlotHeight:1100,rackLevels:5};
const input=(partNumber,length)=>({partNumber,qtyBox:20,qtyOnPallet:40,consumptionPerShift:800,doh:10,length,width:1000,height:1000,stacking:1});
const project=D.calculateProject([input('A',1200),input('B',2000),{...input('C',2800),width:1200}],settings);
assert.equal(project.results[0].requiredPallets,10);near(project.results[0].rack.withoutGangways,2.97);near(project.results[1].rack.withoutGangways,5.94);assert.equal(project.results[2].rackFit,'NO');assert.equal(project.nonFittingPallets,10);near(project.rackWithoutGangways,8.91);near(project.rackUnusedShelfArea,12.55);near(project.rackUtilizationPercent,32/44.55*100);
assert.ok(project.results[2].floor);assert.equal(project.results[0].rack.bays,1);assert.equal(project.results[1].rack.bays,2);
const rotation=D.calculatePart({...input('ROTATE',1100),width:900},{...settings,rackSlotLength:1800,rackSlotDepth:1100,allowRotation:false});assert.equal(rotation.rack.boxesPerSlot,2);assert.equal(rotation.rack.rotated,true);
const depth=D.calculateBoxRack(10,500,400,500,2700,1100,1100,5);assert.equal(depth.boxesPerSlot,12);
const zero=D.calculateBoxRack(0,1200,1000,1000,2700,1100,1100,5);assert.equal(zero.bays,0);assert.equal(zero.utilizationPercent,null);
const {JSDOM}=require('../.tooling/qa/node_modules/jsdom');
const dom=new JSDOM(fs.readFileSync('webapp/index.html','utf8').replace('__SCRIPTS__','').replace('__STYLES__',''),{url:'https://logen.test',runScripts:'outside-only'});const w=dom.window;w.scrollTo=()=>{};w.ExcelJS=require('../webapp/vendor/exceljs.min.js');w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
w.localStorage.setItem('logen.offline.workspace.v1',JSON.stringify({version:3,activeId:'qa',projects:[{id:'qa',name:'QA',parts:[input('A',1200),input('B',2000)],settings}]}));for(const f of ['domain','workbook','editors','app'])w.eval(fs.readFileSync('webapp/'+f+'.js','utf8'));
w.document.querySelector('[data-view="parts"]').click();const headers=[...w.document.querySelectorAll('#parts-table thead th')].map(x=>x.textContent);
for(const h of ['Rack Fit','Boxes per Rack Slot','Required Rack Bays','Rack SQM Without Gangways','Unused Rack Surface (m²)','Rack Utilization (%)'])assert.ok(headers.includes(h),h);
assert.equal(w.document.querySelector('#parts-table tbody tr').children.length,headers.length);assert.ok(w.document.querySelector('#parts-table tfoot'));
(async()=>{global.ExcelJS=w.ExcelJS;const S=require('../webapp/workbook.js');const bytes=await new S().exportBytes({name:'QA',parts:[input('A',1200),input('B',2000)],settings},project);const book=new global.ExcelJS.Workbook();await book.xlsx.load(bytes);const sheet=book.getWorksheet('Rack Calculations');const hs=sheet.getRow(1).values;const col=hs.indexOf('Unused Rack Surface (m²)');assert.ok(col>0);near(sheet.getRow(2).getCell(col).value,2.85);const uc=hs.indexOf('Rack Utilization (%)');near(sheet.getRow(3).getCell(uc).value,67.3400673400673);w.close();console.log('Rack integration checks pass: quantity mapping, both orientations, depth grids, zero/non-fit, weighted totals, table and XLSX.');})().catch(e=>{console.error(e);process.exitCode=1;});
