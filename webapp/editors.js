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

  function rackDiagram(result, settings) {
    const rack = result.rack, input = result.input;
    const wrapper = $('div', 'rack-diagram');
    wrapper.append($('h4', '', 'Standalone part rack views · gangways excluded'));
    wrapper.append($('p', 'muted', `${display(result.requiredPallets)} units · ${display(rack.bays)} vertical bays · ${display(rack.levels)} usable levels · ${area(rack.withoutGangways)} floor footprint`));
    if (!rack.bays) { wrapper.append($('p', 'muted', 'No rack bays required.')); return wrapper; }
    const bays = Math.min(rack.bays, 3), levels = Math.min(rack.levels, 8);
    const width = bays * 230 + 30, frontHeight = levels * 44 + 65;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${frontHeight + 140}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Rack front and top views: ${rack.bays} bays, ${rack.levels} levels, ${rack.boxesPerSlot} units per shelf; ${area(rack.withoutGangways)} ground footprint`);
    svg.style.cssText = 'display:block;width:100%;max-height:650px;background:#121416;border-radius:10px';
    function shape(tag, attrs, text) {
      const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [key,value] of Object.entries(attrs)) el.setAttribute(key,String(value));
      if (text !== undefined) el.textContent = text;
      svg.append(el); return el;
    }
    const label = (x,y,text,size=11) => shape('text',{x,y,fill:'#e4e5e7','font-size':size,'font-family':'sans-serif'},text);
    label(15,22,'FRONT VIEW — units placed on shelves',12);
    const frontage = rack.rotated ? input.width : input.length;
    const gap=settings.betweenBoxesAllowance ?? 0;
    const frontCapacity = Math.floor((settings.rackSlotLength + gap) / (frontage + gap));
    for (let bay=0;bay<bays;bay++) {
      const x=20+bay*230, bottom=frontHeight-25;
      shape('rect',{x,y:40,width:200,height:levels*44,fill:'none',stroke:'#ffce24','stroke-width':3});
      for(let level=0;level<levels;level++) {
        const y=bottom-level*44;
        const units=Math.max(0,Math.min(rack.boxesPerSlot,result.requiredPallets-bay*rack.capacityPerBay-level*rack.boxesPerSlot));
        shape('line',{x1:x,y1:y,x2:x+200,y2:y,stroke:'#ffce24','stroke-width':3});
        const visible=Math.min(units,frontCapacity,12);
        for(let box=0;box<visible;box++) shape('rect',{x:x+3+box*194/frontCapacity,y:y-30,width:Math.max(1,194/frontCapacity-4),height:28,fill:'#ffce24',opacity:0.85});
        label(x+4,y-33,`${units} units · level ${level+1}`,9);
      }
      label(x,bottom+19,`Bay ${bay+1} · ${area(rack.bayArea)}`);
      const topY=frontHeight+40;
      shape('rect',{x,y:topY,width:200,height:55,fill:'#252a30',stroke:'#ffce24','stroke-width':2});
      label(x+8,topY+22,`${display(settings.rackSlotLength + settings.rackStructuralLength)} × ${display(settings.rackSlotDepth + settings.rackStructuralDepth)} mm`);
      label(x+8,topY+42,area(rack.bayArea));
    }
    label(15,frontHeight+25,'TOP VIEW — one ground footprint per vertical bay',12);
    wrapper.append(svg);
    wrapper.append($('p','muted',`Schematic, not to scale. ${rack.bays>bays || rack.levels>levels ? `Preview shows up to ${bays} bays and ${levels} lower levels; totals include all bays and levels. ` : ''}Front silhouettes show the first depth row, up to 12 units; labels include all depth rows. Top view includes structural length/depth allowances in each ground footprint; gangways are excluded.`));
    wrapper.append($('p','muted',`Unused shelf surface: ${area(rack.unusedShelfArea)} across all levels; ${area(rack.unusedPerLevel)} equivalent per level. This is not free warehouse floor space. Allocated bays retain their full ground footprint, including unused shelf surface.`));
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
    input.required = options.required!==false;
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
    rackSurfaceAllowance: 4.125, rackPitch: 3300, rackLevels: 4, rackSlotLength: 2700, rackSlotDepth: 1200, rackSlotHeight: 1100,
    betweenBoxesAllowance: 0, rackStructuralLength: 150, rackStructuralDepth: 200, rackStructuralHeight: 150,
    maxRackRunLength: 15000, rackFrontageClearance: 100,
    rackDepthClearance: 100, rackVerticalClearance: 100,
    stockMode: 'consumption', allowRotation: false, stackabilityEnabled: false,
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
      ['Raw pallets per day', `${display(planning.palletsPerDay)} pallets/day`],
      ['Selected DOH', `${display(planning.targetCoverageDays)} days`],
      ['Shifts per day', `${display(settings.shiftsPerDay)} shifts`],
      ['Pallets per day', `${display(planning.plannedPalletsPerDay)} pallets/day`],
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
    container.append($('p', 'muted formula-hint', 'Required pallets = consumption per shift / parts per box / boxes per pallet × shifts per day × DOH. Keep decimal intermediates, then round up the final required pallets.'));
    if (planning.noConsumption) container.append(notice('Per-shift consumption is zero, so required pallets are zero. No current stock quantity is assumed.'));
  }

  function settings(initial) {
    const current = { ...globalThis.LogEnDomain.createDefaultSettings(), ...defaults, ...initial };
    return modal({
      title: 'Warehouse settings',
      subtitle: 'Saved to this project. Consumption and all four footprints recalculate automatically.',
      button: 'Save settings',
      build(body, errors) {
        const fields = {};
        const field = (grid, key, label, positive = false, integer = false, unit = 'mm') => {
          fields[key] = numberField(grid, key, label, current[key], { positive, integer, unit });
        };
        const stock = section(body, 'Shifts & DOH planning', 'Multiply raw pallet demand by selected shifts and DOH without rounding.');
        const productionGrid = $('div', 'form-grid');
        stock.append(productionGrid);
        const shifts = selectField(productionGrid, 'shiftsPerDay', 'Shifts per day', String(current.shiftsPerDay), [['1', '1 shift'], ['2', '2 shifts'], ['3', '3 shifts']]);
        const coverage = selectField(productionGrid, 'coverageMode', 'DOH source', current.coverageMode === 'custom' ? 'custom' : 'input',
          [['input', 'DOH from each imported part'], ['custom', 'Project DOH override']]);
        field(productionGrid, 'customCoverageDays', 'Project DOH override', false, false, 'days');
        stock.append($('p', 'muted formula-hint', 'Required pallets = consumption per shift / QTY in Box / QTY boxes per Pallet × shifts per day × DOH, then round up only the final result.'));
        stock.append($('p','muted','Choose the floor stacking mode in Part details. Existing per-part factors and height limits are preserved.'));
        const preview = $('div', 'planning-preview');
        stock.append(preview);
        const floor = section(body, 'Floor storage & gangways', 'Excel-style allocations reserve half a shared gangway; the physical width below remains unchanged.');
        const floorGrid = $('div', 'form-grid'); floor.append(floorGrid);
        field(floorGrid, 'maxFloorStackingHeight', 'Maximum floor stacking height', true);
        field(floorGrid, 'maxFloorRowDepth', 'Maximum floor row depth · 0 = unrestricted');
        field(floorGrid, 'gangwayWidth', 'Gangway width');
        field(floorGrid, 'floorPalletClearance', 'Floor pallet clearance');
        floor.append($('p', 'muted formula-hint', 'Ground storage adds the full clearance to both pallet length and pallet width. Example: 100 mm changes 1200 × 800 to 1300 × 900 mm. Rack fit uses original dimensions.'));
        const gangwayHint = $('p', 'muted formula-hint');
        floor.append(gangwayHint);
        const rack = section(body, 'Primary rack type', 'Enter the usable footprint and height of one shelf. These dimensions already exclude structure and required clearance.');
        let primaryEnabled=current.primaryRackEnabled!==false;
        const primaryDelete=$('button','btn btn-ghost danger-text');primaryDelete.type='button';
        function primaryState(){primaryDelete.textContent=primaryEnabled?'Delete primary rack type':'Restore primary rack type';rackGrid.hidden=!primaryEnabled;structure.hidden=!primaryEnabled;rackName.input.disabled=!primaryEnabled;}
        primaryDelete.addEventListener('click',()=>{primaryEnabled=!primaryEnabled;primaryState();update();});rack.append(primaryDelete);
        function rackOptions(target,value){const controls={};for(const [key,label] of [['rackAllowRotation','Allow rotation · prefer shorter side in front'],['rackAllowStacking','Allow vertical stacking · identical part numbers only'],['rackAllowDepthRows','Allow two pallets front-to-back · maximum two']]){const wrap=$('label','checkbox-field'),input=$('input');input.type='checkbox';input.name=key;input.checked=value[key]===true;controls[key]=input;wrap.append(input,$('span','',label));target.append(wrap);}return controls;}
        const primaryOptions=rackOptions(rack,current);
        const optionValues=controls=>Object.fromEntries(Object.entries(controls).map(([k,v])=>[k,v.checked]));
        const rackName=textField(rack,'Rack type name',current.rackTypeName,{maxLength:80});
        const rackGrid = $('div', 'form-grid'); rack.append(rackGrid);
        rack.append($('p', 'muted formula-hint', 'Required storage pallets are the rack unit quantity. Rack floor footprint uses (usable length + structural length) × (usable depth + structural depth). Shelf capacity and surface use usable dimensions only. Rotation, vertical stacking and two-deep storage are disabled unless explicitly enabled for this rack type. Legacy surface allowance and clearances are retained in saved data but are not applied again to usable dimensions.'));

        field(rackGrid, 'rackLevels', 'Rack levels', true, true, 'levels');
        field(rackGrid, 'maxRackRunLength', 'Maximum rack run length', true);
        field(rackGrid, 'rackSlotLength', 'Usable shelf length', true);
        field(rackGrid, 'rackSlotDepth', 'Usable shelf depth', true);
        field(rackGrid, 'rackSlotHeight', 'Usable shelf height', true);



        const structure = section(body, 'Rack structural allowances', 'Length and depth allowances increase the floor footprint. Height allowance is recorded per level and does not multiply ground area.');
        const structureGrid = $('div', 'form-grid'); structure.append(structureGrid);
        field(structureGrid, 'rackStructuralLength', 'Structural length allowance');
        field(structureGrid, 'rackStructuralDepth', 'Structural depth allowance');
        field(structureGrid, 'rackStructuralHeight', 'Structural height allowance');
        field(structureGrid, 'betweenBoxesAllowance', 'Between boxes allowance');
        structure.append($('p','muted','Gap between pallets, plus the same clearance at both rack pillars along shelf length. Example: 100 + 1200 + 100 + 1200 + 100 = 2700 mm. Depth gaps remain between rows only; no vertical gap. Applies to capacity and layouts.'));
        const additional=section(body,'Additional rack types','Different types may be used for different bays. Best-bay selection favors occupied shelf percentage, floor area per occupied surface and less unused surface. It also compares complete one/two-bay finishes to avoid unnecessary partial bays. This is a packing estimate, not a guaranteed global optimum.');
        const cards=[];
        const typeFields=[['rackSlotLength','Usable shelf length',true],['rackSlotDepth','Usable shelf depth',true],['rackSlotHeight','Usable shelf height',true],['rackLevels','Rack levels',true,true],['rackStructuralLength','Structural length allowance'],['rackStructuralDepth','Structural depth allowance'],['rackStructuralHeight','Structural height allowance'],['betweenBoxesAllowance','Between boxes allowance'],['maxRackRunLength','Maximum rack run length',true]];
        const cardList=$('div','rack-type-list');additional.append(cardList);
        function addRackType(value){
          const cfg={...current,...value},card=$('section','editor-section rack-type-card');
          const name=textField(card,'Rack type name',value.name||'Rack type '+(cards.length+2),{maxLength:80});
          const grid=$('div','form-grid');card.append(grid);const inputs={};
          for(const [key,label,positive,integer] of typeFields)inputs[key]=numberField(grid,key,label,cfg[key],{positive:!!positive,integer:!!integer,unit:key==='rackLevels'?'levels':'mm'});
          const options=rackOptions(card,value);
          const item={options,id:value.id||'rack-'+Date.now()+'-'+Math.random().toString(36).slice(2),name,inputs,element:card};cards.push(item);
          const remove=$('button','btn btn-ghost small','Remove rack type');remove.type='button';remove.addEventListener('click',()=>{cards.splice(cards.indexOf(item),1);card.remove();update();});card.append(remove);cardList.append(card);
        }
        (Array.isArray(current.rackTypes)?current.rackTypes:[]).filter(t=>t&&typeof t==='object').forEach(addRackType);
        const addType=$('button','btn btn-secondary','Add rack type');addType.type='button';addType.setAttribute('data-add-rack-type','');
        addType.addEventListener('click',()=>{if(cards.length>=19){errors.textContent='A project supports up to 20 rack types.';errors.hidden=false;return;}let n=2;const names=[rackName.input.value,...cards.map(c=>c.name.input.value)];while(names.includes('Rack type '+n))n++;addRackType({name:'Rack type '+n});update();});additional.append(addType);
        body.append(notice('Gangway-inclusive footprints are allocated planning estimates. Shared gangways must be counted once in a physical layout.'));
        primaryState();
        const draft = () => ({ ...current, ...draftNumbers(fields), primaryRackEnabled:primaryEnabled,...optionValues(primaryOptions),rackTypeName:rackName.input.value.trim(), rackTypes:cards.map(c=>({id:c.id,name:c.name.input.value.trim(),...draftNumbers(c.inputs),...optionValues(c.options)})), shiftsPerDay: Number(shifts.value), coverageMode: coverage.value, stackabilityEnabled: current.stackabilityEnabled });
        const update = () => {
          const settings = draft();
          planningPreview(preview, sample, settings, true);
          gangwayHint.textContent = `Allocated gangway width = ${display(globalThis.LogEnDomain.allocatedGangwayWidth(settings))} mm physical width. Both allocations use half a shared gangway.`;
        };
        for (const input of Object.values(fields)) input.input.addEventListener('input', update);
        shifts.addEventListener('change', update); coverage.addEventListener('change', update);
        update();
        return {
          focus: shifts,
          read() {
            const updated = draft(); let valid = rackName.read()!==undefined;
            for(const card of cards){if(card.name.read()===undefined)valid=false;for(const input of Object.values(card.inputs))if(input.read()===undefined)valid=false;}
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
      subtitle: 'The Excel input fields, including optional category. Saved floor stacking is read-only.',
      button: initial ? 'Save part number' : 'Add part number',
      build(body) {
        const name = textField(body, 'Part Number', current.partNumber, { placeholder: 'e.g. PN-001' });
        const category = textField(body, 'Category (optional)', current.category||'', {required:false});
        const stock = section(body, 'Packaging & consumption per shift', `${display(settings.shiftsPerDay)} shifts/day. Multiply by selected shifts and DOH, then round only the final required pallets.`);
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
        body.append($('p','muted',`Saved floor stacking factor: ${display(current.stacking)} (read-only). Height limits still apply.`));
        body.append(notice('Consumption means individual parts per shift. QTY in Box is parts per box; QTY boxes per Pallet is boxes per pallet. Existing historical metadata is preserved when editing.'));
        const draft = () => ({ ...current, partNumber: name.input.value.trim() || 'Preview', category:category.input.value.trim(), ...draftNumbers(fields), providedCoverageDays: Number(fields.doh.input.value), packagingInferred: false, inputErrors: [] });
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
    settings=rack?.typeSettings||settings;
    const n = display;
    return modal({
      eyebrow: 'PART CALCULATION',
      title: input.partNumber || 'Unnamed part number',
      subtitle: 'Per-part standalone estimate. Dashboard rack totals use shared shelves across PNs.',
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
          formula(stock, 'Raw pallets for selected shifts', `${n(planning.palletsPerShift)} pallets/shift × ${n(settings.shiftsPerDay)} shifts`, `${n(planning.palletsPerDay)} pallets/day`);
          formula(stock, 'Decimal daily pallet demand', `${n(planning.palletsPerShift)} × ${n(settings.shiftsPerDay)}`, `${n(planning.plannedPalletsPerDay)} pallets/day`);
          formula(stock, 'Selected DOH and shifts', `${settings.coverageMode === 'custom' ? 'Project DOH override' : 'DOH from this part'}: ${n(planning.targetCoverageDays)} days\nShifts per day: ${n(settings.shiftsPerDay)} (maximum 3)`);
          formula(stock, 'Decimal daily pallet demand', `${n(planning.palletsPerShift)} × ${n(settings.shiftsPerDay)}`, `${n(planning.plannedPalletsPerDay)} pallets/day`);
          formula(stock, 'Daily consumption · raw parts', `${n(planning.consumptionPerShift)} parts/shift × ${n(settings.shiftsPerDay)} shifts`, `${n(planning.dailyConsumption)} parts/day`);
          formula(stock, 'Required parts · raw demand', `${n(planning.dailyConsumption)} parts/day × ${n(planning.targetCoverageDays)} DOH`, n(result.requiredParts));
          formula(stock, 'Required pallets · used in both scenarios', `${n(planning.plannedPalletsPerDay)} × ${n(planning.targetCoverageDays)} DOH, then CEILING (no intermediate rounding)`, `${n(result.requiredPallets)} pallets`);
          stock.append(notice('Per-shift and daily demand retain decimals. Only the final required pallet quantity is rounded up before sizing physical positions and bays.'));
          const history = section(body, 'Historical stock · optional metadata', 'The eight-column input does not provide current stock. Unavailable stock values remain N/A and do not affect required pallets.');
          formula(history, 'Current stock', planning.stockQty == null ? 'N/A · stock quantity was not provided.' : `${n(planning.stockQty)} stock parts ÷ ${n(planning.partsPerPallet)} parts/pallet`, planning.currentPallets == null ? 'N/A' : `${n(planning.currentPallets)} pallets`);
          formula(history, 'Actual stock coverage', planning.actualCoverageDays == null ? 'N/A · stock quantity or positive consumption is unavailable.' : `${n(planning.stockQty)} stock parts ÷ ${n(planning.dailyConsumption)} parts/day`, planning.actualCoverageDays == null ? 'N/A' : `${n(planning.actualCoverageDays)} days`);
        }
        const floorSection = section(body, 'A / B · Floor pallet storage');
        if (!floor) floorSection.append(notice('Floor storage cannot be calculated. Review the validation errors above.', true));
        else {
          formula(floorSection, 'Maximum stacking by height', `FLOOR(${n(settings.maxFloorStackingHeight)} mm ÷ ${n(input.height)} mm)`, `${n(floor.maximumStacking)} pallets`);
          formula(floorSection, 'Effective stacking', `Source: ${floor.stackingSource}. MIN(${n(floor.allowedStacking)} allowed, ${n(floor.maximumStacking)} by height). Imported value ${n(input.stacking)} is preserved.`, `${n(floor.effectiveStacking)} pallets`);
          formula(floorSection, 'Floor pallet positions', `CEILING(${n(result.requiredPallets)} pallets ÷ ${n(floor.effectiveStacking)})`, `${n(floor.positions)} positions`);
          formula(floorSection, 'Pallets per row · depth limit', settings.maxFloorRowDepth === 0
            ? 'Unrestricted row depth: one dedicated row holds all floor positions.'
            : `FLOOR(${n(settings.maxFloorRowDepth)} ÷ (${n(input.length)} + ${n(settings.floorPalletClearance)}))`, n(floor.palletsPerRow));
          formula(floorSection, 'Dedicated floor rows', `CEILING(${n(floor.positions)} ÷ ${n(floor.palletsPerRow)})`, `${n(floor.rows)} rows`);
          formula(floorSection, 'Adjusted ground dimensions and occupied depth', `Length: ${n(input.length)} + ${n(settings.floorPalletClearance)} = ${n(floor.floorLength)} mm; width: ${n(input.width)} + ${n(settings.floorPalletClearance)} = ${n(floor.floorWidth)} mm. Total occupied depth = ${n(floor.positions)} × ${n(floor.floorLength)} / 1000 m`, `${n(floor.totalOccupiedDepth)} m`);
          formula(floorSection, 'A · Ground storage without gangway', `${n(floor.rowDepth * 1000)} mm lane depth × ${n(floor.rowWidth * 1000)} mm lane width × ${n(floor.rows)} lanes / 1,000,000`, area(floor.withoutGangways));
          formula(floorSection, 'B · Ground storage with gangway', `${n(floor.withoutGangways)} + (${n(floor.rowWidth * 1000)} × ${n(floor.rows)} × ${n(settings.gangwayWidth / 1000)}) / 2000`, area(floor.withGangways));
          floorSection.append(notice('Each lane reserves the deepest occupied row depth, including a partial last row. Half a shared physical gangway is allocated. A ground depth limit of zero remains unrestricted.'));

        }
        const rackSection = section(body, 'C / D · Pallet rack storage');
        if (!rack) rackSection.append(notice('Rack storage cannot be calculated. Review the validation errors above.', true));
        else {
          rackSection.append(notice('Standalone rack type: '+rack.typeName+'. Shared allocation may choose different types for different bays.'));
          rackSection.append(rackDiagram(result, settings));
          const front = rack.rotated ? input.width : input.length;
          const depth = rack.rotated ? input.length : input.width;
          formula(rackSection, 'Pallet orientation', rack.rotated ? '90° rotation: width along frontage, length along depth.' : 'Original: length along frontage, width along depth.', `${n(front)} mm frontage × ${n(depth)} mm depth`);
          formula(rackSection, 'Shelf fit and boxes per slot', `Gap g = ${n(settings.betweenBoxesAllowance ?? 0)} mm between units only. For each horizontal orientation: FLOOR((shelf length + g) / (unit length + g)) × FLOOR((shelf depth + g) / (unit width + g)). Choose highest capacity. Height must fit usable shelf height. No vertical stacking or outer edge gap.`, n(rack.boxesPerSlot));
          formula(rackSection, 'Capacity per rack bay', `${n(rack.palletsPerSlot)} pallets per slot × ${n(rack.levels)} rack levels`, `${n(rack.capacityPerBay)} pallets`);
          formula(rackSection, 'Required dedicated rack bays', `CEILING(${n(result.requiredPallets)} ÷ ${n(rack.capacityPerBay)})`, `${n(rack.bays)} bays`);
          formula(rackSection, 'Effective rack bay dimensions', `Length: ${n(settings.rackSlotLength)} + ${n(settings.rackStructuralLength)} = ${n(rack.effectiveBayLength)} mm\nDepth: ${n(settings.rackSlotDepth)} + ${n(settings.rackStructuralDepth)} = ${n(rack.effectiveBayDepth)} mm\nHeight per level: ${n(settings.rackSlotHeight)} + ${n(settings.rackStructuralHeight)} = ${n(rack.effectiveBayHeight)} mm`);
          formula(rackSection, 'C · Racks without gangways', `${n(rack.bays)} vertical bays × (${n(settings.rackSlotLength)} + ${n(settings.rackStructuralLength)}) × (${n(settings.rackSlotDepth)} + ${n(settings.rackStructuralDepth)}) / 1,000,000`, area(rack.withoutGangways));
          formula(rackSection, 'Available / occupied shelf surface', `Available: ${n(rack.bays)} × ${n(rack.usableBayArea)} m² usable shelf × ${n(settings.rackLevels)} levels; occupied: ${n(result.requiredPallets)} units × ${n(input.length)} × ${n(input.width)} / 1,000,000`, `${area(rack.availableShelfArea)} available; ${area(rack.occupiedShelfArea)} occupied`);
          formula(rackSection, 'Unused shelf surface · not warehouse floor space', `${n(rack.availableShelfArea)} − ${n(rack.occupiedShelfArea)}; equivalent per level = unused / ${n(settings.rackLevels)}`, `${area(rack.unusedShelfArea)} total; ${area(rack.unusedPerLevel)} per level`);
          formula(rackSection, 'Rack utilization / unused percentage', 'Occupied shelf surface / available shelf surface × 100. Unused surface is never subtracted from floor footprint.', `${rack.utilizationPercent === null ? 'N/A' : n(rack.utilizationPercent) + '%'} utilized; ${rack.unusedPercent === null ? 'N/A' : n(rack.unusedPercent) + '%'} unused`);
          formula(rackSection, 'Maximum bays per run', `FLOOR(${n(settings.maxRackRunLength)} ÷ ${n(rack.effectiveBayLength)})`, `${n(rack.maxBaysPerRun)} bays`);
          const baysPerRun = rack.baysPerRun ?? [];
          formula(rackSection, 'Required rack runs', `CEILING(${n(rack.bays)} ÷ ${n(rack.maxBaysPerRun)})\nBays per run: ${baysPerRun.length ? baysPerRun.map(n).join(', ') : 'none'}\nRun lengths: ${baysPerRun.length ? baysPerRun.map(bays => `${n(bays * rack.effectiveBayLength / 1000)} m`).join(', ') : 'none'}`, `${n(rack.runs)} runs`);
          formula(rackSection, 'D · Racks with allocated gangway', `${n(rack.withoutGangways)} m² rack storage + ${n(rack.bays)} bays × ${n(rack.effectiveBayLength)} mm frontage × ${n(settings.gangwayWidth / 1000)} m physical gangway / 2000`, area(rack.withGangways));
        }
        body.append(notice('Floor stacking is not applied to racks. Rack levels increase capacity, not ground footprint. Structural height is recorded per level and does not affect area. Both scenarios allocate half a shared gangway. PR allocated adds half a shared gangway strip to rack storage, using the frontage including structural length. Whole-bay rack quantity rounding is preserved. These are planning estimates; a physical layout must count shared gangways once.'));
        return { read: () => true };
      }
    }).then(() => undefined);
  }

  function rackFitSummary(body, calculation) {
    const sectionEl=section(body,'Required pallets · rack fit');
    if(calculation.settingsErrors?.length) sectionEl.append(notice('Warehouse settings are invalid. Fit quantities are unavailable until they are corrected.',true));
    const rows=calculation.results;
    const fits=rows.filter(r=>r.isPlanningValid && r.isRackValid);
    const nonFits=rows.filter(r=>r.rackFit==='NO');
    const review=rows.filter(r=>!r.isPlanningValid || (!r.isRackValid && r.rackFit!=='NO'));
    const sum=rs=>rs.reduce((n,r)=>n+(r.isPlanningValid?r.requiredPallets:0),0);
    sectionEl.append($('p','rack-fit-quantities',`${display(sum(fits))} required pallets fit · ${display(sum(nonFits))} required pallets do not fit · ${display(sum(review))} known pallets need review`));
    sectionEl.append($('p','muted',`${review.filter(r=>!r.isPlanningValid).length} input rows have unavailable quantities or duplicate part numbers. They are excluded from confirmed pallet counts. This checks required pallets against usable shelf dimensions, not extra free capacity in allocated racks.`));
    const listed=nonFits.concat(review.filter(r=>r.rackFit!=='NO'));
    if(!listed.length){sectionEl.append(notice('All required pallets with valid input fit the racks.'));return;}
    sectionEl.append($('h4','','Non-fitting parts and inputs needing review'));
    const viewport=$('div','table-scroll');viewport.style.maxHeight='340px';viewport.style.overflow='auto';
    const table=$('table','data-table'),head=$('thead'),header=$('tr');
    for(const name of ['Part Number','Required pallets','Rack status','Reason'])header.append($('th','',name));head.append(header);table.append(head);
    const tbody=$('tbody');
    for(const r of listed){const tr=$('tr');tr.append($('td','',r.input.partNumber||'(blank)'),$('td','',r.isPlanningValid?display(r.requiredPallets):'Unavailable'),$('td','',r.rackFit==='NO'?'Does not fit':'Needs review'),$('td','',r.errors.join(' ')||'Correct missing or invalid dimensions.'));tbody.append(tr);}
    table.append(tbody);viewport.append(table);sectionEl.append(viewport);
  }
  function requiredPallets(calculation) {
    return modal({title:'Required storage pallets · rack fit',subtitle:'Required pallet quantities, grouped by rack eligibility.',button:'Done',build(body){rackFitSummary(body,calculation);return {read:()=>true};}});
  }

  function rackOverview(calculation, settings) {
    return modal({title:'Shared rack shelf overview', subtitle:'Different part numbers can share a shelf and a vertical bay.', button:'Done', build(body){
      rackFitSummary(body,calculation);
      const plan=calculation.sharedRack;
      if(!plan?.available){body.append(notice(plan?.error||'Rack layout unavailable.',true));return {read:()=>true};}
      body.append($('p','',`${display(plan.quantity)} units · ${display(plan.bays)} vertical bays · ${plan.typeUsage.length} rack types · ${area(plan.withoutGangways)} without gangways`));
      body.append(notice('Feasible shelf packing estimate, not a guaranteed optimum. All units fit usable length/depth/height. Storage follows each rack type’s rotation, stacking and maximum-two-depth options. Part-level diagrams show standalone estimates; this overview uses the supplied shared allocation.'));
      const selectorLabel=$('label','field');selectorLabel.append($('span','','Rack bay'));
      const baySelect=$('select');baySelect.setAttribute('aria-label','Rack bay');
      for(let b=0;b<plan.bays;b++){const option=$('option','',`Bay ${b+1} of ${plan.bays} — ${plan.bayLayouts[b].typeName}`);option.value=String(b);baySelect.append(option);}
      selectorLabel.append(baySelect);body.append(selectorLabel);
      const scope=$('p','muted'),shelfViews=$('div','shared-shelf-views');body.append(scope,shelfViews);
      function showBay(){
        shelfViews.replaceChildren();const bay=Number(baySelect.value)||0,layout=plan.bayLayouts[bay];if(!layout){scope.textContent='No rack bays required.';return;}const cfg=layout.settings;
        scope.textContent=`Showing Bay ${bay+1} of ${plan.bays} — ${layout.typeName}: ${display(cfg.rackSlotLength)} × ${display(cfg.rackSlotDepth)} × ${display(cfg.rackSlotHeight)} mm usable, ${cfg.rackLevels} levels, gap ${display(cfg.betweenBoxesAllowance)} mm. Total floor area includes all bays.`;
      for(let level=0;level<layout.shelves.length;level++){
        const shelf=layout.shelves[level],card=$('section','editor-section');
        card.append($('h3','',`Bay ${bay+1} · shelf ${level+1}`));
        const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox',`0 0 ${cfg.rackSlotLength} ${cfg.rackSlotDepth}`);svg.setAttribute('role','img');svg.setAttribute('aria-label','Top view of bay '+(bay+1)+' shelf '+(level+1));svg.setAttribute('role','group');svg.style.cssText='width:100%;max-height:240px;background:#202329;border:2px solid #ffce24';
        const selectedInfo=$('div','notice rack-box-info','Click a box to see its PN and shelf position.');
        selectedInfo.setAttribute('role','status');selectedInfo.setAttribute('aria-live','polite');
        let selectedRect=null;
        for(const [boxIndex,box] of shelf.placements.entries()){
          const rect=document.createElementNS(svg.namespaceURI,'rect');
          for(const [k,v] of Object.entries({x:box.x,y:box.y,width:box.length,height:box.depth,fill:'#ffce24',stroke:'#111','stroke-width':10,role:'button',tabindex:0,'aria-label':`PN ${box.partNumber}, bay ${bay+1}, shelf ${level+1}, box ${boxIndex+1}`,'aria-pressed':'false'}))rect.setAttribute(k,String(v));
          rect.style.cursor='pointer';
          const selectBox=()=>{
            if(selectedRect){selectedRect.setAttribute('stroke','#111');selectedRect.setAttribute('aria-pressed','false');}
            selectedRect=rect;rect.setAttribute('stroke','#fff');rect.setAttribute('aria-pressed','true');
            selectedInfo.textContent=`PN: ${box.partNumber} · Bay ${bay+1} · Shelf ${level+1} · Box ${boxIndex+1} · Position X ${display(box.x)} mm, Y ${display(box.y)} mm · ${display(box.length)} × ${display(box.depth)} mm · Stack layer ${box.stackLayer||1} · Depth row ${(box.depthRow||0)+1}`;
          };
          rect.addEventListener('click',selectBox);rect.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectBox();}});
          const title=document.createElementNS(svg.namespaceURI,'title');title.textContent=box.partNumber;rect.append(title);svg.append(rect);
        }
        card.append(svg,selectedInfo);const counts=new Map();shelf.placements.forEach(p=>counts.set(p.partNumber,(counts.get(p.partNumber)||0)+1));card.append($('p','muted',[...counts].map(([pn,n])=>pn+' × '+n).join(' · ')));shelfViews.append(card);
      }
      }
      baySelect.addEventListener('change',showBay);showBay();
      body.append($('p','muted',`Top views show usable shelf placement, gangways excluded. Total floor area also includes structural length and depth allowances. Each selected bay uses its rack type’s dimensions and between-box allowance. Unused shelf surface: ${area(plan.unused)}; utilization: ${display(plan.utilization)}%. Empty levels in the final bay remain reserved.`));
      return {read:()=>true};
    }});
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

  globalThis.LogEnEditors = Object.freeze({ settings, part, details, projectName, rackOverview, requiredPallets });
}());
