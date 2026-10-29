/* Offline XLSX import/export. ExcelJS is bundled into the final HTML file. */
(function (global) {
  'use strict';
  const HEADERS = Object.freeze(['Part Number', 'QTY in Box', 'QTY boxes per Pallet', 'Consumption per shift', 'DOH (Days on hand)', 'L(mm)', 'W(mm)', 'H(mm)']);
  const FIELDS = ['partNumber', 'qtyBox', 'qtyOnPallet', 'consumptionPerShift', 'doh', 'length', 'width', 'height'];
  const MONTHLY_HEADERS = ['Part Number', 'Stock Quantity', 'Parts per Pallet', 'Monthly Consumption', 'Input Coverage (days)', 'L (mm)', 'W (mm)', 'H (mm)'];
  const MONTHLY_FIELDS = ['partNumber', 'stockQty', 'partsPerPallet', 'monthlyConsumption', 'providedCoverageDays', 'length', 'width', 'height'];
  const LEGACY_HEADERS = ['Part Number', 'QTY Box', 'QTY Pallet', 'QTY on Pallet', 'Consumption', 'DOH', 'L (mm)', 'W (mm)', 'H (mm)'];
  const LEGACY_FIELDS = ['partNumber', 'qtyBox', 'qtyPallet', 'qtyOnPallet', 'consumption', 'doh', 'length', 'width', 'height'];
  const ALIASES = {
    partNumber: ['Part Number', 'Part No', 'PartNo', 'PN'],
    stockQty: ['Stock Quantity', 'Current Stock', 'Total Stock', 'Stock Qty', 'Current Stock Quantity'],
    partsPerPallet: ['Parts per Pallet', 'QTY per Pallet', 'Quantity per Pallet', 'Pallet Capacity'],
    monthlyConsumption: ['Monthly Consumption', 'Consumption per Month', 'Consumption Monthly'],
    providedCoverageDays: ['Input Coverage (days)', 'Input Coverage', 'DOH', 'Stock Coverage (days)', 'Stock Coverage', 'Coverage Days'],
    length: ['L (mm)', 'Pallet Length (mm)', 'Length (mm)'],
    width: ['W (mm)', 'Pallet Width (mm)', 'Width (mm)'],
    height: ['H (mm)', 'Pallet Height (mm)', 'Height (mm)'],
    stacking: ['Stacking', 'Allowed Stacking', 'Maximum Stacking'],
    qtyBox: ['QTY in Box', 'QTY Box', 'Parts per Box'], qtyPallet: ['QTY Pallet'], qtyOnPallet: ['QTY boxes per Pallet', 'QTY on Pallet', 'Boxes per Pallet'],
    consumptionPerShift: ['Consumption per shift', 'Shift Consumption', 'Consumption per Shift (parts)'],
    consumption: ['Consumption', 'Daily Consumption'], doh: ['DOH (Days on hand)', 'DOH', 'Days on hand'],
  };
  const PLANNING_HEADERS = ['Parts per Box', 'Boxes per Pallet', 'Parts per Pallet', 'Consumption per Shift (parts)', 'Raw Pallets per Shift', 'Pallets per Shift (unrounded)', 'Shifts per Day', 'Selected DOH (days)', 'Raw Pallets per Day (selected shifts)', 'Planned Pallets per Day', 'Required Pallets (final rounding only)', 'Daily Consumption (parts/day)', 'Current Stock (parts, optional)', 'Current Pallet Equivalents (optional)', 'Current Pallet Positions (optional)', 'Actual Coverage (days, optional)', 'Input DOH (days)', 'Coverage Difference (days, optional)', 'Packaging Inferred', 'Required Pallets Formula'];
  const YELLOW = 'FFFFD600';
  const BLACK = 'FF151515';
  const SOURCE_MARKER = 'LOGEN ORIGINAL SOURCE DATA — REFERENCE ONLY';
  const normalize = value => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const raw = value => {
    if (value == null) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
    if (typeof value === 'string' || typeof value === 'boolean') return value;
    if (value instanceof Date) return value.toISOString();
    if (value.formula != null || value.sharedFormula != null) return '=' + (value.formula ?? value.sharedFormula);
    if (Array.isArray(value.richText)) return value.richText.map(run => run.text ?? '').join('');
    if (value.text != null) return String(value.text);
    if (value.error != null) return String(value.error);
    return String(value);
  };
  const inputValues = part => FIELDS.map(field => part[field] ?? null);
  const planningValues = (planning, input, settings) => !planning ? PLANNING_HEADERS.map(() => null) : [planning.qtyBox, planning.qtyOnPallet, planning.partsPerPallet, planning.consumptionPerShift, planning.palletsPerShift, planning.roundedPalletsPerShift, settings.shiftsPerDay, planning.targetCoverageDays, planning.palletsPerDay, planning.plannedPalletsPerDay, planning.requiredPallets, planning.dailyConsumption, planning.stockQty ?? 'Not provided', planning.currentPallets ?? 'N/A — stock not provided', planning.currentPalletPositions ?? 'N/A — stock not provided', planning.actualCoverageDays ?? (planning.noConsumption ? 'No consumption' : 'N/A — stock not provided'), input.doh, planning.coverageDifferenceDays ?? 'N/A', Boolean(input.packagingInferred), `CEILING(${input.consumptionPerShift} / ${input.qtyBox} / ${input.qtyOnPallet} × ${settings.shiftsPerDay} × ${planning.targetCoverageDays}) = ${planning.requiredPallets}`];

  function add(sheet, values, kind) {
    const row = sheet.addRow(values.length ? values.map(value => value == null ? null : typeof value === 'number' && !Number.isFinite(value) ? String(value) : value) : ['']);
    row.eachCell({ includeEmpty: true }, cell => {
      cell.font = { name: 'Calibri', size: kind === 'kpi' ? 15 : 11, color: { argb: kind === 'header' ? YELLOW : BLACK }, bold: Boolean(kind) };
      cell.alignment = { vertical: 'middle', wrapText: true };
      if (kind) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: kind === 'header' ? BLACK : YELLOW } };
    });
    if (kind === 'header') row.height = 34;
    if (kind === 'kpi') row.height = 32;
    return row;
  }

  function table(workbook, name, headers, areaColumns = []) {
    const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    add(sheet, headers, 'header');
    headers.forEach((header, index) => {
      const column = sheet.getColumn(index + 1);
      column.width = header === 'Validation Errors' ? 80 : index === 0 ? 27 : 24;
      if (areaColumns.includes(index)) column.numFmt = '#,##0.00';
    });
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
    return sheet;
  }

  class LogEnWorkbook {
    static get headers() { return HEADERS.slice(); }

    _workbook() {
      if (!global.ExcelJS || !global.ExcelJS.Workbook) throw new Error('The bundled Excel library is unavailable. Open the complete LogEn HTML file.');
      const workbook = new global.ExcelJS.Workbook();
      workbook.creator = 'LogEn';
      workbook.subject = 'Offline warehouse floor and rack footprint comparison';
      workbook.created = new Date();
      return workbook;
    }

    async templateBytes() {
      const workbook = this._workbook();
      const sheet = table(workbook, 'Input Data', HEADERS);
      add(sheet, ['SAMPLE-001', 20, 40, 500, 5, 1200, 800, 1000]);
      const notes = workbook.addWorksheet('Instructions');
      add(notes, ['LogEn — warehouse input template'], 'header');
      [
        'Keep exactly these eight template headings. Replace or delete SAMPLE-001 before adding your parts.',
        'QTY in Box = individual parts in one box. QTY boxes per Pallet = boxes on one pallet.',
        'Consumption per shift = individual parts consumed during one shift. This is neither daily nor monthly consumption.',
        'DOH (Days on hand) = required coverage days for that part. Choose input DOH or a custom project DOH override.',
        'Required pallets = consumption per shift / parts per box / boxes per pallet × shifts per day × DOH. Keep all intermediate decimals; round up only the final required pallet quantity.',
        'Multiply raw pallet demand per shift by selected shifts and DOH without intermediate rounding; round up only the final required pallets.',
        'Shifts per day must be 1, 2 or 3; the default is 2. Custom project DOH defaults to 5 days.',
        'L(mm), W(mm) and H(mm) are loaded pallet dimensions in millimeters.',
        'The eight-column template omits stacking: floor stacking defaults to 1. An optional extra Stacking column is supported. Enable Stackability in Shifts & days on hand to edit and apply the saved factor for each part; unchecked uses effective stacking 1 without erasing saved factors.',
        'Current stock quantity is optional. If absent, actual stock coverage remains unavailable rather than being treated as zero stock.',
        'Old monthly and daily templates remain supported with explicit conversion notices. Legacy consumption is converted once using the production settings selected at import.',
        'If old data has only direct parts-per-pallet capacity, packaging is inferred as one box containing that capacity. Review inferred packaging before using calculated demand.',
        'Use numeric cells or decimal-point text. Formula cells are not evaluated; paste calculated values before importing.',
        'Use one unique part number per row. Invalid and duplicate rows remain visible. Both floor and rack scenarios use the same required pallets.',
        'GS with gangway = GS net + lane width (mm) * lanes * physical gangway (m) / 2000.',
        'Floor without gangways retains actual occupied rows and clearances. Its project total sums each independently valid floor storage result rounded to two decimals; rack fit errors do not remove valid floor areas. Rack gangways retain actual rack run frontage × full gangway width. These are allocated planning estimates, not optimized layouts.',
        'All imports, calculations, projects and exports work offline on this device.',
      ].forEach(line => add(notes, [line]));
      notes.getColumn(1).width = 120;
      return new Uint8Array(await workbook.xlsx.writeBuffer());
    }

    async importBytes(bytes, settings = {}) {
      const workbook = this._workbook();
      try { await workbook.xlsx.load(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes); }
      catch (_) { throw new Error('This file could not be read as an Excel .xlsx workbook. Save it as .xlsx and try again.'); }
      let input = null, headerRow = 0, columns, kind;
      const schemas = [{ fields: FIELDS, headers: HEADERS, kind: 'shift' }, { fields: MONTHLY_FIELDS, headers: MONTHLY_HEADERS, kind: 'monthly' }, { fields: LEGACY_FIELDS, headers: LEGACY_HEADERS, kind: 'daily' }];
      for (const sheet of workbook.worksheets) {
        for (let rowIndex = 1; rowIndex <= Math.min(sheet.rowCount, 30); rowIndex++) {
          const candidate = new Map();
          sheet.getRow(rowIndex).eachCell((cell, index) => { const key = normalize(raw(cell.value)); candidate.set(key, [...(candidate.get(key) || []), index]); });
          for (const schema of schemas) {
            const mapping = new Map(), duplicates = [];
            for (let index = 0; index < schema.fields.length; index++) {
              const field = schema.fields[index];
              const matches = [...new Set(ALIASES[field].map(normalize).flatMap(alias => candidate.get(alias) || []))];
              if (matches.length > 1) duplicates.push(schema.headers[index]);
              if (matches.length) mapping.set(field, matches[0]);
            }
            if (mapping.size !== schema.fields.length) continue;
            for (const field of ['stacking', 'stockQty']) {
              if (mapping.has(field)) continue;
              const matches = [...new Set(ALIASES[field].map(normalize).flatMap(alias => candidate.get(alias) || []))];
              if (matches.length > 1) duplicates.push(field);
              if (matches.length) mapping.set(field, matches[0]);
            }
            if (duplicates.length) throw new Error('Ambiguous duplicate column headings: ' + duplicates.join(', ') + '. Keep one column for each heading.');
            input = sheet; headerRow = rowIndex; columns = mapping; kind = schema.kind; break;
          }
          if (input) break;
        }
        if (input) break;
      }
      if (!input) throw new Error('No worksheet contains the eight required headings: ' + HEADERS.join(', ') + '. Download the current LogEn template. Older monthly and daily templates are also supported.');
      const rawInputRows = [];
      for (let index = 1; index <= input.rowCount; index++) {
        const values = [], row = input.getRow(index);
        for (let column = 1; column <= input.columnCount; column++) values.push(raw(row.getCell(column).value));
        rawInputRows.push(values);
      }
      const parts = [], warnings = [], sourceRows = [];
      const sourceMarker = rawInputRows.findIndex(row => row[0] === SOURCE_MARKER && row.slice(1).every(value => value == null || value === ''));
      const inputLastRow = sourceMarker >= 0 ? sourceMarker : input.rowCount;
      const workingDays = Number(settings.workingDaysPerMonth ?? 22), shifts = Number(settings.shiftsPerDay ?? 2);
      if (kind !== 'shift' && ![1, 2, 3].includes(shifts)) throw new Error('Legacy conversion requires 1, 2 or 3 shifts per day.');
      if (kind === 'monthly' && (!Number.isFinite(workingDays) || workingDays <= 0)) throw new Error('Legacy monthly conversion requires a positive working-days-per-month setting.');
      if (kind === 'daily') warnings.push('Legacy daily template converted once: Consumption is DAILY and was divided by ' + shifts + ' shifts per day to obtain consumption per shift. QTY Box and QTY on Pallet retain their packaging meaning; old entered pallets supply optional current stock.');
      if (kind === 'monthly') warnings.push('Legacy monthly template converted once: Monthly Consumption was divided by ' + workingDays + ' working days per month and ' + shifts + ' shifts per day. Direct pallet capacity requires inferred packaging; review it before using calculated demand.');
      for (let rowIndex = headerRow + 1; rowIndex <= inputLastRow; rowIndex++) {
        const row = rawInputRows[rowIndex - 1];
        if (row.every(value => value == null || String(value).trim() === '')) continue;
        const errors = [];
        const value = field => columns.has(field) ? row[columns.get(field) - 1] : null;
        const numeric = (field, label, optional = false, fallback = 0) => {
          const cell = value(field);
          if (cell == null || String(cell).trim() === '') {
            if (!optional) errors.push('Excel row ' + rowIndex + ': ' + label + ' is required. Enter 0 explicitly when the value is zero.');
            return optional ? fallback : 0;
          }
          const text = String(cell).trim();
          const number = typeof cell === 'number' ? cell : /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text) ? Number(text) : NaN;
          if (!Number.isFinite(number)) { errors.push('Excel row ' + rowIndex + ': ' + label + ' must be a finite number. Formula cells are not evaluated; paste values before importing.'); return 0; }
          return number;
        };
        const part = { partNumber: String(value('partNumber') ?? '').trim(), stacking: numeric('stacking', 'Stacking', true, 1), inputErrors: errors };
        const schema = schemas.find(schema => schema.kind === kind);
        for (let index = 1; index < schema.fields.length; index++) {
          const field = schema.fields[index];
          part[field] = numeric(field, schema.headers[index], field === 'stockQty' || field === 'qtyPallet', null);
        }
        if (kind === 'shift') part.stockQty = numeric('stockQty', 'Current stock quantity', true, null);
        if (kind === 'monthly') part.doh = part.providedCoverageDays;
        if (kind === 'daily') part.stockQty = part.qtyPallet == null ? null : part.qtyPallet * part.qtyBox * part.qtyOnPallet;
        const normalized = global.LogEnDomain.normalizePart(part, settings);
        parts.push(normalized); sourceRows.push(rowIndex);
      }
      const occurrences = new Map();
      parts.forEach((part, index) => { const key = part.partNumber.toUpperCase(); if (key) occurrences.set(key, [...(occurrences.get(key) || []), index]); });
      for (const indices of occurrences.values()) if (indices.length > 1) warnings.push('Duplicate part number on Excel rows ' + indices.map(index => sourceRows[index]).join(', ') + '. Use one row per part number.');
      const inferred = parts.filter(part => part.packagingInferred);
      if (inferred.length) warnings.push(inferred.length + ' part numbers use inferred packaging: QTY in Box = legacy pallet capacity and QTY boxes per Pallet = 1. Review the actual box quantities.');
      if (!parts.length) warnings.push('The input worksheet has no part data.');
      if (workbook.worksheets.length > 1) warnings.push('Imported worksheet “' + input.name + '”. Other worksheets were not imported.');
      if (parts.some(part => part.inputErrors.length)) warnings.push('Some input rows contain errors. They remain visible in results and are excluded from comparison totals until corrected.');
      return { parts, warnings, rawInputRows: sourceMarker >= 0 ? rawInputRows.slice(sourceMarker + 1) : rawInputRows };
    }
    async exportBytes(project, calculation) {
      const workbook = this._workbook();
      const sourceRows = project.rawInputRows;
      const original = workbook.addWorksheet('Original Input Data', { views: [{ state: 'frozen', ySplit: 1 }] });
      const canonicalParts = project.parts.map(part => global.LogEnDomain.normalizePart(part, project.settings));
      const includeStacking = canonicalParts.some(part => part.stacking !== 1);
      const includeStock = canonicalParts.some(part => part.stockQty != null);
      add(original, [...HEADERS, ...(includeStacking ? ['Stacking'] : []), ...(includeStock ? ['Current Stock'] : [])], 'header');
      canonicalParts.forEach(part => add(original, [...inputValues(part), ...(includeStacking ? [part.stacking] : []), ...(includeStock ? [part.stockQty] : [])]));
      if (sourceRows && sourceRows.length) {
        add(original, []); add(original, [SOURCE_MARKER], 'header');
        sourceRows.forEach((row, index) => add(original, row, index === 0 ? 'header' : undefined));
      }
      for (let column = 1; column <= original.columnCount; column++) original.getColumn(column).width = column === 1 ? 27 : 22;

      const floorHeaders = [...HEADERS, 'Allowed Floor Stacking', 'Status', 'Validation Errors', 'Required Parts', 'Required Pallets', 'Maximum Stacking by Height', 'Effective Floor Stacking', 'Floor Positions', 'Pallets Per Row', 'Required Floor Rows', 'Row Width (m)', 'Deepest Actual Occupied Row Depth (m)', 'Without Gangways (m²)', 'Allocated Gangway Area (m²)', 'With Allocated Gangways (m²)', 'Full Row Actual Depth (m)', 'Last Row Actual Depth (m)', 'Last Row Pallets', 'Total Occupied Row Depth (m)', ...PLANNING_HEADERS, 'Floor positions (whole)', 'Formula Storage Base (m²)', 'Floor With Gangways Formula'];
      const floor = table(workbook, 'Floor Pallet Calculations', floorHeaders, floorHeaders.map((header, index) => /\(m²\)|\(days\)|Consumption|Pallets per Day|equivalent/.test(header) ? index : -1).filter(index => index >= 0));
      calculation.results.forEach(result => {
        const value = result.floor;
        add(floor, [...inputValues(result.input), result.input.stacking, result.isFloorValid ? (result.isValid ? 'Valid' : 'Included in floor totals — rack validation warning') : 'Invalid floor — excluded from floor totals', (result.errors || []).join(' | '), result.requiredParts, result.requiredPallets, value?.maximumStacking, value?.effectiveStacking, value?.positions, value?.palletsPerRow, value?.rows, value?.rowWidth, value?.rowDepth, result.isFloorValid ? value?.storageArea : null, result.isFloorValid ? value?.gangwayArea : null, result.isFloorValid ? value?.withGangways : null, value?.fullRowDepth, value?.lastRowDepth, value?.lastRowPallets, value?.totalOccupiedDepth, ...planningValues(result.planning, result.input, project.settings), value?.formulaPositions, value?.formulaStorageArea, value ? `GS net + lane width * lanes * gangway metres / 2000 = ${value.withoutGangways} + ${value.rowWidth * 1000} * ${value.rows} * ${project.settings.gangwayWidth / 1000} / 2000` : null]);
      });
      const rackHeaders = ['Part Number', 'Status', 'Validation Errors', 'Required Pallets', 'Pallet L (mm)', 'Pallet W (mm)', 'Loaded H (mm)', 'Rotated 90 Degrees', 'Boxes per Rack Slot (Required storage pallets)', 'Rack Levels', 'Capacity Per Bay', 'Required Rack Bays', 'Effective Bay Length (mm)', 'Effective Bay Depth (mm)', 'Effective Bay Height (mm)', 'Maximum Bays Per Run', 'Required Rack Runs', 'Bays Per Run', 'Actual Run Lengths (m)', 'Total Run Frontage (m)', 'Without Gangways (m²)', 'Allocated Gangway Area (m²)', 'With Allocated Gangways (m²)', ...PLANNING_HEADERS, 'Rack Fit', 'Usable Shelf Footprint (m²)', 'Available Shelf Surface (m²)', 'Occupied Shelf Surface (m²)', 'Unused Rack Surface (m²)', 'Unused Surface per Level (m²)', 'Rack Utilization (%)', 'Unused Shelf Surface (%)'];
      const rack = table(workbook, 'Rack Calculations', rackHeaders, rackHeaders.map((h,i) => /m²|%/.test(h) ? i : -1).filter(i => i >= 0));
      calculation.results.forEach(result => {
        const value = result.rack;
        add(rack, [result.input.partNumber, result.isRackValid ? (result.isValid ? 'Valid' : 'Included in rack totals — floor validation warning') : 'Invalid rack — excluded from rack totals', (result.errors || []).join(' | '), result.requiredPallets, result.input.length, result.input.width, result.input.height, value?.rotated, value?.palletsPerSlot ?? (result.rackFit === 'NO' ? 0 : null), value?.levels, value?.capacityPerBay, value?.bays ?? (result.rackFit === 'NO' ? 0 : null), value?.effectiveBayLength, value?.effectiveBayDepth, value?.effectiveBayHeight, value?.maxBaysPerRun, value?.runs, value?.baysPerRun.join(', '), value?.baysPerRun.map(bays => (bays * value.effectiveBayLength / 1000).toFixed(3)).join(', '), value ? value.bays * value.effectiveBayLength / 1000 : null, result.isRackValid ? value?.withoutGangways : null, result.isRackValid ? value?.gangwayArea : null, result.isRackValid ? value?.withGangways : null, ...planningValues(result.planning, result.input, project.settings), result.rackFit || 'N/A', value?.bayArea, value?.availableShelfArea, value?.occupiedShelfArea, value?.unusedShelfArea, value?.unusedPerLevel, value?.utilizationPercent, value?.unusedPercent]);
      });


      add(rack, []);
      add(rack, ['Shared rack allocation', calculation.sharedRack?.available ? 'Dashboard totals use shared PN shelves; the preceding part rows are standalone estimates.' : 'Shared allocation unavailable; standalone totals used.'], 'header');
      if (calculation.sharedRack?.available) {
        add(rack, ['Physical bays', calculation.sharedRack.bays]);
        add(rack, ['Shared rack net m²', calculation.sharedRack.withoutGangways]);
        add(rack, ['Bay', 'Shelf', 'Part Number', 'X (mm)', 'Y (mm)', 'Unit length (mm)', 'Unit depth (mm)'], 'header');
        calculation.sharedRack.shelves.forEach((shelf,i) => shelf.placements.forEach(p => add(rack, [Math.floor(i/project.settings.rackLevels)+1, i%project.settings.rackLevels+1,p.partNumber,p.x,p.y,p.length,p.depth])));
      }
      const comparison = workbook.addWorksheet('Warehouse Comparison');
      add(comparison, ['LogEn — ' + project.name, 'Footprint (m²)'], 'header');
      const available = !calculation.settingsErrors?.length;
      [
        ['Pallets without gangways (m²)', calculation.floorWithoutGangways],
        ['Pallets with allocated gangways (m²)', calculation.floorWithGangways],
        ['Racks without gangways (m²)', calculation.rackWithoutGangways],
        ['Racks with allocated gangways (m²)', calculation.rackWithGangways],
      ].forEach(([label, value]) => add(comparison, [label, available ? value : 'Unavailable — invalid settings'], 'kpi'));
      add(comparison, []);
      [
        ['Totals status', !available ? 'INVALID SETTINGS — totals unavailable' : calculation.invalidCount ? 'PARTIAL TOTALS — ' + calculation.invalidCount + ' part rows need review; each storage scenario includes its calculable rows' : 'Complete — all imported part rows are valid'],
        ['Settings validation', (calculation.settingsErrors || []).join(' | ')],
        ['Total imported part rows', project.parts.length],
        ['Fully valid comparison rows', calculation.validCount],
        ['Floor part rows included in totals', calculation.floorValidCount],
        ['Rack part rows included in totals', calculation.rackValidCount],
        ['Invalid part rows', calculation.invalidCount],
        ['Total required pallets (valid planning rows)', calculation.totalRequiredPallets],
        ['Total floor positions', calculation.totalFloorPositions],
        ['Total floor rows', calculation.totalFloorRows],
        ['Total rack bays', calculation.totalRackBays],
        ['Total rack runs', calculation.totalRackRuns],
        ['Floor allocated gangway area (m²)', calculation.floorGangwayArea],
        ['Rack allocated gangway area (m²)', calculation.rackGangwayArea],
        ['Space saving without gangways (m²)', calculation.savingWithoutGangways],
        ['Space saving without gangways (%)', calculation.savingWithoutGangwaysPercent ?? 'N/A — floor footprint is zero'],
        ['Space saving with allocated gangways (m²)', calculation.savingWithGangways],
        ['Space saving with allocated gangways (%)', calculation.savingWithGangwaysPercent ?? 'N/A — floor footprint is zero'],
      ].forEach(row => {
        if (!available && /^(Total (required|floor|rack)|Floor allocated|Rack allocated|Space saving)/.test(row[0])) {
          row[1] = 'Unavailable — invalid settings';
        }
        add(comparison, row);
      });
      add(comparison, []);
      [
        'Both storage scenarios use the same required pallets, with dedicated floor rows and rack bays per part.',
        'Excel-style allocations: both scenarios allocate half a shared physical gangway.',
        'GS with gangway = GS net + lane width (mm) * lanes * physical gangway (m) / 2000.',
        'GS net = deepest occupied lane depth (mm) * lane width (mm) * lane count / 1000000; partial lanes reserve the same depth.',
        'GS net = deepest occupied lane depth (mm) * lane width (mm) * lane count / 1000000; partial lanes reserve the same depth.',
        'PR with gangway = whole rack bays * rack pitch (mm) * physical gangway (m) / 2000. Do not add PR net.',
        'Allocated footprints are planning estimates, not optimized physical warehouse designs. Count shared gangways once in an actual layout.',
        'Floor and rack totals include independently calculable rows. A rack fit error does not exclude a valid floor result, and a floor fit error does not exclude a valid rack result. Duplicate and invalid input rows remain listed but do not contribute.',
        'Negative savings mean racks require more floor area. N/A percentages have a zero floor denominator.',
        'Pallets without gangways equals the full-precision sum of Floor storage m² contributions exported as Without Gangways (m²). Full precision is summed internally; only displayed values round to two decimals.',
      ].forEach(line => add(comparison, [line]));
      add(comparison, []);
      add(comparison, ['Decimal pallet demand and DOH planning'], 'header');
      add(comparison, ['Available shelf surface (m²)', calculation.rackAvailableShelfArea]);
      add(comparison, ['Occupied shelf surface (m²)', calculation.rackOccupiedShelfArea]);
      add(comparison, ['Unused shelf surface (m²; not warehouse floor space)', calculation.rackUnusedShelfArea]);
      add(comparison, ['Unused surface equivalent per level (m²)', calculation.rackUnusedPerLevel]);
      add(comparison, ['Overall rack utilization (%)', calculation.rackUtilizationPercent]);
      add(comparison, ['Overall unused shelf surface (%)', calculation.rackUnusedPercent]);
      add(comparison, ['Non-fitting required pallets', calculation.nonFittingPallets]);
      add(comparison, ['Non-fitting distinct part numbers', calculation.nonFittingPartCount]);
      add(comparison, ['Non-fitting parts with unavailable pallet quantity', calculation.nonFittingUnknownQuantity]);
      add(comparison, ['Part Number', 'Status', 'Validation Errors', ...PLANNING_HEADERS], 'header');
      calculation.results.forEach(result => add(comparison, [result.input.partNumber, result.isPlanningValid ? (result.isValid ? 'Valid' : 'Valid planning — storage scenario needs review') : 'Invalid planning — excluded', (result.errors || []).join(' | '), ...planningValues(result.planning, result.input, project.settings)]));
      add(comparison, []);
      add(comparison, ['Required-pallet formula', 'Consumption per shift / parts per box / boxes per pallet × selected shifts × selected DOH, then round up only the final result.']);
      add(comparison, ['Optional stock interpretation', 'The eight-column input has no current stock quantity. Actual stock coverage is unavailable unless older or optional stock data is provided. Unknown stock is never treated as zero.']);
      comparison.getColumn(1).width = 105;
      comparison.getColumn(2).width = 75;
      comparison.getColumn(2).numFmt = '#,##0.00';

      const settings = table(workbook, 'Warehouse Settings', ['Setting', 'Value', 'Unit / Description']);
      const s = project.settings;
      [
        ['Project', project.name], ['Source workbook', project.sourceName || 'Manual entry'], ['Exported at (UTC)', new Date().toISOString()],
        ['Stock formula', 'Round combined selected-shift daily demand, then apply DOH', 'Always used for both floor and rack scenarios'],
        ['Shifts per day', s.shiftsPerDay, 'integer: 1, 2 or 3'],
        ['Stackability', Boolean(s.stackabilityEnabled), 'enabled: saved per-part factor capped by height; disabled: effective stacking 1; saved factors retained'],
        ['DOH mode', s.coverageMode, 'input = each part DOH; custom = project DOH override'],
        ['Project DOH override', s.customCoverageDays, 'days; applied when DOH mode is custom'],
        ['Legacy import working days per month', s.workingDaysPerMonth ?? 22, 'only needed to migrate older monthly data; canonical per-shift consumption stays fixed'],
        ['Packaging warnings', calculation.results.filter(result => result.input.packagingInferred).map(result => result.input.partNumber).join(', ') || 'None', 'Inferred packaging should be checked against actual boxes per pallet'],
        ['Optional stock warnings', calculation.results.filter(result => result.planning?.stockQty == null).length, 'part numbers with no provided current stock quantity; actual coverage is unavailable'],
        ['Maximum floor stacking height', s.maxFloorStackingHeight, 'mm'], ['Maximum floor row depth LIMIT', s.maxFloorRowDepth, 'mm; 0 = unlimited. Storage-only footprint uses actual occupied depth.'],
        ['Gangway width', s.gangwayWidth, 'mm; full configured width'],
        ['Gangway allocation factor', 1, '100% for both floor and rack footprints'],
        ['Allocated gangway width (100%)', global.LogEnDomain.allocatedGangwayWidth(s), 'mm; configured gangway width'],
        ['Floor pallet clearance', s.floorPalletClearance, 'mm; full clearance added to both pallet L and W for ground storage only'],
        ['Floor storage total rounding', 'Sum of row areas rounded to two decimals', 'm²; independently valid floor rows, including rows with rack fit errors'],
        ['Legacy rack surface allowance (unused)', s.rackSurfaceAllowance ?? 4.125, 'm²; shelf footprint now uses usable length × depth'], ['Rack pitch', s.rackPitch ?? 3300, 'mm'], ['Rack levels', s.rackLevels, 'levels'], ['Usable shelf length', s.rackSlotLength, 'mm'],
        ['Usable shelf depth', s.rackSlotDepth, 'mm'], ['Usable shelf height', s.rackSlotHeight, 'mm'],
        ['Rack structural length allowance', s.rackStructuralLength, 'mm'], ['Rack structural depth allowance', s.rackStructuralDepth, 'mm'],
        ['Between boxes allowance', s.betweenBoxesAllowance ?? 0, 'mm; between units in both shelf directions only, no edge or vertical gap'], ['Rack structural height allowance', s.rackStructuralHeight, 'mm'], ['Maximum rack run length', s.maxRackRunLength, 'mm'],
        ['Legacy rack frontage clearance (unused)', s.rackFrontageClearance, 'mm; usable shelf dimensions already exclude required clearance'],
        ['Legacy rack depth clearance (unused)', s.rackDepthClearance, 'mm'], ['Legacy rack vertical clearance (unused)', s.rackVerticalClearance, 'mm'],
        ['Rack horizontal orientations', 'Both always evaluated', 'no vertical rotation or stacking within one slot'],
      ].forEach(row => add(settings, row));
      add(settings, []);
      [
        'Parts per pallet = QTY in Box × QTY boxes per Pallet. Raw pallets per shift = Consumption per shift / QTY in Box / QTY boxes per Pallet.',
        'Required pallets = consumption per shift / parts per box / boxes per pallet × shifts per day × DOH. Keep all intermediate decimals; round up only the final required pallet quantity.',
        'Required pallets = consumption per shift / parts per box / boxes per pallet × shifts per day × DOH. Keep all intermediate decimals; round up only the final required pallet quantity.',
        'Required pallets = consumption per shift / parts per box / boxes per pallet × shifts per day × DOH. Keep all intermediate decimals; round up only the final required pallet quantity.',
        'DOH mode input uses each part’s DOH; custom uses the project DOH override. No current stock quantity is required by the eight-column template.',
        'Stackability disabled uses floor stacking 1. When enabled, each part uses its saved stacking factor capped by the height limit. Saved per-part factors are retained when disabled.',
        'Floor stacking = MIN(Stackability enabled ? saved Stacking : 1, FLOOR(maximum floor stacking height / loaded pallet H)). Floor positions = CEILING(required pallets / effective stacking).',
        'Ground length = pallet L + clearance; ground width = pallet W + clearance. Pallets per row = FLOOR(maximum row depth LIMIT / ground length). Limit 0 means one unrestricted row per part. Rows = CEILING(floor positions / pallets per row).',
        'GS net = deepest occupied lane depth (mm) * lane width (mm) * lane count / 1000000; partial lanes reserve the same depth.',
        'GS with gangway = GS net + lane width (mm) * lanes * physical gangway (m) / 2000.',
        'Boxes per slot = MAX(FLOOR((shelf L + g) / (unit L + g)) * FLOOR((shelf D + g) / (unit W + g)), FLOOR((shelf L + g) / (unit W + g)) * FLOOR((shelf D + g) / (unit L + g))); g is Between boxes allowance, between units only; unit height must fit usable shelf height. Both orientations, no vertical stacking.',
        'Required storage pallets are rack units, using existing L/W/H. Usable shelf dimensions already exclude clearances/structure. No extra clearance or structural allowance is added to shelf area.',
        'Capacity per bay = boxes per slot × rack levels. Rack bays = CEILING(required pallets / capacity per bay). Floor stacking never applies to racks.',
        'PR net = whole rack bays * usable shelf length * depth / 1000000. Levels do not multiply the floor footprint.',
        'Maximum bays per run = FLOOR(maximum run length / effective bay L). Runs = CEILING(bays / maximum bays per run). Final run uses only assigned bays.',
        'PR with gangway = whole rack bays * rack pitch (mm) * physical gangway (m) / 2000. Do not add PR net.',
        'Structural height allowance describes physical bay height; it does not increase usable loaded-pallet height or multiply the ground footprint.',
      ].forEach(line => add(settings, [line]));
      settings.getColumn(1).width = 115;
      settings.getColumn(2).width = 35;
      settings.getColumn(3).width = 65;
      workbook.views = [{ activeTab: 3, firstSheet: 0, visibility: 'visible' }];
      return new Uint8Array(await workbook.xlsx.writeBuffer());
    }
  }
  global.LogEnWorkbook = LogEnWorkbook;
  if (typeof module !== 'undefined' && module.exports) module.exports = LogEnWorkbook;
})(globalThis);




