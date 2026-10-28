const test=require('node:test'),assert=require('node:assert/strict');
globalThis.ExcelJS=require('./vendor/exceljs.min.js');
const WorkbookService=require('./workbook.js');require('./domain.js');
const D=globalThis.LogEnDomain,S=new WorkbookService(),defaults=D.createDefaultSettings();
const H=['Part Number','QTY in Box','QTY boxes per Pallet','Consumption per shift','DOH (Days on hand)','L(mm)','W(mm)','H(mm)'];
const sample=(id='SAMPLE-001')=>[id,20,40,500,5,1200,800,1000];
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} differs from ${b}`);
async function bytes(rows){const b=new ExcelJS.Workbook();b.addWorksheet('Inventory').addRows(rows);return new Uint8Array(await b.xlsx.writeBuffer());}
async function decode(data){const b=new ExcelJS.Workbook();await b.xlsx.load(data);return b;}
const calc=(parts,s=defaults)=>D.calculateProject(parts,s);
async function exported(parts,s=defaults,rawInputRows){return decode(await S.exportBytes({name:'Warehouse',parts,settings:s,rawInputRows},calc(parts,s)));}
function cell(sheet,label,row=2){const col=sheet.getRow(1).values.indexOf(label);assert.ok(col>0,`Missing column ${label}`);return sheet.getRow(row).getCell(col).value;}

test('exact eight-column shift template drives required pallets and all four footprints',async()=>{
 assert.deepEqual(WorkbookService.headers,H);const template=await S.templateBytes(),b=await decode(template);
 assert.deepEqual(b.getWorksheet('Input Data').getRow(1).values.slice(1),H);
 const input=await S.importBytes(template),p=input.parts[0],c=calc(input.parts);
 assert.equal(p.qtyBox,20);assert.equal(p.qtyOnPallet,40);assert.equal(p.consumptionPerShift,500);assert.equal(p.doh,5);assert.equal(p.stacking,1);assert.equal(p.stockQty,null);
 assert.equal(c.invalidCount,0);assert.equal(c.totalRequiredPallets,10);
 [11.34,63.6,7.98,33.63].forEach((n,i)=>close([c.floorWithoutGangways,c.floorWithGangways,c.rackWithoutGangways,c.rackWithGangways][i],n));
 const output=await exported(input.parts,defaults,input.rawInputRows);
 assert.deepEqual(output.worksheets.map(s=>s.name),['Original Input Data','Floor Pallet Calculations','Rack Calculations','Warehouse Comparison','Warehouse Settings']);
 [11.34,63.6,7.98,33.63].forEach((n,i)=>close(output.getWorksheet('Warehouse Comparison').getCell(`B${i+2}`).value,n));
 assert.equal(output.getWorksheet('Warehouse Comparison').getCell('B5').numFmt,'#,##0.00');
});

test('rounding occurs per shift before DOH and shifts; formula and intermediate values export',async()=>{
 const row=sample();row[3]=1000;const input=await S.importBytes(await bytes([H,row])),c=calc(input.parts),p=c.results[0].planning;
 close(p.palletsPerShift,1.25);assert.equal(p.roundedPalletsPerShift,2);assert.equal(p.plannedPalletsPerDay,4);assert.equal(c.totalRequiredPallets,20);
 const sheet=(await exported(input.parts)).getWorksheet('Floor Pallet Calculations');close(cell(sheet,'Raw Pallets per Shift'),1.25);assert.equal(cell(sheet,'Rounded Pallets per Shift'),2);assert.equal(cell(sheet,'Required Pallets (nested rounding)'),20);assert.match(cell(sheet,'Required Pallets Formula'),/CEILING\(CEILING\(1000 \/ 20 \/ 40\).*5.*2/);
});

test('export records full gangway setting and full-width allocation for both storage methods',async()=>{
 const input=await S.importBytes(await S.templateBytes());
 for(const gangwayWidth of [4500,6000,0]){
  const s={...defaults,gangwayWidth},book=await exported(input.parts,s),c=calc(input.parts,s);
  const settings=book.getWorksheet('Warehouse Settings'),setting=name=>settings.getRows(1,settings.rowCount).find(row=>row.getCell(1).value===name).getCell(2).value;
  assert.equal(s.gangwayWidth,gangwayWidth);assert.equal(setting('Gangway width'),gangwayWidth);
  assert.equal(setting('Gangway allocation factor'),1);assert.equal(setting('Allocated gangway width (100%)'),gangwayWidth);
  const floor=book.getWorksheet('Floor Pallet Calculations'),rack=book.getWorksheet('Rack Calculations');
  close(cell(floor,'Allocated Gangway Area (m²)'),10*1200*gangwayWidth/1000000);
  close(cell(floor,'Formula Positions (Q / S, unrounded)'),10);
  close(cell(floor,'Formula Storage Base (m²)'),9.6);
  close(cell(floor,'Without Gangways (m²)'),11.34);
  close(cell(floor,'With Allocated Gangways (m²)'),10*1200*(800+gangwayWidth)/1000000);
  assert.match(cell(floor,'Floor With Gangways Formula'),/SQM = \(10 \/ 1\) \* 1200 \* \(800 \+/);
  close(cell(rack,'Allocated Gangway Area (m²)'),cell(rack,'Total Run Frontage (m)')*gangwayWidth/1000);
  close(cell(floor,'With Allocated Gangways (m²)'),cell(floor,'Formula Storage Base (m²)')+cell(floor,'Allocated Gangway Area (m²)'));
  close(cell(rack,'With Allocated Gangways (m²)'),cell(rack,'Without Gangways (m²)')+cell(rack,'Allocated Gangway Area (m²)'));
  assert.match(book.getWorksheet('Warehouse Comparison').getRows(1,40).map(row=>row.getCell(1).value).join(' '),/configured gangway width \(mm\) \/ 1000/);
 }
});

test('floor export keeps Q/S fractional and records its independent formula base',async()=>{
 const input=await S.importBytes(await S.templateBytes());
 const parts=[{...input.parts[0],doh:7,stacking:3}],s={...defaults,shiftsPerDay:1};
 const book=await exported(parts,s),f=book.getWorksheet('Floor Pallet Calculations');
 assert.equal(cell(f,'Required Pallets'),7);assert.equal(cell(f,'Floor Positions'),3);
 close(cell(f,'Formula Positions (Q / S, unrounded)'),7/3);
 close(cell(f,'Formula Storage Base (m²)'),2.24);close(cell(f,'Allocated Gangway Area (m²)'),12.6);
 close(cell(f,'With Allocated Gangways (m²)'),14.84);close(cell(f,'Without Gangways (m²)'),3.42);
 assert.match(cell(f,'Floor With Gangways Formula'),/\(7 \/ 3\)/);
 close(cell(book.getWorksheet('Rack Calculations'),'With Allocated Gangways (m²)'),16.815);
 const noAisle=(await exported(parts,{...s,gangwayWidth:0})).getWorksheet('Floor Pallet Calculations');
 close(cell(noAisle,'With Allocated Gangways (m²)'),2.24);
 assert.notEqual(cell(noAisle,'With Allocated Gangways (m²)'),cell(noAisle,'Without Gangways (m²)'));
});

test('selected shifts1–3 and DOH override drive counts while4 is invalid',async()=>{
 const input=await S.importBytes(await S.templateBytes());
 for(const shiftsPerDay of [1,2,3]){const s={...defaults,shiftsPerDay,coverageMode:'custom',customCoverageDays:7},c=calc(input.parts,s);assert.equal(c.totalRequiredPallets,7*shiftsPerDay);close(c.results[0].planning.dailyConsumption,500*shiftsPerDay);const f=(await exported(input.parts,s)).getWorksheet('Floor Pallet Calculations');assert.equal(cell(f,'Shifts per Day'),shiftsPerDay);assert.equal(cell(f,'Selected DOH (days)'),7);}
 assert.ok(calc(input.parts,{...defaults,shiftsPerDay:4}).settingsErrors.length);
 const fractional={...defaults,shiftsPerDay:3,coverageMode:'custom',customCoverageDays:.25};assert.equal(calc(input.parts,fractional).totalRequiredPallets,1);
});

test('heading aliases, ordering, case and leading blanks are supported',async()=>{
 const input=await S.importBytes(await bytes([[],H.toReversed().map(x=>` ${x.toUpperCase()} `),sample().toReversed()]));assert.equal(input.parts[0].length,1200);assert.equal(calc(input.parts).totalRequiredPallets,10);
 const aliases=['PN','Parts per Box','Boxes per Pallet','Shift Consumption','Days on hand','Length (mm)','Width (mm)','Height (mm)'];assert.equal((await S.importBytes(await bytes([aliases,sample()]))).parts[0].consumptionPerShift,500);
});

test('optional stacking and stock survive export/re-import while template remains eight columns',async()=>{
 const input=await S.importBytes(await bytes([[...H,'Stacking','Current Stock'],[...sample(),3,5600]]));const c=calc(input.parts);close(c.floorWithoutGangways,4.5);close(c.floorWithGangways,21.2);
 const book=await exported(input.parts),again=await S.importBytes(new Uint8Array(await book.xlsx.writeBuffer()));assert.equal(again.parts.length,1);assert.equal(again.parts[0].stacking,3);assert.equal(again.parts[0].stockQty,5600);assert.deepEqual(WorkbookService.headers,H);
});

test('legacy daily conversion is explicit, fixed per shift and retains original source cells',async()=>{
 const headers=['Part Number','QTY Box','QTY Pallet','QTY on Pallet','Consumption','DOH','L (mm)','W (mm)','H (mm)','Stacking'],row=['OLD',20,7,40,1000,5,1200,800,1000,3];
 const input=await S.importBytes(await bytes([headers,row]));assert.equal(input.parts[0].consumptionPerShift,500);assert.equal(input.parts[0].stockQty,5600);assert.match(input.warnings.join(),/DAILY.*divided by 2 shifts/);assert.equal(calc(input.parts,{...defaults,shiftsPerDay:3}).totalRequiredPallets,15);
 const book=await exported(input.parts,defaults,input.rawInputRows),source=book.getWorksheet('Original Input Data'),marker=source.getRows(1,source.rowCount).findIndex(r=>String(r.getCell(1).value).startsWith('LOGEN ORIGINAL SOURCE DATA'));
 assert.ok(marker>=0);assert.deepEqual(source.getRow(marker+3).values.slice(1),row);assert.equal((await S.importBytes(new Uint8Array(await book.xlsx.writeBuffer()))).parts.length,1);
 const unknownStock=row.slice();unknownStock[2]=null;assert.equal((await S.importBytes(await bytes([headers,unknownStock]))).parts[0].stockQty,null);
});

test('legacy monthly conversion warns about inferred packaging and preserves its shift rate',async()=>{
 const h=['Part Number','Stock Quantity','Parts per Pallet','Monthly Consumption','Input Coverage (days)','L (mm)','W (mm)','H (mm)','Stacking'];
 const input=await S.importBytes(await bytes([h,['MONTH',5600,800,22000,5,1200,800,1000,3]])),p=input.parts[0];assert.equal(p.consumptionPerShift,500);assert.equal(p.qtyBox,800);assert.equal(p.qtyOnPallet,1);assert.equal(p.packagingInferred,true);assert.match(input.warnings.join(),/inferred packaging/);assert.equal(calc(input.parts,{...defaults,shiftsPerDay:3,workingDaysPerMonth:30}).totalRequiredPallets,15);
});

test('invalid, blank and formula input rows stay visible in partial exports',async()=>{
 const bad=sample('BAD');bad[5]='bad length';const formula=sample('FORMULA');formula[5]={formula:'600*2',result:1200};const blank=sample('BLANK');blank[3]=null;
 const input=await S.importBytes(await bytes([H,bad,formula,blank,sample(''),sample('GOOD')])),c=calc(input.parts);assert.equal(input.parts.length,5);assert.equal(c.invalidCount,4);assert.match(input.parts[0].inputErrors.join(),/L\(mm\)/);assert.match(input.parts[1].inputErrors.join(),/Formula/);assert.match(input.parts[2].inputErrors.join(),/is required/);
 const book=await exported(input.parts,defaults,input.rawInputRows);assert.match(book.getWorksheet('Warehouse Comparison').getCell('B7').value,/PARTIAL TOTALS.*4 invalid/);assert.match(cell(book.getWorksheet('Floor Pallet Calculations'),'Status'),/Invalid/);assert.ok(book.getWorksheet('Original Input Data').getRows(1,25).some(r=>r.values.includes('bad length')));
});

test('duplicate part errors are dynamic and clear when rows are consolidated',async()=>{
 const input=await S.importBytes(await bytes([H,sample('DUP'),sample('dup')]));assert.equal(calc(input.parts).invalidCount,2);assert.match(input.warnings.join(),/Duplicate/);assert.equal(calc(input.parts.slice(0,1)).invalidCount,0);
});

test('unrestricted floor depth exports the limit independently from actual occupied depth',async()=>{
 const input=await S.importBytes(await S.templateBytes()),book=await exported(input.parts,{...defaults,maxFloorRowDepth:0});close(cell(book.getWorksheet('Floor Pallet Calculations'),'Total Occupied Row Depth (m)'),12.9);const row=book.getWorksheet('Warehouse Settings').getRows(1,40).find(r=>r.getCell(1).value==='Maximum floor row depth LIMIT');assert.equal(row.getCell(2).value,0);assert.match(row.getCell(3).value,/unlimited/);
});

test('unreadable files, missing or ambiguous headings fail explicitly',async()=>{
 await assert.rejects(S.importBytes(new Uint8Array([1,2,3])),/\.xlsx/);await assert.rejects(S.importBytes(await bytes([['Part Number']])),/eight required headings/);await assert.rejects(S.importBytes(await bytes([[...H,'Part Number'],[...sample(),'OTHER']])),/duplicate column headings/);
});

test('rich-text headers and identifiers become serializable plain text',async()=>{
 const row=sample();row[0]={richText:[{text:'PART-'},{text:'001'}]};const input=await S.importBytes(await bytes([H.map(h=>({richText:[{text:h}]})),row]));assert.equal(input.parts[0].partNumber,'PART-001');assert.equal(JSON.parse(JSON.stringify(input)).rawInputRows[0][0],'Part Number');
});

test('invalid settings export unavailable totals; zero consumption has safe N/A values',async()=>{
 const input=await S.importBytes(await S.templateBytes()),bad=(await exported(input.parts,{...defaults,shiftsPerDay:4})).getWorksheet('Warehouse Comparison');assert.match(bad.getCell('B2').value,/Unavailable/);assert.match(bad.getCell('B7').value,/INVALID SETTINGS/);
 for(const row of bad.getRows(1,bad.rowCount))if(/^(Total (required|floor|rack)|Floor allocated|Rack allocated|Space saving)/.test(String(row.getCell(1).value)))assert.match(row.getCell(2).value,/Unavailable/);
 const zero=sample();zero[3]=0;const parts=(await S.importBytes(await bytes([H,zero]))).parts,book=await exported(parts),floor=book.getWorksheet('Floor Pallet Calculations');assert.equal(cell(floor,'Rounded Pallets per Shift'),0);assert.equal(cell(floor,'Current Stock (parts, optional)'),'Not provided');assert.equal(cell(floor,'Actual Coverage (days, optional)'),'No consumption');for(const row of book.getWorksheet('Warehouse Comparison').getRows(1,40))if(String(row.getCell(1).value).includes('(%)'))assert.match(row.getCell(2).value,/N\/A/);
});
