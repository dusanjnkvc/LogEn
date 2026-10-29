const test = require('node:test');
const assert = require('node:assert/strict');
require('./domain.js');
const D = globalThis.LogEnDomain;
const settings = overrides => ({...D.createDefaultSettings(), stackabilityEnabled:true, ...overrides});
const part = overrides => ({partNumber:'SHIFT-001',qtyBox:20,qtyOnPallet:40,
  consumptionPerShift:500,doh:5,length:1200,width:800,height:1000,...overrides});
const calculate = (p={},s={}) => D.calculatePart(part(p), settings(s));
const forPallets = (n,p={},s={}) => calculate({consumptionPerShift:1,doh:n,...p},{shiftsPerDay:1,...s});
const near = (actual,expected) => assert.ok(Math.abs(actual-expected)<1e-9,`${actual} should equal ${expected}`);

test('eight-column sample defaults stacking to one and calculates all four footprints',()=>{
 const r=calculate(); assert.equal(r.isValid,true); assert.equal(r.input.stacking,1);
 assert.equal(r.requiredParts,5000); assert.equal(r.requiredPallets,10);
 assert.equal(r.planning.partsPerPallet,800); assert.equal(r.planning.palletsPerShift,.625);
 assert.equal(r.planning.roundedPalletsPerShift,1); assert.equal(r.planning.plannedPalletsPerDay,2);
 assert.equal(r.planning.requiredPallets,10); assert.equal(r.planning.dailyConsumption,1000);
 near(r.floor.withoutGangways,11.34); near(r.floor.withGangways,63.6);
 near(r.rack.withoutGangways,7.98); near(r.rack.withGangways,33.63);
});

test('manually permitted stacking changes floor occupancy but never rack capacity',()=>{
 const a=calculate(), b=calculate({stacking:3});
 assert.equal(b.floor.positions,4); assert.equal(b.floor.rows,2);
 near(b.floor.withoutGangways,4.5); near(b.floor.withGangways,21.2);
 assert.equal(a.rack.bays,b.rack.bays); assert.equal(a.rack.withGangways,b.rack.withGangways);
 const capped=calculate({stacking:99}); assert.equal(capped.floor.effectiveStacking,5);
});

test('selected-shift daily demand is rounded before multiplying by DOH',()=>{
 const r=calculate({consumptionPerShift:1000});
 assert.equal(r.planning.palletsPerShift,1.25); assert.equal(r.planning.roundedPalletsPerShift,2);
 assert.equal(r.requiredParts,10000); assert.equal(r.planning.plannedPalletsPerDay,3); assert.equal(r.requiredPallets,15);
 assert.equal(Math.ceil(r.requiredParts/800),13); assert.notEqual(r.requiredPallets,13);
});

test('one through three shifts multiply daily consumption and rounded storage demand',()=>{
 for(const shifts of [1,2,3]){ const r=calculate({}, {shiftsPerDay:shifts});
  assert.equal(r.planning.consumptionPerShift,500); assert.equal(r.planning.shiftConsumption,500);
  assert.equal(r.planning.dailyConsumption,500*shifts); assert.equal(r.requiredPallets,[5,10,10][shifts-1]);
 }
 for(const shifts of [0,4,1.5,NaN]) assert.ok(D.validateSettings(settings({shiftsPerDay:shifts})).length);
});

test('0.13 pallets per shift rounds once after 1, 2 or 3 selected shifts',()=>{
 for(const shifts of [1,2,3]) {
  const r=calculate({consumptionPerShift:104,doh:1},{shiftsPerDay:shifts});
  near(r.planning.palletsPerShift,.13);near(r.planning.palletsPerDay,.13*shifts);
  assert.equal(r.planning.plannedPalletsPerDay,1);assert.equal(r.requiredPallets,1);
  assert.equal(calculate({consumptionPerShift:104,doh:5},{shiftsPerDay:shifts}).requiredPallets,5);
 }
 const crossing=calculate({consumptionPerShift:320,doh:2},{shiftsPerDay:3});
 near(crossing.planning.palletsPerDay,1.2);assert.equal(crossing.requiredPallets,4);
 assert.equal(calculate({consumptionPerShift:0,doh:5},{shiftsPerDay:3}).requiredPallets,0);
 assert.equal(calculate({consumptionPerShift:800.0000000000002,doh:1},{shiftsPerDay:2}).requiredPallets,3);
});

