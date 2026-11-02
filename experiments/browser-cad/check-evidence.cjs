const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = __dirname;
const json = name => JSON.parse(fs.readFileSync(path.join(root,'evidence',name),'utf8'));
const source = json('source-autocad.json');
const exported = json('chrome-autocad.json');
const reopened = json('edit-reopened-autocad.json');
const browser = json('chrome-report.json');
const audit = json('audit-summary.json');
assert.equal(source.units,4);
assert.equal(exported.units,source.units);
assert.equal(reopened.units,source.units);
assert.equal(exported.entities.length,source.entities.length+3);
assert.equal(browser.inputHeader,'AC1032');
assert.equal(browser.outputHeader,'AC1032');
const sourceHandles = new Set(source.entities.map(e=>e.handle));
const differences = [];
for (const entity of source.entities) {
  const actual = exported.entities.find(e=>e.handle===entity.handle);
  assert(actual,`Missing original entity ${entity.handle}`);
  const expected = {...entity};
  const normalized = {...actual};
  // acad-ts normalizes DXF DIMENSION flag bit 32. Keep it explicit in the report.
  if (entity.type === 'DIMENSION' && entity.flags !== actual.flags) {
    differences.push({handle:entity.handle,field:'DIMENSION group 70',before:entity.flags,after:actual.flags});
    expected.flags &= ~32; normalized.flags &= ~32;
  }
  assert.deepEqual(normalized,expected,`Original geometry mismatch: ${entity.type} ${entity.handle}`);
}
const generated = exported.entities.filter(e=>!sourceHandles.has(e.handle));
assert.equal(generated.filter(e=>e.layer==='POC_RACKS').length,2);
assert.equal(generated.filter(e=>e.layer==='POC_GROUND').length,1);
for(const spec of browser.added) {
  const corners=[[spec.x,spec.y,0],[spec.x+spec.w,spec.y,0],[spec.x+spec.w,spec.y+spec.h,0],[spec.x,spec.y+spec.h,0]];
  assert(generated.some(e=>e.type==='LWPOLYLINE'&&e.layer===spec.layer&&JSON.stringify(e.points.map(p=>p.point))===JSON.stringify(corners)),`New outline coordinates mismatch: ${spec.id}`);
}
const edited = reopened.entities.filter(e=>e.layer==='POC_GROUND_EDITED');
assert.equal(edited.length,1,'The AutoCAD edit did not persist after reopening.');
assert.equal(reopened.entities.length,exported.entities.length);
const bytes=fs.readFileSync(path.join(root,'evidence/chrome-output.dwg'));
assert.equal(bytes.subarray(0,6).toString(),'AC1032');
assert.equal(bytes.length,browser.outputBytes);
const dwgSha256=crypto.createHash('sha256').update(bytes).digest('hex');
assert.equal(audit.initial.input_sha256,dwgSha256,'The AutoCAD audit does not refer to the saved browser download.');
assert.equal(audit.after_edit.input_sha256,dwgSha256,'The edit test did not start with the saved browser download.');
for(const stage of ['source','initial','after_edit','reopened']) {
  assert.equal(audit[stage].audit_errors,0,`AutoCAD audit errors at ${stage}`);
  assert.equal(audit[stage].audit_fixed,0,`AutoCAD repairs at ${stage}`);
}
const input=fs.readFileSync(path.join(root,'fixtures/warehouse-source.dwg'));
assert.equal(input.length,browser.inputBytes);
assert.equal(audit.source.input_sha256,crypto.createHash('sha256').update(input).digest('hex'));
console.log(JSON.stringify({
  result:'PASS for the included synthetic AC1032 sample',
  independentReader:'AutoCAD 2021 Core Console',
  sourceModelEntities:source.entities.length,exportedModelEntities:exported.entities.length,
  units:'millimetres; INSUNITS=4',dimensionMeasurement:source.entities.find(e=>e.type==='DIMENSION').measurement,
  verifiedAdditions:browser.added,originalEssentialGeometryPreserved:true,
  knownMetadataChanges:differences,autocadEditSavedAndReopened:true,
  dwgSha256,
  browser:browser.browser,browserTimeMs:browser.totalMs,
  androidPhysicalDevice:'NOT TESTED',
  scope:'This verifies recorded independent CAD evidence. It does not prove arbitrary DWG fidelity or production readiness.',
},null,2));
