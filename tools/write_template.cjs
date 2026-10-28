// Generate the user-facing template using the same service as the offline app.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
globalThis.ExcelJS = require('../webapp/vendor/exceljs.min.js');
require('../webapp/domain.js');
const WorkbookService = require('../webapp/workbook.js');
async function main() {
  const service = new WorkbookService();
  const bytes = await service.templateBytes();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const sheet = workbook.getWorksheet('Input Data');
  const expected = ['Part Number','QTY in Box','QTY boxes per Pallet','Consumption per shift','DOH (Days on hand)','L(mm)','W(mm)','H(mm)'];
  assert.equal(sheet.columnCount,8);
  assert.deepEqual(sheet.getRow(1).values.slice(1),expected);
  const imported = await service.importBytes(bytes);
  const result = LogEnDomain.calculateProject(imported.parts,LogEnDomain.createDefaultSettings());
  assert.equal(result.invalidCount,0);
  assert.equal(result.totalRequiredPallets,10);
  const target = path.join(__dirname,'..','LogEn_Shift_Inventory_Template.xlsx');
  fs.writeFileSync(target,bytes);
  console.log('Generated and re-imported '+target+' — exact 8 columns, sample requires 10 pallets.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