test('Stackability off uses one-high storage and keeps saved per-part factors',()=>{
 assert.equal(D.createDefaultSettings().stackabilityEnabled,false);
 const input=part({stacking:3});
 const off=D.calculatePart(input,settings({stackabilityEnabled:false}));
 const on=D.calculatePart(input,settings({stackabilityEnabled:true}));
 assert.equal(off.floor.effectiveStacking,1);assert.equal(on.floor.effectiveStacking,3);
 assert.equal(off.input.stacking,3);assert.equal(input.stacking,3);
 near(off.floor.withGangways,63.6);near(on.floor.withGangways,21.2);
 assert.equal(off.requiredPallets,on.requiredPallets);assert.equal(off.rack.withGangways,on.rack.withGangways);
 const capped=calculate({stacking:99},{stackabilityEnabled:true});assert.equal(capped.floor.effectiveStacking,5);
 assert.equal(calculate({height:5001},{stackabilityEnabled:false}).floor,null);
 assert.ok(D.validateSettings(settings({stackabilityEnabled:'yes'})).length);
});

test('DOH is per part by default and project override recalculates both scenarios',()=>{
 const a=calculate({doh:2}), b=calculate({doh:2},{coverageMode:'custom',customCoverageDays:5});
 assert.equal(a.requiredPallets,4); assert.equal(b.requiredPallets,10);
 assert.equal(b.planning.providedCoverageDays,2); assert.equal(b.planning.targetCoverageDays,5);
 assert.equal(b.rack.bays,2); assert.equal(b.floor.positions,10);
 assert.equal(D.createDefaultSettings().customCoverageDays,5);
});

test('fractional DOH receives an outer pallet ceiling and zero DOH allocates no storage',()=>{
 for(const [days,expected] of [[0,0],[.1,1],[.5,1],[1.25,3],[2.25,5]]){
  const r=calculate({doh:days}); assert.equal(r.requiredPallets,expected);
  near(r.requiredParts,1000*days);
 }
 const r=calculate({doh:0}); assert.equal(r.floor.rows,0); assert.equal(r.rack.bays,0);
 const override=calculate({}, {coverageMode:'custom',customCoverageDays:2.25}); assert.equal(override.requiredPallets,5);
});

test('24h and 48h compatibility presets use one and two production days after shift rounding',()=>{
 assert.equal(calculate({}, {coverageMode:'24h'}).requiredPallets,2);
 assert.equal(calculate({}, {coverageMode:'48h'}).requiredPallets,4);
 assert.equal(calculate().planning.pallets24h,2); assert.equal(calculate().planning.pallets48h,4);
});

test('old entered stock mode cannot override the new formula',()=>{
 const r=calculate({stockQty:801},{stockMode:'entered'});
 assert.equal(r.requiredParts,5000); assert.equal(r.requiredPallets,10);
 assert.equal(r.planning.currentPalletPositions,2);
 assert.equal(calculate({}, {stockMode:'obsolete'}).isValid,true);
});

test('new packaging and shift inputs override stale historical capacity and monthly totals',()=>{
 const r=calculate({partsPerPallet:1,monthlyConsumption:1,consumption:9999,providedCoverageDays:100,doh:2});
 assert.equal(r.input.partsPerPallet,800); assert.equal(r.planning.consumptionPerShift,500);
 assert.equal(r.planning.providedCoverageDays,2); assert.equal(r.requiredPallets,4);
});

test('new eight-column input never invents current stock or monthly inventory',()=>{
 const r=calculate(); assert.equal(r.input.stockQty,null); assert.equal(r.planning.stockQty,null);
 assert.equal(r.planning.currentPallets,null); assert.equal(r.planning.currentPalletPositions,null);
 assert.equal(r.planning.actualCoverageDays,null); assert.equal(r.planning.coverageDifferenceDays,null);
 assert.equal(r.planning.coverageMismatch,false); assert.equal(r.input.monthlyConsumption,null);
 assert.equal(r.planning.monthlyConsumption,null); assert.equal(r.planning.palletDurationDays,.8);
});

