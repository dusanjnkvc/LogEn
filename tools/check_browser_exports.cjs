// Validate the actual files downloaded by Chrome during the manual QA flow.
const assert = require('node:assert/strict');
const fs = require('node:fs');
global.ExcelJS = require('../webapp/vendor/exceljs.min.js');
require('../webapp/domain.js');
const WorkbookService = require('../webapp/workbook.js');
const path = require('node:path');
async function main() {
  const downloads = process.argv[2];
  if (!downloads) throw new Error('Pass the Chrome downloads directory.');
  const service = new WorkbookService();
  const templateBytes=fs.readFileSync(path.join(downloads, process.argv[3] || 'LogEn_Shift_Inventory_Template.xlsx'));
  const templateBook=new ExcelJS.Workbook();await templateBook.xlsx.load(templateBytes);
  assert.deepEqual(templateBook.getWorksheet('Input Data').getRow(1).values.slice(1),['Part Number','QTY in Box','QTY boxes per Pallet','Consumption per shift','DOH (Days on hand)','L(mm)','W(mm)','H(mm)']);
  const input = await service.importBytes(templateBytes);
  assert.equal(input.parts.length, 1);
  assert.equal(input.parts[0].partNumber, 'SAMPLE-001');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fs.readFileSync(path.join(downloads, process.argv[4] || 'Shift_planning_validation_LogEn_Results.xlsx')));
  assert.deepEqual(workbook.worksheets.map(s=>s.name), ['Original Input Data','Floor Pallet Calculations','Rack Calculations','Warehouse Comparison','Warehouse Settings']);
  const comparison = workbook.getWorksheet('Warehouse Comparison');
  const values = [2,3,4,5].map(row=>comparison.getCell(`B${row}`).value);
  [11.34,27.54,7.98,33.63].forEach((expected,i)=>assert.ok(Math.abs(values[i]-expected)<1e-9));
  const settings=workbook.getWorksheet('Warehouse Settings');
  const setting=name=>settings.getRows(1,settings.rowCount).find(row=>row.getCell(1).value===name).getCell(2).value;
  assert.equal(setting('Gangway width'),4500);
  assert.equal(setting('Gangway allocation factor'),1);
  assert.equal(setting('Allocated gangway width (100%)'),4500);
  assert.equal(input.parts[0].qtyBox,20);assert.equal(input.parts[0].qtyOnPallet,40);
  assert.equal(input.parts[0].consumptionPerShift,500);assert.equal(input.parts[0].doh,5);
  assert.equal(input.parts[0].stockQty,null);assert.equal(input.parts[0].stacking,1);
  const floor=workbook.getWorksheet('Floor Pallet Calculations');
  const headers=floor.getRow(1).values.slice(1);
  const cell=name=>floor.getRow(2).getCell(headers.indexOf(name)+1).value;
  assert.equal(cell('Rounded Pallets per Shift'),1);assert.equal(cell('Required Pallets'),10);
  console.log('Chrome downloads verified: exact eight-column shift template; five result sheets; per-shift rounding; 10 pallets; footprints 11.34, 27.54, 7.98, 33.63 m².');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
