/* DOM integration tests; synthetic inventory only, no browser or network. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('../.tooling/qa/node_modules/jsdom');
const ExcelJS = require('./vendor/exceljs.min.js');
require('./domain.js');
const D = globalThis.LogEnDomain;
const KEY = 'logen.offline.workspace.v1';
const scripts = ['domain.js', 'workbook.js', 'editors.js', 'app.js'].map(name => ({ name, source: fs.readFileSync(path.join(__dirname, name), 'utf8') }));
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
  .replace('__STYLES__', '').replace('__SCRIPTS__', '').replaceAll('__LOGO__', 'data:image/png;base64,');

function part(changes = {}) {
  return { partNumber: 'QA-001', qtyBox: 20, qtyOnPallet: 40, consumptionPerShift: 500,
    doh: 5, length: 1200, width: 800, height: 1000, stacking: 1, inputErrors: [], ...changes };
}
function workspace({ parts = [part()], settings = {}, version = 3, id = 'qa-warehouse', name = 'QA warehouse' } = {}) {
  return { version, activeId: id, projects: [{ id, name, parts, settings: { ...D.createDefaultSettings(), ...settings },
    rawInputRows: null, sourceName: 'Synthetic QA inventory', updatedAt: '2026-10-27T08:00:00.000Z' }] };
}
function legacyWorkspace() {
  return workspace({ version: 1, parts: [{ partNumber: 'LEGACY-QA', qtyBox: 20, qtyPallet: 7, qtyOnPallet: 40,
    consumption: 1000, doh: 5, length: 1200, width: 800, height: 1000, stacking: 3, inputErrors: [] }] });
}
function boot(t, initial = workspace()) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(html, { url: 'https://logen.test/offline-calculator.html', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: console });
  const w = dom.window;
  const downloads = [];
  const blobs = new Map();
  w.ExcelJS = ExcelJS;
  w.fetch = () => { errors.push(new Error('Unexpected network request')); return Promise.reject(new Error('Network disabled for offline QA')); };
  w.scrollTo = () => {};
  w.console.error = (...args) => errors.push(args[0]);
  w.URL.createObjectURL = blob => { const url = `blob:logen-qa-${blobs.size + 1}`; blobs.set(url, blob); return url; };
  w.URL.revokeObjectURL = url => blobs.delete(url);
  w.HTMLAnchorElement.prototype.click = function () { downloads.push({ filename: this.download, url: this.href }); };
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  w.HTMLDialogElement.prototype.close = function (value = '') { this.returnValue = value; this.removeAttribute('open'); this.dispatchEvent(new w.Event('close')); };
  if (initial !== null) w.localStorage.setItem(KEY, typeof initial === 'string' ? initial : JSON.stringify(initial));
  for (const script of scripts) w.eval(script.source + `\n//# sourceURL=LogEn-${script.name}`);
  t.after(() => w.close());
  const $ = selector => { const element = w.document.querySelector(selector); assert.ok(element, `Missing UI element ${selector}`); return element; };
  return {
    w, $, downloads, errors, blobFor: url => blobs.get(url),
    state: () => JSON.parse(w.localStorage.getItem(KEY)),
    click: selector => $(selector).click(),
    input(selector, value) { const element = $(selector); element.value = String(value); element.dispatchEvent(new w.Event('input', { bubbles: true })); },
    change(selector, value) { const element = $(selector); element.value = value; element.dispatchEvent(new w.Event('change', { bubbles: true })); },
    file(selector, file) { const element = $(selector); Object.defineProperty(element, 'files', { configurable: true, value: [file] }); element.dispatchEvent(new w.Event('change', { bubbles: true })); },
    submit() { $('dialog form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); },
    kpis() { return [...w.document.querySelectorAll('.kpi-value')].map(element => element.firstChild.textContent.trim()); },
    metric(label) { const item = [...w.document.querySelectorAll('.production-totals > div')].find(element => element.querySelector('span').textContent === label); assert.ok(item, `Missing production metric ${label}`); return item.querySelector('strong').textContent; },
    cell(header, rowIndex = 0) { const table = $('#consumption-table table'); const columns = [...table.querySelectorAll('thead th')].map(cell => cell.textContent.trim()); const index = columns.indexOf(header); assert.ok(index >= 0, `Missing table column ${header}`); return table.querySelectorAll('tbody tr')[rowIndex].children[index].textContent.trim(); },
  };
}
async function until(predicate, description, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `Timed out waiting for ${description}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
function previewMetric(ui, label) {
  const item = [...ui.w.document.querySelectorAll('dialog .preview-metric')].find(element => element.querySelector('span').textContent === label);
  assert.ok(item, `Missing editor preview ${label}`);
  return item.querySelector('strong').textContent;
}
function blobText(ui, blob) {
  return new Promise((resolve, reject) => {
    const reader = new ui.w.FileReader();
    reader.addEventListener('load', () => resolve(reader.result));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsText(blob);
  });
}

function monthlyWorkspace() {
  return workspace({version:2,parts:[{partNumber:'MONTHLY-QA',stockQty:5600,partsPerPallet:800,
    monthlyConsumption:22000,providedCoverageDays:5,length:1200,width:800,height:1000,stacking:3,inputErrors:[]}]});
}
function select(ui, selector, value) {
  ui.input(selector, value);
  ui.change(selector, String(value));
}
function formulaText(ui, label) {
  const box=[...ui.w.document.querySelectorAll('dialog .formula-box')].find(element=>element.querySelector('strong')?.textContent===label);
  assert.ok(box,'Missing detail formula '+label);
  return box.textContent;
}

test('shift inventory renders the same ten required pallets in both warehouse scenarios', t=>{
  const ui=boot(t);
  assert.deepEqual(ui.kpis(),['11.34','27.54','7.98','33.63']);
  assert.equal(ui.metric('Consumption per shift'),'500.00');
  assert.equal(ui.metric('Daily consumption'),'1,000.00');
  assert.equal(ui.metric('Rounded planning demand'),'2');
  assert.equal(ui.metric('Required storage pallets'),'10');
  assert.match(ui.$('#main').textContent,/ROUNDUP\(Consumption per shift/);
  assert.equal(ui.w.document.querySelector('#production-workingDaysPerMonth'),null);
  ui.click('[data-view="consumption"]');
  assert.equal(ui.cell('QTY in Box'),'20');
  assert.equal(ui.cell('QTY boxes per Pallet'),'40');
  assert.equal(ui.cell('Pallets / shift (decimal)'),'0.625');
  assert.equal(ui.cell('Rounded pallets / shift'),'1');
  assert.equal(ui.cell('Input DOH'),'5.00');
  assert.equal(ui.cell('Used DOH'),'5.00');
  assert.equal(ui.cell('Required pallets'),'10');
  assert.equal(ui.cell('Floor storage m²'),'11.34');
  assert.deepEqual(ui.errors,[]);
});

test('first launch creates version-three shift examples with local resources only',t=>{
  const ui=boot(t,null);
  const saved=ui.state();
  assert.equal(saved.version,3);
  assert.equal(saved.projects[0].parts.length,6);
  assert.equal(saved.projects[0].parts[0].qtyBox,20);
  assert.equal(saved.projects[0].parts[0].qtyOnPallet,40);
  assert.equal(saved.projects[0].parts[0].consumptionPerShift,500);
  assert.equal(ui.w.document.querySelectorAll('.kpi-card').length,4);
  assert.ok(ui.kpis().every(value=>value!=='—'));
  assert.deepEqual(ui.errors,[]);
});

test('version-one daily data migrates once and remains fixed per shift when shifts change',t=>{
  const ui=boot(t,legacyWorkspace());
  assert.equal(ui.state().version,3);
  assert.equal(ui.state().projects[0].parts[0].consumptionPerShift,500);
  assert.equal(ui.state().projects[0].parts[0].stockQty,5600);
  assert.equal(ui.state().projects[0].parts[0].qtyBox,20);
  select(ui,'#production-shiftsPerDay',3);
  assert.equal(ui.state().projects[0].parts[0].consumptionPerShift,500);
  assert.equal(ui.metric('Daily consumption'),'1,500.00');
  assert.equal(ui.metric('Required storage pallets'),'15');
  assert.deepEqual(ui.errors,[]);
});

test('version-two monthly data migrates once with a visible inferred-packaging warning',t=>{
  const ui=boot(t,monthlyWorkspace());
  const migrated=ui.state().projects[0].parts[0];
  assert.equal(ui.state().version,3);
  assert.equal(migrated.consumptionPerShift,500);
  assert.equal(migrated.monthlyConsumption,22000);
  assert.equal(migrated.qtyBox,800);
  assert.equal(migrated.qtyOnPallet,1);
  assert.equal(migrated.packagingInferred,true);
  assert.match(ui.$('#main').textContent,/one box per pallet; review/);
  select(ui,'#production-shiftsPerDay',3);
  assert.equal(ui.state().projects[0].parts[0].consumptionPerShift,500);
  assert.equal(ui.state().projects[0].parts[0].monthlyConsumption,22000);
  assert.equal(ui.metric('Daily consumption'),'1,500.00');
  assert.equal(ui.metric('Required storage pallets'),'15');
  assert.deepEqual(ui.errors,[]);
});

test('one, two and three shifts multiply daily usage and required pallets without changing shift consumption',t=>{
  const ui=boot(t);
  select(ui,'#production-shiftsPerDay',1);
  assert.equal(ui.metric('Daily consumption'),'500.00');
  assert.equal(ui.metric('Required storage pallets'),'5');
  assert.deepEqual(ui.kpis(),['5.67','13.77','3.99','16.82']);
  select(ui,'#production-shiftsPerDay',3);
  assert.equal(ui.metric('Consumption per shift'),'500.00');
  assert.equal(ui.metric('Daily consumption'),'1,500.00');
  assert.equal(ui.metric('Required storage pallets'),'15');
  assert.deepEqual(ui.kpis(),['17.10','37.35','7.98','33.63']);
  ui.click('[data-view="consumption"]');
  assert.equal(ui.cell('Consumption / shift'),'500.00');
  assert.equal(ui.cell('Shifts / day'),'3');
  assert.deepEqual(ui.errors,[]);
});

test('rounding happens before multiplying by DOH and shifts rather than rounding combined consumption',t=>{
  const ui=boot(t,workspace({parts:[part({consumptionPerShift:1000})]}));
  ui.click('[data-view="consumption"]');
  assert.equal(ui.cell('Pallets / shift (decimal)'),'1.25');
  assert.equal(ui.cell('Rounded pallets / shift'),'2');
  assert.equal(ui.cell('Planning pallets / day'),'4');
  assert.equal(ui.cell('Required pallets'),'20');
  assert.notEqual(ui.cell('Required pallets'),'13');
  ui.click('[data-detail="0"]');
  assert.match(formulaText(ui,'Round up for one shift first'),/2 pallets\/shift/);
  assert.match(formulaText(ui,'Required pallets · used in both scenarios'),/CEILING\(2 × 5 × 2\)/);
  assert.deepEqual(ui.errors,[]);
});

test('changing DOH override applies immediately and switching back preserves each Excel DOH',t=>{
  const ui=boot(t);
  select(ui,'#production-shiftsPerDay',3);
  ui.input('#production-customCoverageDays',7);
  assert.equal(ui.state().projects[0].settings.coverageMode,'custom');
  assert.equal(ui.metric('Required storage pallets'),'21');
  ui.click('[data-view="consumption"]');
  assert.equal(ui.cell('Input DOH'),'5.00');
  assert.equal(ui.cell('Used DOH'),'7.00');
  assert.equal(ui.cell('Required pallets'),'21');
  ui.change('#production-coverageMode','input');
  assert.equal(ui.cell('Used DOH'),'5.00');
  assert.equal(ui.cell('Required pallets'),'15');
  assert.deepEqual(ui.errors,[]);
});

test('parts use their own DOH until an all-parts override is selected',t=>{
  const ui=boot(t,workspace({parts:[part(),part({partNumber:'QA-002',doh:2})]}));
  ui.click('[data-view="consumption"]');
  assert.equal(ui.cell('Required pallets',0),'10');
  assert.equal(ui.cell('Required pallets',1),'4');
  ui.input('#production-customCoverageDays',3);
  assert.equal(ui.cell('Input DOH',0),'5.00');
  assert.equal(ui.cell('Input DOH',1),'2.00');
  assert.equal(ui.cell('Used DOH',0),'3.00');
  assert.equal(ui.cell('Used DOH',1),'3.00');
  assert.equal(ui.cell('Required pallets',0),'6');
  assert.equal(ui.cell('Required pallets',1),'6');
  assert.deepEqual(ui.errors,[]);
});

test('fractional DOH rounds the final storage count up and zero DOH requires zero pallets',t=>{
  const ui=boot(t,workspace({settings:{shiftsPerDay:3}}));
  ui.input('#production-customCoverageDays',0.25);
  assert.equal(ui.metric('Required storage pallets'),'1');
  assert.deepEqual(ui.kpis(),['1.08','5.13','3.99','16.82']);
  ui.input('#production-customCoverageDays',0);
  assert.deepEqual(ui.kpis(),['0.00','0.00','0.00','0.00']);
  assert.doesNotMatch(ui.$('#main').textContent,/Infinity|NaN/);
  assert.deepEqual(ui.errors,[]);
});

test('an invalid saved fourth shift is visibly rejected and can be corrected to three',t=>{
  const ui=boot(t,workspace({settings:{shiftsPerDay:4}}));
  assert.deepEqual(ui.kpis(),['—','—','—','—']);
  assert.match(ui.$('#main').textContent,/between 1 and 3|1, 2 or 3|1–3/);
  assert.equal(ui.$('#production-shiftsPerDay').value,'4');
  assert.deepEqual([...ui.$('#production-shiftsPerDay').options].filter(option=>!option.disabled).map(option=>option.value),['1','2','3']);
  select(ui,'#production-shiftsPerDay',3);
  assert.equal(ui.metric('Required storage pallets'),'15');
  assert.doesNotMatch(ui.$('#main').textContent,/Warehouse settings need attention/);
  assert.deepEqual(ui.errors,[]);
});

test('zero shift consumption and empty DOH settings recover without fabricated stock',t=>{
  const ui=boot(t,workspace({parts:[part({consumptionPerShift:0})]}));
  assert.deepEqual(ui.kpis(),['0.00','0.00','0.00','0.00']);
  ui.input('#production-customCoverageDays','');
  assert.match(ui.$('#main').textContent,/Warehouse settings need attention/);
  ui.input('#production-customCoverageDays',5);
  assert.equal(ui.metric('Daily consumption'),'0.00');
  ui.click('[data-view="consumption"]');
  assert.equal(ui.cell('Required pallets'),'0');
  ui.click('[data-detail="0"]');
  assert.match(formulaText(ui,'Current stock'),/not provided|N\/A/);
  assert.doesNotMatch(ui.$('dialog').textContent,/Infinity|NaN/);
  assert.deepEqual(ui.errors,[]);
});

test('restoring a legacy backup clears stale DOH drafts and preserves the migrated shift rate',async t=>{
  const ui=boot(t);
  ui.input('#production-customCoverageDays','');
  const backup=legacyWorkspace();
  backup.projects[0].settings.customCoverageDays=7;
  backup.projects[0].name='Restored synthetic warehouse';
  ui.file('#backup-input',{name:'qa-workspace.json',text:async()=>JSON.stringify(backup)});
  await until(()=>ui.w.document.querySelector('dialog [data-confirm]'),'restore confirmation');
  ui.click('dialog [data-confirm]');
  await until(()=>ui.w.document.querySelector('#production-customCoverageDays')?.value==='7','restored DOH controls');
  assert.equal(ui.state().version,3);
  assert.equal(ui.state().projects[0].parts[0].consumptionPerShift,500);
  assert.equal(ui.metric('Daily consumption'),'1,000.00');
  select(ui,'#production-shiftsPerDay',3);
  assert.equal(ui.metric('Daily consumption'),'1,500.00');
  assert.equal(ui.state().projects[0].parts[0].consumptionPerShift,500);
  assert.deepEqual(ui.errors,[]);
});

test('part editor previews per-shift rounding live and saves canonical packaging data',async t=>{
  const ui=boot(t);
  ui.click('[data-view="consumption"]');
  ui.click('[data-action="add"]');
  assert.equal(previewMetric(ui,'Raw pallets per shift'),'0.625 pallets/shift');
  assert.equal(previewMetric(ui,'Rounded pallets per shift'),'1 pallets/shift');
  assert.equal(previewMetric(ui,'Required pallets'),'10 pallets');
  ui.input('dialog input[type="text"]','QA-NEW');
  ui.input('dialog input[name="consumptionPerShift"]',1000);
  assert.equal(previewMetric(ui,'Raw pallets per shift'),'1.25 pallets/shift');
  assert.equal(previewMetric(ui,'Rounded pallets per shift'),'2 pallets/shift');
  assert.equal(previewMetric(ui,'Required pallets'),'20 pallets');
  ui.submit();
  await until(()=>ui.state().projects[0].parts.length===2,'canonical part save');
  const saved=ui.state().projects[0].parts[1];
  assert.equal(saved.partNumber,'QA-NEW');
  assert.equal(saved.qtyBox,20);
  assert.equal(saved.qtyOnPallet,40);
  assert.equal(saved.consumptionPerShift,1000);
  assert.equal(saved.doh,5);
  assert.equal(saved.stacking,1);
  assert.equal(saved.stockQty??null,null);
  assert.equal(saved.packagingInferred,false);
  assert.equal(saved.shiftModelMigrated,false);
  assert.deepEqual(ui.errors,[]);
});

test('reviewing inferred packaging clears the migration warning without losing optional historical stock',async t=>{
  const ui=boot(t,monthlyWorkspace());
  ui.click('[data-view="parts"]');
  ui.click('[data-edit="0"]');
  ui.input('dialog input[name="qtyBox"]',20);
  ui.input('dialog input[name="qtyOnPallet"]',40);
  ui.submit();
  await until(()=>ui.state().projects[0].parts[0].packagingInferred===false,'reviewed packaging save');
  const saved=ui.state().projects[0].parts[0];
  assert.equal(saved.stockQty,5600);
  assert.equal(saved.monthlyConsumption,22000);
  assert.equal(saved.consumptionPerShift,500);
  ui.click('[data-view="dashboard"]');
  assert.doesNotMatch(ui.$('#main').textContent,/one box per pallet; review/);
  assert.deepEqual(ui.errors,[]);
});

test('unrestricted floor depth changes occupied rows without changing rack footprints',async t=>{
  const ui=boot(t);
  assert.deepEqual(ui.kpis(),['11.34','27.54','7.98','33.63']);
  ui.click('#settings-nav');
  ui.input('dialog input[name="maxFloorRowDepth"]',0);
  ui.submit();
  await until(()=>ui.state().projects[0].settings.maxFloorRowDepth===0,'unrestricted floor save');
  assert.deepEqual(ui.kpis(),['11.61','15.66','7.98','33.63']);
  assert.deepEqual(ui.errors,[]);
});

test('tiny nonzero shift rates remain inspectable while planning rounds each shift to one pallet',t=>{
  const ui=boot(t,workspace({parts:[part({consumptionPerShift:1e-20})]}));
  ui.click('[data-view="consumption"]');
  assert.match(ui.cell('Consumption / shift'),/e-20/);
  assert.match(ui.cell('Pallets / shift (decimal)'),/e-23/);
  assert.equal(ui.cell('Rounded pallets / shift'),'1');
  assert.equal(ui.cell('Required pallets'),'10');
  ui.click('[data-detail="0"]');
  assert.match(formulaText(ui,'Raw pallets per shift'),/e-20|e-23/);
  assert.deepEqual(ui.errors,[]);
});

test('the exact eight-column workbook imports through confirmation and uses default stacking one',async t=>{
  const ui=boot(t);
  const workbook=new ExcelJS.Workbook();
  const expected=['Part Number','QTY in Box','QTY boxes per Pallet','Consumption per shift','DOH (Days on hand)','L(mm)','W(mm)','H(mm)'];
  assert.deepEqual(Array.from(ui.w.LogEnWorkbook.headers),expected);
  workbook.addWorksheet('Input Data').addRows([expected,['IMPORTED-QA',20,40,1000,5,1200,800,1000]]);
  const bytes=new Uint8Array(await workbook.xlsx.writeBuffer());
  ui.file('#excel-input',{name:'qa-shift-inventory.xlsx',arrayBuffer:async()=>bytes});
  await until(()=>ui.w.document.querySelector('dialog [data-confirm]'),'Excel import preview');
  assert.match(ui.$('dialog').textContent,/qa-shift-inventory.xlsx.*1 part numbers/s);
  ui.click('dialog [data-confirm]');
  await until(()=>ui.state().projects[0].sourceName==='qa-shift-inventory.xlsx','shift import completion');
  const saved=ui.state().projects[0].parts[0];
  assert.equal(saved.consumptionPerShift,1000);
  assert.equal(saved.stacking,1);
  assert.equal(saved.stockQty,null);
  assert.equal(ui.state().projects[0].rawInputRows[1][3],1000);
  assert.equal(ui.metric('Required storage pallets'),'20');
  assert.equal(ui.metric('Daily consumption'),'2,000.00');
  assert.deepEqual(ui.kpis(),['22.77','51.12','11.97','50.45']);
  assert.deepEqual(ui.errors,[]);
});

test('template and result actions create only local shift-template and Excel downloads',async t=>{
  const ui=boot(t);
  ui.click('[data-action="template"]');
  await until(()=>ui.downloads.length===1,'shift template download');
  assert.equal(ui.downloads[0].filename,'LogEn_Shift_Inventory_Template.xlsx');
  ui.click('[data-action="export"]');
  await until(()=>ui.downloads.length===2,'result download');
  assert.equal(ui.downloads[1].filename,'QA_warehouse_LogEn_Results.xlsx');
  assert.ok(ui.downloads.every(item=>item.url.startsWith('blob:logen-qa-')));
  assert.deepEqual(ui.errors,[]);
});

test('corrupt saved data remains intact until a confirmed valid backup restores it',async t=>{
  const ui=boot(t,'{not valid json');
  assert.match(ui.$('#main').textContent,/Saved data needs attention/);
  assert.equal(ui.w.localStorage.getItem(KEY),'{not valid json');
  ui.file('#backup-input',{name:'qa-recovery.json',text:async()=>JSON.stringify(workspace())});
  await until(()=>ui.w.document.querySelector('dialog [data-confirm]'),'recovery confirmation');
  ui.click('dialog [data-confirm]');
  await until(()=>ui.w.document.querySelectorAll('.kpi-card').length===4,'recovered shift dashboard');
  assert.deepEqual(ui.kpis(),['11.34','27.54','7.98','33.63']);
  assert.equal(ui.w.localStorage.getItem(KEY+'.previous'),'{not valid json');
  assert.deepEqual(ui.errors,[]);
});

test('project deletion is visible and canceling confirmation leaves the workspace unchanged',async t=>{
  const ui=boot(t);
  ui.click('[data-view="projects"]');
  const button=ui.$('.project-card [data-delete-project="qa-warehouse"]');
  assert.equal(button.textContent.trim(),'Delete project');
  const before=ui.w.localStorage.getItem(KEY);
  button.click();
  assert.match(ui.$('dialog').textContent,/restore it later from Deleted projects/);
  ui.click('dialog [data-cancel]');
  await until(()=>!ui.w.document.querySelector('dialog'),'canceled deletion');
  assert.equal(ui.w.localStorage.getItem(KEY),before);
  assert.equal(ui.state().projects.length,1);
  assert.equal(ui.state().deletedProjects?.length??0,0);
  assert.deepEqual(ui.errors,[]);
});

test('active project deletion retains shift data and clears stale DOH drafts when selecting a survivor',async t=>{
  const initial=workspace();
  const survivor=workspace({id:'surviving-warehouse',name:'Surviving warehouse',settings:{shiftsPerDay:3,customCoverageDays:8},parts:[part({partNumber:'SURVIVOR-QA',consumptionPerShift:750})]}).projects[0];
  initial.projects.push(survivor);
  const ui=boot(t,initial);
  ui.input('#production-customCoverageDays',10);
  ui.click('[data-view="projects"]');
  ui.click('.project-card [data-delete-project="qa-warehouse"]');
  ui.click('dialog [data-confirm]');
  await until(()=>ui.state().projects.length===1,'active project deletion');
  const saved=ui.state();
  assert.equal(saved.activeId,survivor.id);
  assert.equal(saved.deletedProjects[0].parts[0].consumptionPerShift,500);
  assert.equal(saved.deletedProjects[0].settings.customCoverageDays,10);
  assert.ok(Number.isFinite(Date.parse(saved.deletedProjects[0].deletedAt)));
  ui.click('[data-view="dashboard"]');
  assert.equal(ui.$('#production-customCoverageDays').value,'8');
  assert.equal(ui.$('#production-shiftsPerDay').value,'3');
  assert.equal(ui.metric('Daily consumption'),'2,250.00');
  assert.deepEqual(ui.errors,[]);
});

test('deleting the final project creates empty defaults and restoring recovers inventory, DOH and shifts',async t=>{
  const initial=workspace({settings:{shiftsPerDay:3,customCoverageDays:7,coverageMode:'custom',gangwayWidth:3000}});
  initial.projects[0].sourceName='synthetic-source.xlsx';
  initial.projects[0].rawInputRows=[['Source marker'],['Preserved original input']];
  const ui=boot(t,initial);
  ui.click('[data-view="projects"]');
  ui.click('[data-delete-project="qa-warehouse"]');
  assert.match(ui.$('dialog').textContent,/empty warehouse project will be created/);
  ui.click('dialog [data-confirm]');
  await until(()=>ui.state().deletedProjects?.length===1,'final project deletion');
  const empty=ui.state().projects[0];
  assert.notEqual(empty.id,'qa-warehouse');
  assert.equal(empty.name,'New warehouse');
  assert.deepEqual(empty.parts,[]);
  assert.equal(empty.settings.shiftsPerDay,2);
  assert.equal(empty.settings.customCoverageDays,5);
  ui.click('[data-view="dashboard"]');
  assert.deepEqual(ui.kpis(),['0.00','0.00','0.00','0.00']);
  ui.input('#production-customCoverageDays',12);
  ui.click('[data-view="projects"]');
  ui.click('[data-restore-project="qa-warehouse"]');
  await until(()=>ui.state().activeId==='qa-warehouse','project restore');
  const restored=ui.state().projects.find(item=>item.id==='qa-warehouse');
  assert.equal(restored.parts[0].consumptionPerShift,500);
  assert.equal(restored.settings.shiftsPerDay,3);
  assert.equal(restored.settings.customCoverageDays,7);
  assert.equal(restored.settings.gangwayWidth,3000);
  assert.equal(restored.sourceName,'synthetic-source.xlsx');
  assert.deepEqual(restored.rawInputRows,initial.projects[0].rawInputRows);
  assert.equal(Object.hasOwn(restored,'deletedAt'),false);
  assert.equal(ui.$('#production-customCoverageDays').value,'7');
  assert.equal(ui.$('#production-shiftsPerDay').value,'3');
  assert.equal(ui.metric('Required storage pallets'),'21');
  assert.deepEqual(ui.errors,[]);
});

test('downloaded backups keep deleted shift projects and full restore behavior after JSON roundtrip',async t=>{
  const ui=boot(t);
  ui.click('[data-view="projects"]');
  ui.click('[data-delete-project="qa-warehouse"]');
  ui.click('dialog [data-confirm]');
  await until(()=>ui.state().deletedProjects?.length===1,'project trash');
  ui.click('[data-action="backup"]');
  assert.equal(ui.downloads[0].filename,'LogEn_Workspace_Backup.json');
  const text=await blobText(ui,ui.blobFor(ui.downloads[0].url));
  const backup=JSON.parse(text);
  assert.equal(backup.version,3);
  assert.equal(backup.deletedProjects[0].parts[0].consumptionPerShift,500);
  const recovered=boot(t,workspace({id:'different',name:'Different workspace'}));
  recovered.file('#backup-input',{name:'qa-backup.json',text:async()=>text});
  await until(()=>recovered.w.document.querySelector('dialog [data-confirm]'),'backup confirmation');
  recovered.click('dialog [data-confirm]');
  await until(()=>recovered.state().deletedProjects?.length===1,'restored trash');
  recovered.click('[data-view="projects"]');
  recovered.click('[data-restore-project="qa-warehouse"]');
  assert.equal(recovered.state().activeId,'qa-warehouse');
  assert.deepEqual(recovered.kpis(),['11.34','27.54','7.98','33.63']);
  assert.deepEqual(ui.errors,[]);
  assert.deepEqual(recovered.errors,[]);
});

test('restored backups cannot select a deleted project as the active workspace',async t=>{
  const ui=boot(t);
  const backup=workspace({id:'survivor',name:'Surviving project'});
  backup.deletedProjects=[{...workspace({id:'deleted',name:'Deleted project'}).projects[0],deletedAt:'2026-10-27T09:00:00.000Z'}];
  backup.activeId='deleted';
  ui.file('#backup-input',{name:'qa-deleted-active.json',text:async()=>JSON.stringify(backup)});
  await until(()=>ui.w.document.querySelector('dialog [data-confirm]'),'restore confirmation');
  ui.click('dialog [data-confirm]');
  await until(()=>ui.state().projects[0].id==='survivor','workspace restore');
  assert.equal(ui.state().activeId,'survivor');
  ui.click('[data-view="projects"]');
  assert.equal(ui.$('.page-heading [data-delete-project]').dataset.deleteProject,'survivor');
  assert.deepEqual(ui.errors,[]);
});

