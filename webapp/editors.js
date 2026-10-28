(function () {
  'use strict';

  const CANCEL = Symbol('cancel');
  const $ = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const display = value => {
    if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—';
    const number = Number(value);
    return number !== 0 && Math.abs(number) < 1e-8
      ? number.toExponential(4)
      : new Intl.NumberFormat('en-GB', { maximumFractionDigits: 8 }).format(number);
  };
  const area = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
    ? `${new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      .format(Math.round((Number(value) + 1e-9) * 100) / 100)} m²`
    : '—';

  function section(body, heading, description) {
    const wrapper = $('section', 'editor-section');
    wrapper.append($('h3', 'section-heading', heading));
    if (description) wrapper.append($('p', 'muted', description));
    body.append(wrapper);
    return wrapper;
  }

  function notice(text, error = false) {
    const element = $('div', `notice${error ? ' error' : ''}`, text);
    if (error) element.setAttribute('role', 'alert');
    return element;
  }

  function numberField(grid, key, label, value, options = {}) {
    const wrapper = $('label', 'field');
    wrapper.append($('span', '', label));
    const row = $('div', 'input-unit');
    const input = $('input');
    input.name = key;
    input.type = 'number';
    input.inputMode = options.integer ? 'numeric' : 'decimal';
    input.step = options.integer ? '1' : 'any';
    input.min = options.positive ? '0.000000001' : '0';
    input.value = Number.isFinite(Number(value)) ? String(value) : '';
    input.required = true;
    input.autocomplete = 'off';
    row.append(input);
    if (options.unit) row.append($('span', 'muted field-unit', options.unit));
    const error = $('small', 'field-error');
    error.id = `field-${key}-${Math.random().toString(36).slice(2, 8)}`;
    input.setAttribute('aria-describedby', error.id);
    wrapper.append(row, error);
    grid.append(wrapper);
    input.addEventListener('input', () => {
      error.textContent = '';
      input.removeAttribute('aria-invalid');
    });
    return {
      input,
      read() {
        const raw = input.value.trim();
        const number = Number(raw);
        let message = '';
        if (!raw || !Number.isFinite(number)) message = 'Enter a finite number.';
        else if (options.integer && !Number.isInteger(number)) message = 'Enter a whole number.';
        else if (options.positive ? number <= 0 : number < 0) {
          message = options.positive ? 'Must be greater than zero.' : 'Cannot be negative.';
        }
        error.textContent = message;
        if (message) input.setAttribute('aria-invalid', 'true');
        return message ? undefined : number;
      }
    };
  }

  function textField(body, label, value, options = {}) {
    const wrapper = $('label', 'field');
    wrapper.append($('span', '', label));
    const input = $('input');
    input.type = 'text';
    input.value = value ?? '';
    input.maxLength = options.maxLength ?? 120;
    input.placeholder = options.placeholder ?? '';
    input.autocomplete = 'off';
    input.required = true;
    const error = $('small', 'field-error');
    input.addEventListener('input', () => {
      error.textContent = '';
      input.removeAttribute('aria-invalid');
    });
    wrapper.append(input, error);
    body.append(wrapper);
    return {
      input,
      read() {
        const value = input.value.trim();
        error.textContent = value ? '' : `Enter a ${label.toLowerCase()}.`;
        if (!value) input.setAttribute('aria-invalid', 'true');
        return value || undefined;
      }
    };
  }

  function modal({ title, subtitle, eyebrow = 'LOGEN', button = 'Save', cancel = true, build }) {
    return new Promise(resolve => {
      const dialog = $('dialog', 'app-dialog');
      const form = $('form', 'dialog-form');
      form.noValidate = true;
      const head = $('div', 'dialog-head');
      const heading = $('div');
      const titleElement = $('h2', '', title);
      titleElement.id = `dialog-title-${Math.random().toString(36).slice(2, 8)}`;
      dialog.setAttribute('aria-labelledby', titleElement.id);
      heading.append($('span', 'eyebrow', eyebrow), titleElement);
      if (subtitle) {
        const subtitleElement = $('p', 'muted', subtitle);
        subtitleElement.id = `${titleElement.id}-description`;
        dialog.setAttribute('aria-describedby', subtitleElement.id);
        heading.append(subtitleElement);
      }
      const close = $('button', 'dialog-close', '×');
      close.type = 'button';
      close.setAttribute('aria-label', 'Close dialog');
      head.append(heading, close);
      const body = $('div', 'dialog-body');
      const errors = notice('', true);
      errors.hidden = true;
      const state = build(body, errors);
      body.append(errors);
      const footer = $('div', 'dialog-actions');
      if (cancel) {
        const cancelButton = $('button', 'btn btn-secondary', 'Cancel');
        cancelButton.type = 'button';
        cancelButton.addEventListener('click', () => finish(CANCEL));
        footer.append(cancelButton);
      }
      const submit = $('button', 'btn btn-primary', button);
      submit.type = 'submit';
      footer.append(submit);
      form.append(head, body, footer);
      dialog.append(form);
      document.body.append(dialog);
      let finished = false;
      const finish = value => {
        if (finished) return;
        finished = true;
        dialog.close();
        dialog.remove();
        resolve(value === CANCEL ? null : value);
      };
      close.addEventListener('click', () => finish(CANCEL));
      dialog.addEventListener('cancel', event => {
        event.preventDefault();
        finish(CANCEL);
      });
      form.addEventListener('submit', event => {
        event.preventDefault();
        errors.hidden = true;
        const value = state.read();
        if (value !== undefined) finish(value);
        else body.querySelector('[aria-invalid="true"]')?.focus();
      });
      dialog.addEventListener('click', event => {
        // Only a click fully outside the dialog dismisses the modal.
        if (event.target !== dialog) return;
        const bounds = dialog.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right ||
            event.clientY < bounds.top || event.clientY > bounds.bottom) finish(CANCEL);
      });
      dialog.showModal();
      requestAnimationFrame(() => (state.focus ?? body.querySelector('input,select,button'))?.focus());
    });
  }

  const defaults = {
    maxFloorStackingHeight: 5000, maxFloorRowDepth: 5000,
    gangwayWidth: 4500, floorPalletClearance: 100,
    rackLevels: 4, rackSlotLength: 2700, rackSlotDepth: 1200, rackSlotHeight: 1100,
    rackStructuralLength: 150, rackStructuralDepth: 200, rackStructuralHeight: 150,
    maxRackRunLength: 15000, rackFrontageClearance: 100,
    rackDepthClearance: 100, rackVerticalClearance: 100,
    stockMode: 'consumption', allowRotation: false,
    workingDaysPerMonth: 22, shiftsPerDay: 2, coverageMode: 'input', customCoverageDays: 5
  };
  const sample = { partNumber: 'Preview example', qtyBox: 20, qtyOnPallet: 40,
    consumptionPerShift: 500, doh: 5,
    length: 1200, width: 800, height: 1000, stacking: 1, inputErrors: [] };

  function selectField(body, key, label, selected, options) {
    const wrapper = $('label', 'field');
    wrapper.append($('span', '', label));
    const select = $('select');
    select.name = key;
    for (const [value, text] of options) {
      const option = $('option', '', text);
      option.value = value;
      select.append(option);
    }
    select.value = selected;
    wrapper.append(select);
    body.append(wrapper);
    return select;
  }

  function draftNumbers(fields) {
    return Object.fromEntries(Object.entries(fields).map(([key, field]) => {
      const text = field.input.value.trim();
      return [key, text ? Number(text) : NaN];
    }));
  }

  function planningPreview(container, input, settings, isExample = false) {
    container.replaceChildren();
    container.append($('h3', 'section-heading', isExample ? 'Live preview · sample part' : 'Live per-shift pallet planning'));
    if (isExample) container.append($('p', 'muted', 'Example: 20 parts/box · 40 boxes/pallet · 500 parts/shift · DOH 5.'));
    let planning;
    try { planning = globalThis.LogEnDomain.calculatePart(input, settings).planning; } catch (_) { /* Invalid in-progress entry. */ }
    if (!planning) {
      container.append($('p', 'muted', 'Enter valid box quantities, consumption per shift, DOH and 1–3 shifts to preview.'));
      return;
    }
    const grid = $('div', 'preview-grid');
    const metrics = [
      ['Parts per pallet', `${display(planning.partsPerPallet)} parts`],
      ['Consumption per shift', `${display(planning.consumptionPerShift)} parts/shift`],
      ['Raw pallets per shift', `${display(planning.palletsPerShift)} pallets/shift`],
      ['Rounded pallets per shift', `${display(planning.roundedPalletsPerShift)} pallets/shift`],
      ['Selected DOH', `${display(planning.targetCoverageDays)} days`],
      ['Shifts per day', `${display(settings.shiftsPerDay)} shifts`],
      ['Planned pallets per day', `${display(planning.plannedPalletsPerDay)} pallets/day`],
      ['Daily consumption', `${display(planning.dailyConsumption)} parts/day`],
      ['Required parts · raw demand', `${display(planning.dailyConsumption * planning.targetCoverageDays)} parts`],
      ['Required pallets', `${display(planning.requiredPallets)} pallets`]
    ];
    for (const [label, value] of metrics) {
      const metric = $('div', 'preview-metric');
      metric.append($('span', 'muted', label), $('strong', '', value));
      grid.append(metric);
    }
    container.append(grid);
    container.append($('p', 'muted formula-hint', `CEILING(${display(planning.consumptionPerShift)} ÷ ${display(planning.qtyBox)} ÷ ${display(planning.qtyOnPallet)}) × ${display(planning.targetCoverageDays)} DOH × ${display(settings.shiftsPerDay)} shifts = ${display(planning.requiredPallets)} required pallets. A final ceiling is applied if fractional DOH creates a fractional pallet.`));
    if (planning.noConsumption) container.append(notice('Per-shift consumption is zero, so required pallets are zero. No current stock quantity is assumed.'));
  }

  function settings(initial) {
    const current = { ...defaults, ...initial };
    return modal({
      title: 'Warehouse settings',
      subtitle: 'Saved to this project. Consumption and all four footprints recalculate automatically.',
      button: 'Save settings',
      build(body, errors) {
        const fields = {};
        const field = (grid, key, label, positive = false, integer = false, unit = 'mm') => {
          fields[key] = numberField(grid, key, label, current[key], { positive, integer, unit });
        };
        const stock = section(body, 'Shifts & DOH planning', 'Round pallet demand up for one shift first, then multiply by DOH and the number of shifts.');
        const productionGrid = $('div', 'form-grid');
        stock.append(productionGrid);
        const shifts = selectField(productionGrid, 'shiftsPerDay', 'Shifts per day', String(current.shiftsPerDay), [['1', '1 shift'], ['2', '2 shifts'], ['3', '3 shifts']]);
        const coverage = selectField(productionGrid, 'coverageMode', 'DOH source', current.coverageMode === 'custom' ? 'custom' : 'input',
          [['input', 'DOH from each imported part'], ['custom', 'Project DOH override']]);
        field(productionGrid, 'customCoverageDays', 'Project DOH override', false, false, 'days');
        stock.append($('p', 'muted formula-hint', 'Required pallets = CEILING(CEILING(consumption per shift ÷ QTY in Box ÷ QTY boxes per Pallet) × selected DOH × shifts per day). The outer ceiling only affects fractional DOH.'));
        const preview = $('div', 'planning-preview');
        stock.append(preview);
        const floor = section(body, 'Floor storage & gangways');
        const floorGrid = $('div', 'form-grid'); floor.append(floorGrid);
        field(floorGrid, 'maxFloorStackingHeight', 'Maximum floor stacking height', true);
        field(floorGrid, 'maxFloorRowDepth', 'Maximum floor row depth · 0 = unrestricted');
        field(floorGrid, 'gangwayWidth', 'Gangway width');
        field(floorGrid, 'floorPalletClearance', 'Floor pallet clearance');
        const rack = section(body, 'Pallet rack capacity', 'Usable slot dimensions exclude the rack structure. Clearances are checked independently.');
        const rackGrid = $('div', 'form-grid'); rack.append(rackGrid);
        field(rackGrid, 'rackLevels', 'Rack levels', true, true, 'levels');
        field(rackGrid, 'maxRackRunLength', 'Maximum rack run length', true);
        field(rackGrid, 'rackSlotLength', 'Usable slot length', true);
        field(rackGrid, 'rackSlotDepth', 'Usable slot depth', true);
        field(rackGrid, 'rackSlotHeight', 'Usable slot height', true);
        field(rackGrid, 'rackFrontageClearance', 'Frontage clearance');
        field(rackGrid, 'rackDepthClearance', 'Rack depth clearance (total)');
        field(rackGrid, 'rackVerticalClearance', 'Rack vertical clearance');
        const structure = section(body, 'Rack structural allowances', 'Length and depth allowances increase the floor footprint. Height allowance is recorded per level and does not multiply ground area.');
        const structureGrid = $('div', 'form-grid'); structure.append(structureGrid);
        field(structureGrid, 'rackStructuralLength', 'Structural length allowance');
        field(structureGrid, 'rackStructuralDepth', 'Structural depth allowance');
        field(structureGrid, 'rackStructuralHeight', 'Structural height allowance');
        const rotationLabel = $('label', 'checkbox-field');
        const rotation = $('input'); rotation.type = 'checkbox'; rotation.checked = Boolean(current.allowRotation);
        const rotationCopy = $('span');
        rotationCopy.append($('strong', '', 'Allow 90° pallet rotation'), $('small', 'muted', 'Use the valid orientation with the highest rack slot capacity.'));
        rotationLabel.append(rotation, rotationCopy);
        body.append(rotationLabel, notice('Gangway-inclusive footprints are allocated planning estimates. Shared gangways must be counted once in a physical layout.'));
        const draft = () => ({ ...current, ...draftNumbers(fields), shiftsPerDay: Number(shifts.value), coverageMode: coverage.value, allowRotation: rotation.checked });
        const update = () => planningPreview(preview, sample, draft(), true);
        for (const input of Object.values(fields)) input.input.addEventListener('input', update);
        shifts.addEventListener('change', update); coverage.addEventListener('change', update); rotation.addEventListener('change', update);
        update();
        return {
          focus: shifts,
          read() {
            const updated = draft(); let valid = true;
            for (const input of Object.values(fields)) if (input.read() === undefined) valid = false;
            if (!valid) return undefined;
            const validation = globalThis.LogEnDomain.validateSettings(updated);
            if (validation.length) { errors.textContent = validation.join('\n'); errors.hidden = false; return undefined; }
            return updated;
          }
        };
      }
    });
  }

  function part(initial = null, projectSettings = {}) {
    const settings = { ...defaults, ...projectSettings };
    const current = initial ? globalThis.LogEnDomain.normalizePart(initial, settings) : { ...sample, partNumber: '' };
    return modal({
      title: initial ? 'Edit part number' : 'Add part number',
      subtitle: 'The eight Excel columns, plus an optional floor-stacking safety limit.',
      button: initial ? 'Save part number' : 'Add part number',
      build(body) {
        const name = textField(body, 'Part Number', current.partNumber, { placeholder: 'e.g. PN-001' });
        const stock = section(body, 'Packaging & consumption per shift', `${display(settings.shiftsPerDay)} shifts/day. Round pallet demand for one shift before applying DOH.`);
        const grid = $('div', 'form-grid'); stock.append(grid);
        const fields = {};
        const field = (target, key, label, unit, positive = false, integer = false) => {
          fields[key] = numberField(target, key, label, current[key], { unit, positive, integer });
        };
        field(grid, 'qtyBox', 'QTY in Box', 'parts / box', true, true);
        field(grid, 'qtyOnPallet', 'QTY boxes per Pallet', 'boxes / pallet', true, true);
        field(grid, 'consumptionPerShift', 'Consumption per shift', 'parts / shift');
        field(grid, 'doh', 'DOH', 'days');
        if (current.packagingInferred) stock.append(notice('Packaging was inferred from historical pallet capacity. Review parts per box and boxes per pallet.'));
        const preview = $('div', 'planning-preview'); stock.append(preview);
        const dimensions = section(body, 'Loaded pallet dimensions', 'Include the pallet and loaded goods in the height.');
        const dimensionGrid = $('div', 'form-grid'); dimensions.append(dimensionGrid);
        field(dimensionGrid, 'length', 'Length', 'mm', true);
        field(dimensionGrid, 'width', 'Width', 'mm', true);
        field(dimensionGrid, 'height', 'Height', 'mm', true);
        const advanced = section(body, 'Advanced · floor stacking safety', 'The eight-column template defaults to one pallet high. Increase this only where floor stacking is physically permitted.');
        const advancedGrid = $('div', 'form-grid'); advanced.append(advancedGrid);
        field(advancedGrid, 'stacking', 'Allowed floor stacking', 'pallets', true, true);
        body.append(notice('Consumption means individual parts per shift. QTY in Box is parts per box; QTY boxes per Pallet is boxes per pallet. Existing historical metadata is preserved when editing.'));
        const draft = () => ({ ...current, partNumber: name.input.value.trim() || 'Preview', ...draftNumbers(fields), providedCoverageDays: Number(fields.doh.input.value), packagingInferred: false, inputErrors: [] });
        const update = () => planningPreview(preview, draft(), settings);
        for (const input of Object.values(fields)) input.input.addEventListener('input', update);
        update();
        return {
          focus: name.input,
          read() {
            const partNumber = name.read(); let valid = partNumber !== undefined;
            const updated = { ...draft(), partNumber };
            for (const input of Object.values(fields)) if (input.read() === undefined) valid = false;
            return valid ? updated : undefined;
          }
        };
      }
    });
  }

  function formula(body, label, expression, result) {
    const box = $('div', 'formula-box');
    box.append($('strong', '', label), $('p', 'muted formula-expression', expression));
    if (result !== undefined) box.append($('div', 'formula-result', String(result)));
    body.append(box);
  }

  function details(result, settings) {
    const input = result.input;
    const floor = result.floor;
    const rack = result.rack;
    const n = display;
    return modal({
      eyebrow: 'PART CALCULATION',
      title: input.partNumber || 'Unnamed part number',
      subtitle: 'Dedicated floor rows and rack bays · both scenarios use the same inventory.',
      button: 'Done',
      cancel: false,
      build(body) {
        if (result.errors?.length) body.append(notice(result.errors.join('\n'), true));
        const stock = section(body, 'Per-shift pallet planning');
        const planning = result.planning;
        formula(stock, 'Loaded pallet dimensions', `${n(input.length)} × ${n(input.width)} × ${n(input.height)} mm (L × W × H)`);
        if (planning) {
          formula(stock, 'Parts per pallet', `${n(planning.qtyBox)} parts/box × ${n(planning.qtyOnPallet)} boxes/pallet`, `${n(planning.partsPerPallet)} parts/pallet`);
          formula(stock, 'Raw pallets per shift', `${n(planning.consumptionPerShift)} parts/shift ÷ ${n(planning.qtyBox)} parts/box ÷ ${n(planning.qtyOnPallet)} boxes/pallet`, `${n(planning.palletsPerShift)} pallets/shift`);
          formula(stock, 'Round up for one shift first', `CEILING(${n(planning.palletsPerShift)})`, `${n(planning.roundedPalletsPerShift)} pallets/shift`);
          formula(stock, 'Selected DOH and shifts', `${settings.coverageMode === 'custom' ? 'Project DOH override' : 'DOH from this part'}: ${n(planning.targetCoverageDays)} days\nShifts per day: ${n(settings.shiftsPerDay)} (maximum 3)`);
          formula(stock, 'Planned pallets per day', `${n(planning.roundedPalletsPerShift)} rounded pallets/shift × ${n(settings.shiftsPerDay)} shifts`, `${n(planning.plannedPalletsPerDay)} pallets/day`);
          formula(stock, 'Daily consumption · raw parts', `${n(planning.consumptionPerShift)} parts/shift × ${n(settings.shiftsPerDay)} shifts`, `${n(planning.dailyConsumption)} parts/day`);
          formula(stock, 'Required parts · raw demand', `${n(planning.dailyConsumption)} parts/day × ${n(planning.targetCoverageDays)} DOH`, n(result.requiredParts));
          formula(stock, 'Required pallets · used in both scenarios', `CEILING(CEILING(${n(planning.consumptionPerShift)} ÷ ${n(planning.qtyBox)} ÷ ${n(planning.qtyOnPallet)}) × ${n(planning.targetCoverageDays)} × ${n(settings.shiftsPerDay)})\n= CEILING(${n(planning.roundedPalletsPerShift)} × ${n(planning.targetCoverageDays)} × ${n(settings.shiftsPerDay)})`, `${n(result.requiredPallets)} pallets`);
          stock.append(notice('The pallet ceiling is applied per shift before multiplying by DOH and shifts. A final ceiling ensures a whole pallet when DOH is fractional. Raw required parts are shown separately.'));
          const history = section(body, 'Historical stock · optional metadata', 'The eight-column input does not provide current stock. Unavailable stock values remain N/A and do not affect required pallets.');
          formula(history, 'Current stock', planning.stockQty == null ? 'N/A · stock quantity was not provided.' : `${n(planning.stockQty)} stock parts ÷ ${n(planning.partsPerPallet)} parts/pallet`, planning.currentPallets == null ? 'N/A' : `${n(planning.currentPallets)} pallets`);
          formula(history, 'Actual stock coverage', planning.actualCoverageDays == null ? 'N/A · stock quantity or positive consumption is unavailable.' : `${n(planning.stockQty)} stock parts ÷ ${n(planning.dailyConsumption)} parts/day`, planning.actualCoverageDays == null ? 'N/A' : `${n(planning.actualCoverageDays)} days`);
        }
        const floorSection = section(body, 'A / B · Floor pallet storage');
        if (!floor) floorSection.append(notice('Floor storage cannot be calculated. Review the validation errors above.', true));
        else {
          formula(floorSection, 'Maximum stacking by height', `FLOOR(${n(settings.maxFloorStackingHeight)} mm ÷ ${n(input.height)} mm)`, `${n(floor.maximumStacking)} pallets`);
          formula(floorSection, 'Effective stacking', `MIN(${n(input.stacking)} allowed, ${n(floor.maximumStacking)} by height)`, `${n(floor.effectiveStacking)} pallets`);
          formula(floorSection, 'Floor pallet positions', `CEILING(${n(result.requiredPallets)} pallets ÷ ${n(floor.effectiveStacking)})`, `${n(floor.positions)} positions`);
          formula(floorSection, 'Pallets per row · depth limit', settings.maxFloorRowDepth === 0
            ? 'Unrestricted row depth: one dedicated row holds all floor positions.'
            : `FLOOR((${n(settings.maxFloorRowDepth)} + ${n(settings.floorPalletClearance)}) ÷ (${n(input.length)} + ${n(settings.floorPalletClearance)}))`, n(floor.palletsPerRow));
          formula(floorSection, 'Dedicated floor rows', `CEILING(${n(floor.positions)} ÷ ${n(floor.palletsPerRow)})`, `${n(floor.rows)} rows`);
          formula(floorSection, 'Actual occupied floor row depth', `Sum of occupied row depths = (${n(floor.positions)} positions × ${n(input.length)} mm + (${n(floor.positions)} − ${n(floor.rows)}) gaps × ${n(settings.floorPalletClearance)} mm) / 1000\nDeepest row: ${n(floor.rowDepth)} m · last row: ${n(floor.lastRowPallets)} pallets / ${n(floor.lastRowDepth)} m`, `${n(floor.totalOccupiedDepth)} m total occupied row depth`);
          formula(floorSection, 'A · Pallets without gangways', `(${n(input.width)} + ${n(settings.floorPalletClearance)}) / 1000 m row width × ${n(floor.totalOccupiedDepth)} m total occupied depth`, area(floor.withoutGangways));
          formula(floorSection, 'Allocated floor gangway', `${n(floor.rows)} rows × ${n(floor.rowWidth)} m × ${n(settings.gangwayWidth)} / 1000 m`, area(floor.gangwayArea));
          formula(floorSection, 'B · Pallets with allocated gangways', `${n(floor.withoutGangways)} + ${n(floor.gangwayArea)} m²`, area(floor.withGangways));
        }
        const rackSection = section(body, 'C / D · Pallet rack storage');
        if (!rack) rackSection.append(notice('Rack storage cannot be calculated. Review the validation errors above.', true));
        else {
          const front = rack.rotated ? input.width : input.length;
          const depth = rack.rotated ? input.length : input.width;
          formula(rackSection, 'Pallet orientation', rack.rotated ? '90° rotation: width along frontage, length along depth.' : 'Original: length along frontage, width along depth.', `${n(front)} mm frontage × ${n(depth)} mm depth`);
          formula(rackSection, 'Depth and loaded height validation', `Depth: ${n(depth)} + ${n(settings.rackDepthClearance)} ≤ ${n(settings.rackSlotDepth)} mm\nHeight: ${n(input.height)} + ${n(settings.rackVerticalClearance)} ≤ ${n(settings.rackSlotHeight)} mm`);
          formula(rackSection, 'Pallets per rack slot', `FLOOR((${n(settings.rackSlotLength)} − ${n(settings.rackFrontageClearance)}) ÷ (${n(front)} + ${n(settings.rackFrontageClearance)}))`, n(rack.palletsPerSlot));
          formula(rackSection, 'Capacity per rack bay', `${n(rack.palletsPerSlot)} pallets per slot × ${n(rack.levels)} rack levels`, `${n(rack.capacityPerBay)} pallets`);
          formula(rackSection, 'Required dedicated rack bays', `CEILING(${n(result.requiredPallets)} ÷ ${n(rack.capacityPerBay)})`, `${n(rack.bays)} bays`);
          formula(rackSection, 'Effective rack bay dimensions', `Length: ${n(settings.rackSlotLength)} + ${n(settings.rackStructuralLength)} = ${n(rack.effectiveBayLength)} mm\nDepth: ${n(settings.rackSlotDepth)} + ${n(settings.rackStructuralDepth)} = ${n(rack.effectiveBayDepth)} mm\nHeight per level: ${n(settings.rackSlotHeight)} + ${n(settings.rackStructuralHeight)} = ${n(rack.effectiveBayHeight)} mm`);
          formula(rackSection, 'C · Racks without gangways', `${n(rack.bays)} bays × ${n(rack.effectiveBayLength)} mm × ${n(rack.effectiveBayDepth)} mm ÷ 1,000,000`, area(rack.withoutGangways));
          formula(rackSection, 'Maximum bays per run', `FLOOR(${n(settings.maxRackRunLength)} ÷ ${n(rack.effectiveBayLength)})`, `${n(rack.maxBaysPerRun)} bays`);
          const baysPerRun = rack.baysPerRun ?? [];
          formula(rackSection, 'Required rack runs', `CEILING(${n(rack.bays)} ÷ ${n(rack.maxBaysPerRun)})\nBays per run: ${baysPerRun.length ? baysPerRun.map(n).join(', ') : 'none'}\nRun lengths: ${baysPerRun.length ? baysPerRun.map(bays => `${n(bays * rack.effectiveBayLength / 1000)} m`).join(', ') : 'none'}`, `${n(rack.runs)} runs`);
          formula(rackSection, 'Allocated rack gangway', `Total run frontage × gangway width = (${n(rack.bays)} × ${n(rack.effectiveBayLength)} / 1000 m) × ${n(settings.gangwayWidth)} / 1000 m`, area(rack.gangwayArea));
          formula(rackSection, 'D · Racks with allocated gangways', `${n(rack.withoutGangways)} + ${n(rack.gangwayArea)} m²`, area(rack.withGangways));
        }
        body.append(notice('Floor stacking is not applied to racks. Rack levels increase capacity, not ground footprint. Structural height is recorded per level and does not affect area. Gangways are conservative allocated estimates; a physical layout must count shared gangways once.'));
        return { read: () => true };
      }
    }).then(() => undefined);
  }

  function projectName(initial = '') {
    return modal({
      title: initial ? 'Rename warehouse project' : 'New warehouse project',
      subtitle: 'Inventory and warehouse settings are saved locally on this device.',
      button: initial ? 'Save name' : 'Create project',
      build(body) {
        const name = textField(body, 'Project name', initial, { maxLength: 80, placeholder: 'e.g. Main warehouse' });
        return { focus: name.input, read: () => name.read() };
      }
    });
  }

  globalThis.LogEnEditors = Object.freeze({ settings, part, details, projectName });
}());