test('known historical stock may be reported without controlling required pallets',()=>{
 const r=calculate({stockQty:5600,monthlyConsumption:22000});
 assert.equal(r.planning.currentPallets,7); assert.equal(r.planning.actualCoverageDays,5.6);
 near(r.planning.coverageDifferenceDays,.6); assert.equal(r.planning.coverageMismatch,true);
 assert.equal(r.requiredPallets,10); assert.equal(r.input.monthlyConsumption,22000);
 const zero=calculate({stockQty:0}); assert.equal(zero.planning.currentPallets,0);
 assert.equal(zero.planning.actualCoverageDays,0);
});

test('zero per-shift demand yields zero pallets with explicit no-consumption durations',()=>{
 const r=calculate({consumptionPerShift:0,stockQty:5600});
 assert.equal(r.isValid,true); assert.equal(r.requiredPallets,0); assert.equal(r.requiredParts,0);
 assert.equal(r.planning.noConsumption,true); assert.equal(r.planning.roundedPalletsPerShift,0);
 assert.equal(r.planning.palletDurationDays,null); assert.equal(r.planning.actualCoverageDays,null);
 assert.equal(r.planning.pallets24h,0); assert.equal(r.planning.pallets48h,0);
 assert.equal(r.floor.withoutGangways,0); assert.deepEqual(r.rack.baysPerRun,[]);
});

test('legacy daily data migrates once to a fixed per-shift rate',()=>{
 const old={partNumber:'OLD',qtyBox:20,qtyOnPallet:40,qtyPallet:7,consumption:1000,doh:5,
 length:1200,width:800,height:1000,stacking:3};
 const p=D.normalizePart(old,settings()); assert.equal(p.consumptionPerShift,500);
 assert.equal(p.stockQty,5600); assert.equal(p.partsPerPallet,800); assert.equal(p.packagingInferred,false);
 const r=D.calculatePart(p,settings({shiftsPerDay:3}));
 assert.equal(r.planning.consumptionPerShift,500); assert.equal(r.planning.dailyConsumption,1500);
 assert.equal(r.requiredPallets,10); assert.equal(old.consumptionPerShift,undefined);
});

test('old monthly direct-capacity data migrates with an explicit packaging inference flag',()=>{
 const old={partNumber:'MONTHLY',partsPerPallet:800,monthlyConsumption:22000,
 providedCoverageDays:5,stockQty:5600,length:1200,width:800,height:1000,stacking:3};
 const p=D.normalizePart(old,settings()); assert.equal(p.qtyBox,800); assert.equal(p.qtyOnPallet,1);
 assert.equal(p.packagingInferred,true); assert.equal(p.consumptionPerShift,500); assert.equal(p.doh,5);
 assert.equal(p.monthlyConsumption,22000); assert.equal(p.stockQty,5600);
 const r=D.calculatePart(p,settings({workingDaysPerMonth:20,shiftsPerDay:3}));
 assert.equal(r.planning.consumptionPerShift,500); assert.equal(r.requiredPallets,10);
});

test('legacy monthly missing stock stays unknown',()=>{
 const old={partNumber:'MONTHLY',partsPerPallet:800,monthlyConsumption:22000,
 providedCoverageDays:5,length:1200,width:800,height:1000};
 assert.equal(D.normalizePart(old,settings()).stockQty,null);
 assert.equal(D.calculatePart(old,settings()).planning.currentPallets,null);
});

test('obsolete workday or stock metadata does not invalidate explicit per-shift data',()=>{
 assert.equal(calculate({}, {workingDaysPerMonth:0}).isValid,true);
 assert.equal(calculate({}, {workingDaysPerMonth:NaN}).isValid,true);
 const r=calculate({monthlyConsumption:NaN,stockQty:-1});
 assert.equal(r.isValid,true); assert.equal(r.planning.currentPallets,null);
 const old={partNumber:'OLD',partsPerPallet:800,monthlyConsumption:22000,providedCoverageDays:5,
 length:1200,width:800,height:1000};
 assert.equal(D.calculatePart(old,settings({workingDaysPerMonth:0})).isValid,false);
});

