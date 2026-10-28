// Deterministic source-level parity QA; no browser, network, or production writes.
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
require('../webapp/domain.js');
const D = globalThis.LogEnDomain;
const root = path.join(__dirname, '..');
const base = { partNumber:'PARITY-001', qtyBox:20, qtyOnPallet:40,
  consumptionPerShift:500, doh:5, length:1200, width:800, height:1000,
  stacking:1, inputErrors:[] };
const cases=[];
function add(label, input={}, settings={}, importSettings) {
  cases.push({label,input:{...base,...input},settings:{...D.createDefaultSettings(),...settings},...(importSettings?{importSettings}: {})});
}
let cursor=0;
const rates=[0,1e-20,500,800,1000,1600.00001];
for(const shifts of [1,2,3]) for(const doh of [0,0.25,1,5,7.5]) for(const depth of [0,5000]) for(const stacking of [1,3]) {
  add('shift/doh/depth/stack '+cursor,{consumptionPerShift:rates[cursor%rates.length],doh,stacking},
    {shiftsPerDay:shifts,maxFloorRowDepth:depth,maxRackRunLength:cursor%2?5700:15000});
  cursor++;
}
for(const days of [0,0.1,2,8.75]) for(const stock of [null,0,5600]) {
  add('custom/optional-stock '+cases.length,{stockQty:stock},
    {coverageMode:'custom',customCoverageDays:days,shiftsPerDay:cases.length%3+1});
}
for(const kind of ['daily','monthly']) for(const before of [1,2,3]) for(const after of [1,3]) {
  const legacy = kind==='daily'
    ? {partNumber:'LEGACY-DAILY',qtyBox:20,qtyOnPallet:40,qtyPallet:7,consumption:1000,doh:5,
      length:1200,width:800,height:1000,stacking:3}
    : {partNumber:'LEGACY-MONTHLY',stockQty:5600,partsPerPallet:800,monthlyConsumption:22000,
      providedCoverageDays:5,length:1200,width:800,height:1000,stacking:3};
  cases.push({label:'migrate '+kind+' '+before+'→'+after,input:legacy,
    importSettings:{...D.createDefaultSettings(),shiftsPerDay:before},
    settings:{...D.createDefaultSettings(),shiftsPerDay:after}});
}
for(const shifts of [1,2,3]) add('obsolete stock mode ignored '+shifts,{}, {shiftsPerDay:shifts,stockMode:'entered'});
const invalid=[
  [{qtyBox:0},{}],[{qtyBox:-1},{}],[{qtyBox:1.5},{}],
  [{qtyOnPallet:0},{}],[{qtyOnPallet:-1},{}],[{qtyOnPallet:1.5},{}],
  [{consumptionPerShift:-1},{}],[{doh:-1},{}],
  [{},{shiftsPerDay:0}],[{},{shiftsPerDay:4}],[{},{shiftsPerDay:1.5}],
  [{},{maxFloorRowDepth:-1}],[{},{rackSlotDepth:0}],
];
invalid.forEach(([input,settings],index)=>add('invalid '+index,input,settings));
assert.equal(cases.length,100);

function pick(value, keys) { return Object.fromEntries(keys.map(key=>[key,value[key]??null])); }
function snapshot(r) {
  return {
    input:pick(r.input,['partNumber','qtyBox','qtyOnPallet','partsPerPallet','consumptionPerShift','doh','stacking','stockQty','packagingInferred']),
    isValid:r.isValid,errorCount:r.errors.length,requiredParts:r.requiredParts,requiredPallets:r.requiredPallets,
    planning:r.planning?pick(r.planning,['qtyBox','qtyOnPallet','partsPerPallet','consumptionPerShift','palletsPerShift','roundedPalletsPerShift','plannedPalletsPerDay','requiredPallets','dailyConsumption','shiftConsumption','palletsPerDay','targetCoverageDays','currentPallets','currentPalletPositions','actualCoverageDays','coverageDifferenceDays','palletDurationDays','stockQty','noConsumption','pallets24h','pallets48h','palletsCustom']):null,
    floor:r.floor?pick(r.floor,['maximumStacking','effectiveStacking','positions','palletsPerRow','rows','rowWidth','rowDepth','totalOccupiedDepth','fullRowDepth','lastRowDepth','lastRowPallets','withoutGangways','formulaPositions','formulaStorageArea','gangwayArea','withGangways']):null,
    rack:r.rack?pick(r.rack,['palletsPerSlot','levels','capacityPerBay','bays','maxBaysPerRun','runs','rotated','effectiveBayLength','effectiveBayDepth','effectiveBayHeight','withoutGangways','gangwayArea','withGangways','baysPerRun']):null,
  };
}
function finiteJson(value) {
  return JSON.parse(JSON.stringify(value,(_,item)=>typeof item==='number'&&!Number.isFinite(item)?null:item));
}
const js=cases.map(item=>{
  const input=item.importSettings?D.normalizePart(item.input,item.importSettings):item.input;
  return finiteJson(snapshot(D.calculatePart(input,item.settings)));
});
const dart=process.env.LOGEN_DART || path.join(root,'.tooling','flutter','bin','cache','dart-sdk','bin','dart.exe');
const run=spawnSync(dart,[path.join(__dirname,'shift_parity.dart')],{
  cwd:root,input:JSON.stringify(cases),encoding:'utf8',timeout:30000,maxBuffer:10*1024*1024,
});
if(run.error)throw run.error;
assert.equal(run.status,0,run.stderr||'Dart parity helper did not complete.');
const actual=JSON.parse(run.stdout);
assert.equal(actual.length,cases.length);
const differences=[];
function compare(expected,value,at) {
  if(typeof expected==='number'&&typeof value==='number') {
    if(expected===value)return;
    const tolerance=1e-10*Math.max(1e-30,Math.abs(expected),Math.abs(value));
    if(Math.abs(expected-value)<=tolerance)return;
    differences.push(at+': JS '+expected+' vs Dart '+value);return;
  }
  if(expected===null||value===null||typeof expected!=='object'||typeof value!=='object') {
    if(expected!==value)differences.push(at+': JS '+JSON.stringify(expected)+' vs Dart '+JSON.stringify(value));return;
  }
  if(Array.isArray(expected)!==Array.isArray(value)){differences.push(at+': mismatched structure');return;}
  const a=Object.keys(expected),b=Object.keys(value);
  if(JSON.stringify(a)!==JSON.stringify(b)){differences.push(at+': mismatched keys');return;}
  for(const key of a)compare(expected[key],value[key],at+'.'+key);
}
cases.forEach((item,index)=>compare(js[index],actual[index],item.label));
assert.deepEqual(differences,[],differences.slice(0,30).join('\n'));
console.log('Shift model parity passed: 100 deterministic JavaScript/Dart cases; normalized inputs, shift rounding, DOH, optional stock, geometry and validation agree.');