test('invalid or missing primary numeric fields remain visible errors',()=>{
 for(const p of [{qtyBox:0},{qtyBox:1.5},{qtyOnPallet:0},{qtyOnPallet:.5},
 {consumptionPerShift:-1},{consumptionPerShift:NaN},{doh:-1},{height:NaN},{stacking:0},
 {inputErrors:['Invalid Excel cell']},{qtyBox:0,partsPerPallet:800}])
 assert.equal(calculate(p).isValid,false);
 const missing=part();delete missing.consumptionPerShift;
 assert.equal(D.calculatePart(missing,settings()).isValid,false);
 const missingDoh=part();delete missingDoh.doh;assert.equal(D.calculatePart(missingDoh,settings()).isValid,false);
});

test('whole-pallet boundary precision does not erase meaningful fractional consumption',()=>{
 assert.equal(calculate({consumptionPerShift:800}).planning.roundedPalletsPerShift,1);
 assert.equal(calculate({consumptionPerShift:800.00001}).planning.roundedPalletsPerShift,2);
 assert.equal(calculate({consumptionPerShift:800.0000000000002}).planning.roundedPalletsPerShift,2);
 assert.equal(calculate({consumptionPerShift:1e-20}).requiredPallets,5);
 assert.equal(calculate({consumptionPerShift:1e300}).isValid,false);
});

test('floor fit failures preserve independent planning and rack results',()=>{
 const r=calculate({}, {maxFloorRowDepth:1000});
 assert.equal(r.isValid,false); assert.equal(r.floor,null); assert.ok(r.rack);
 assert.equal(r.planning.roundedPalletsPerShift,1); assert.equal(r.requiredPallets,10);
 assert.match(r.errors.join(' '),/row depth/);
 assert.match(calculate({}, {maxFloorStackingHeight:999}).errors.join(' '),/stacking height/);
});

test('floor actual occupancy handles full and partial rows without unused reserved depth',()=>{
 const r=forPallets(19,{stacking:3});
 assert.equal(r.floor.positions,7); assert.equal(r.floor.rows,3); assert.equal(r.floor.lastRowPallets,1);
 near(r.floor.fullRowDepth,3.8); near(r.floor.lastRowDepth,1.2); near(r.floor.totalOccupiedDepth,8.8);
 near(r.floor.withoutGangways,7.92); near(r.floor.gangwayArea,34.2); near(r.floor.withGangways,40.28);
});

test('zero floor depth means one unrestricted occupied row while rack depth still validates',()=>{
 const r=forPallets(19,{stacking:3},{maxFloorRowDepth:0});
 assert.equal(r.isValid,true); assert.equal(r.floor.rows,1); assert.equal(r.floor.palletsPerRow,7);
 near(r.floor.totalOccupiedDepth,9); near(r.floor.withoutGangways,8.1); near(r.floor.gangwayArea,34.2);
 const one=forPallets(1); near(one.floor.rowDepth,1.2); near(one.floor.withoutGangways,1.08);
 assert.ok(D.validateSettings(settings({rackSlotDepth:0})).length);
});

test('rack final run uses actual bay allocation with no footprint level multiplier',()=>{
 const r=forPallets(41); assert.equal(r.rack.bays,6); assert.equal(r.rack.runs,2);
 assert.equal(r.rack.maxBaysPerRun,5); assert.deepEqual(r.rack.baysPerRun,[5,1]);
 near(r.rack.withoutGangways,23.94); near(r.rack.gangwayArea,76.95);
});

test('rack height/depth clearances independently enforce fit boundaries',()=>{
 assert.equal(calculate({height:1000,width:1100}).isValid,true);
 const h=calculate({height:1001}); assert.equal(h.rack,null); assert.ok(h.floor);
 assert.ok(h.planning); assert.match(h.errors.join(' '),/vertical clearance/);
 assert.equal(calculate({width:1101}).rack,null);
 assert.ok(calculate({width:1101},{rackDepthClearance:99}).rack);
});

test('rack rotation is opt-in and chooses highest valid capacity',()=>{
 const a=calculate({length:1000,width:600}), b=calculate({length:1000,width:600},{allowRotation:true});
 assert.equal(a.rack.palletsPerSlot,2); assert.equal(a.rack.rotated,false);
 assert.equal(b.rack.palletsPerSlot,3); assert.equal(b.rack.rotated,true);
 assert.equal(calculate({length:800,width:1300}).rack,null);
 assert.equal(calculate({length:800,width:1300},{allowRotation:true}).rack.rotated,true);
});

test('each part has dedicated floor rows and rack bays',()=>{
 const r=D.calculateProject([part({partNumber:'A'}),part({partNumber:'B'})],settings());
 assert.equal(r.invalidCount,0); assert.equal(r.totalRequiredPallets,20);
 assert.equal(r.totalFloorRows,8); assert.equal(r.totalRackBays,4); assert.equal(r.totalRackRuns,2);
 near(r.floorWithoutGangways,22.68); near(r.floorWithGangways,127.2);
 near(r.rackWithoutGangways,15.96); near(r.rackWithGangways,67.26);
});

test('input-invalid rows remain listed and excluded from the affected totals',()=>{
 const r=D.calculateProject([part({partNumber:'A'}),part({partNumber:'BAD',qtyBox:0})],settings());
 assert.equal(r.results.length,2); assert.equal(r.invalidCount,1); assert.equal(r.validCount,1);
 assert.equal(r.totalRequiredPallets,10); near(r.floorWithoutGangways,11.34);
 assert.ok(r.results[1].errors.length);
});

test('floor totals include floor-valid parts with rack errors and sum displayed cents',()=>{
 const parts=[part({partNumber:'OK'}),part({partNumber:'RACK-TOO-TALL',height:1100})];
 const r=D.calculateProject(parts,settings());
 assert.equal(r.invalidCount,1);assert.equal(r.floorValidCount,2);assert.equal(r.rackValidCount,1);
 assert.equal(r.results[1].isFloorValid,true);assert.equal(r.results[1].isRackValid,false);
 assert.equal(r.totalRequiredPallets,20);assert.equal(r.totalFloorPositions,20);
 near(r.floorWithoutGangways,22.68);near(r.floorWithGangways,127.2);near(r.rackWithoutGangways,7.98);
 const cents=D.calculateProject([part({partNumber:'C1',width:801}),part({partNumber:'C2',width:801})],settings());
 assert.deepEqual(cents.results.map(row=>row.floor.storageArea),[11.35,11.35]);
 near(cents.floorWithoutGangways,22.70);
 assert.notEqual(cents.floorWithoutGangways,Number(cents.results.reduce((sum,row)=>sum+row.floor.withoutGangways,0).toFixed(2)));
 const floorBad=D.calculateProject([part()],settings({maxFloorRowDepth:1000}));
 assert.equal(floorBad.floorValidCount,0);assert.equal(floorBad.rackValidCount,1);
 near(floorBad.floorWithoutGangways,0);near(floorBad.rackWithoutGangways,7.98);
});

test('duplicate identifiers are case-insensitive and errors clear after correction',()=>{
 const rows=[part({partNumber:'Same'}),part({partNumber:' same '})];
 const r=D.calculateProject(rows,settings());assert.equal(r.invalidCount,2);
 assert.equal(r.totalRequiredPallets,0); assert.match(r.results[0].errors.join(),/Duplicate/);
 assert.equal(r.floorValidCount,0);assert.equal(r.rackValidCount,0);assert.equal(r.floorWithoutGangways,0);
 assert.equal(r.results[0].isFloorValid,false);
 assert.equal(D.calculateProject([rows[0]],settings()).invalidCount,0);
});

test('savings may be negative and zero floor denominators remain undefined',()=>{
 const r=D.calculateProject([part()],settings());near(r.savingWithoutGangways,3.36);
 near(r.savingWithGangways,29.97);
 const stacked=D.calculateProject([part({stacking:3})],settings());
 near(stacked.savingWithGangways,-12.43);assert.ok(stacked.savingWithGangwaysPercent<0);
 const zero=D.calculateProject([part({consumptionPerShift:0})],settings());
 assert.equal(zero.savingWithoutGangwaysPercent,null);assert.equal(zero.savingWithGangwaysPercent,null);
});

test('gangway allocation uses the full saved physical width for both scenarios',()=>{
 const baseline=calculate({}, {gangwayWidth:0});
 for(const width of [0,3000,4500,4501]) {
  const s=settings({gangwayWidth:width}), r=D.calculatePart(part(),s);
  assert.equal(s.gangwayWidth,width);
  assert.equal(D.allocatedGangwayWidth(s),width);
  assert.equal(r.requiredPallets,baseline.requiredPallets);
  near(r.floor.withoutGangways,baseline.floor.withoutGangways);
  near(r.rack.withoutGangways,baseline.rack.withoutGangways);
  near(r.floor.gangwayArea,10*1.2*(width/1000));
  near(r.rack.gangwayArea,5.7*(width/1000));
  near(r.floor.withGangways,baseline.floor.formulaStorageArea+r.floor.gangwayArea);
  near(r.rack.withGangways,baseline.rack.withoutGangways+r.rack.gangwayArea);
 }
 const r=calculate();near(r.floor.gangwayArea,54);near(r.rack.gangwayArea,25.65);
});

test('floor with gangways uses the exact unrounded Q/S formula and actual pallet dimensions',()=>{
 const r=forPallets(7,{stacking:3});
 assert.equal(r.requiredPallets,7);assert.equal(r.floor.effectiveStacking,3);
 assert.equal(r.floor.positions,3);near(r.floor.formulaPositions,7/3);
 near(r.floor.formulaStorageArea,2.24);near(r.floor.gangwayArea,12.6);
 near(r.floor.withGangways,14.84);
 assert.notEqual(r.floor.withGangways,3*1200*(800+4500)/1000000);
 const differentRows=forPallets(7,{stacking:3},{maxFloorRowDepth:2500,floorPalletClearance:50});
 assert.notEqual(r.floor.withoutGangways,differentRows.floor.withoutGangways);
 near(r.floor.withGangways,differentRows.floor.withGangways);
 const noAisle=forPallets(7,{stacking:3},{gangwayWidth:0});
 near(noAisle.floor.withGangways,2.24);assert.equal(noAisle.floor.gangwayArea,0);
 assert.notEqual(noAisle.floor.withGangways,noAisle.floor.withoutGangways);
 const heightLimited=forPallets(7,{stacking:3},{maxFloorStackingHeight:2000});
 assert.equal(heightLimited.floor.effectiveStacking,2);near(heightLimited.floor.withGangways,22.26);
 near(r.rack.withGangways,16.815);
 const zero=calculate({doh:0});assert.equal(zero.floor.formulaPositions,0);
 assert.equal(zero.floor.formulaStorageArea,0);assert.equal(zero.floor.withGangways,0);
});

test('gangway edits affect only allocated areas',()=>{
 const a=calculate(),b=calculate({}, {gangwayWidth:3000});
 assert.equal(a.floor.withoutGangways,b.floor.withoutGangways);
 assert.equal(a.rack.withoutGangways,b.rack.withoutGangways);
 near(b.floor.withGangways,45.6);near(b.rack.withGangways,25.08);
});

test('invalid settings retain rows and prevent misleading calculated totals',()=>{
 const r=D.calculateProject([part()],settings({maxRackRunLength:2000}));
 assert.ok(r.settingsErrors.length);assert.equal(r.results.length,1);assert.equal(r.invalidCount,1);
 assert.equal(r.totalRequiredPallets,0);
 for(const s of [{rackLevels:0},{gangwayWidth:-1},{customCoverageDays:-1},{coverageMode:'unknown'}])
  assert.ok(D.validateSettings(settings(s)).length);
});

test('empty project and independently created defaults are safe',()=>{
 const r=D.calculateProject([],settings());assert.equal(r.invalidCount,0);
 assert.equal(r.totalRackRuns,0);assert.equal(r.savingWithGangwaysPercent,null);
 const a=D.createDefaultSettings();a.shiftsPerDay=3;assert.equal(D.createDefaultSettings().shiftsPerDay,2);
});
