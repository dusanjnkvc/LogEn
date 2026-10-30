/* LogEn warehouse calculation engine. Dimensions: mm; footprint results: m².
 * This file has no UI, network or third-party dependencies. */
(function (scope) {
  'use strict';

  function createDefaultSettings() {
    return {
      rackTypeName: 'Rack type 1', rackTypes: [], stackingMode: 'legacy', manualStacking: 1, maxFloorStackingHeight: 5000, maxFloorRowDepth: 5000,
      gangwayWidth: 4500, floorPalletClearance: 100,
      rackSurfaceAllowance: 4.125, rackPitch: 3300, rackLevels: 4, rackSlotLength: 2700, rackSlotDepth: 1200,
      rackSlotHeight: 1100, betweenBoxesAllowance: 0, rackStructuralLength: 150,
      rackStructuralDepth: 200, rackStructuralHeight: 150,
      maxRackRunLength: 15000, rackFrontageClearance: 100,
      rackDepthClearance: 100, rackVerticalClearance: 100,
      allowRotation: false, rackAllowRotation:false, rackAllowStacking:false, rackAllowDepthRows:false, primaryRackEnabled:true, stockMode: 'consumption',
      workingDaysPerMonth: 22, shiftsPerDay: 2,
      coverageMode: 'input', customCoverageDays: 5, stackabilityEnabled: false
    };
  }

  const positiveSettings = {
    maxFloorStackingHeight: 'Maximum floor stacking height',
    rackSlotLength: 'Rack usable slot length',
    rackSlotDepth: 'Rack usable slot depth',
    rackSlotHeight: 'Rack usable slot height',
    maxRackRunLength: 'Maximum rack run length'
  };
  const nonNegativeSettings = {
    betweenBoxesAllowance: 'Between boxes allowance', gangwayWidth: 'Gangway width', floorPalletClearance: 'Floor pallet clearance',
    maxFloorRowDepth: 'Maximum floor row depth (0 = unrestricted)',
    rackStructuralLength: 'Rack structural length allowance',
    rackStructuralDepth: 'Rack structural depth allowance',
    rackStructuralHeight: 'Rack structural height allowance',
    rackFrontageClearance: 'Rack frontage clearance',
    rackDepthClearance: 'Rack depth clearance',
    rackVerticalClearance: 'Rack vertical clearance',
    customCoverageDays: 'Custom target coverage'
  };

  // Each storage allocation uses the full configured physical aisle width.
  const allocatedGangwayWidth = settings => settings.gangwayWidth;

  const rackTypeFields = ['rackSlotLength','rackSlotDepth','rackSlotHeight','rackLevels','rackStructuralLength','rackStructuralDepth','rackStructuralHeight','betweenBoxesAllowance','maxRackRunLength'];
  const rackOptionFields=['rackAllowRotation','rackAllowStacking','rackAllowDepthRows'];
  function configuredRackTypes(s) {
    const primary={...s,id:'primary',name:s.rackTypeName||'Rack type 1',rackTypes:[]};
    return [...(s.primaryRackEnabled===false?[]:[primary]),...(Array.isArray(s.rackTypes)?s.rackTypes:[]).filter(t=>t&&typeof t==='object').map((t,i)=>{
      const cfg={...s,id:String(t.id||'type-'+i),name:String(t.name||''),rackTypes:[]};
      for(const key of rackTypeFields)cfg[key]=t[key]===undefined?s[key]:t[key];
      for(const key of rackOptionFields)cfg[key]=t[key]===true;
      return cfg;
    })];
  }
  function floorStackingMode(s) {
    return !s.stackingMode || s.stackingMode==='legacy' ? (s.stackabilityEnabled?'imported':'manual') : s.stackingMode;
  }
  function validateSettings(s) {
    const errors = [];
    if (!['legacy','height','imported','manual'].includes(s.stackingMode)) errors.push('Choose automatic, imported or manual floor stacking.');
    if (s.stackingMode==='manual' && (!Number.isSafeInteger(s.manualStacking) || s.manualStacking<1)) errors.push('Manual floor stacking must be a whole number of at least 1.');
    for (const [key, label] of Object.entries(positiveSettings)) {
      if (!Number.isFinite(s[key]) || s[key] <= 0)
        errors.push(label + ' must be a finite number greater than zero.');
    }
    for (const [key, label] of Object.entries(nonNegativeSettings)) {
      if (!Number.isFinite(s[key]) || s[key] < 0)
        errors.push(label + ' must be a finite non-negative number.');
    }
    if (!Number.isSafeInteger(s.rackLevels) || s.rackLevels < 1)
      errors.push('Rack levels must be a positive integer within supported numeric precision.');
    if (!Number.isSafeInteger(s.shiftsPerDay) || s.shiftsPerDay < 1 || s.shiftsPerDay > 3)
      errors.push('Shifts per day must be a whole number from 1 to 3.');
    if (!['input', '24h', '48h', 'custom'].includes(s.coverageMode))
      errors.push('Coverage mode must be input, 24h, 48h or custom.');
    if (typeof s.allowRotation !== 'boolean')
      errors.push('Pallet rotation must be enabled or disabled.');
    if (typeof s.stackabilityEnabled !== 'boolean')
      errors.push('Stackability must be enabled or disabled.');
    if (s.rackSlotLength + s.rackStructuralLength > s.maxRackRunLength)
      errors.push('Maximum rack run length must fit at least one effective rack bay.');
    if(s.rackTypes!==undefined&&!Array.isArray(s.rackTypes))errors.push('Rack types must be a list.');
    if(Array.isArray(s.rackTypes)&&s.rackTypes.length){
      if(s.rackTypes.length>19)errors.push('A project supports up to 20 rack types.');
      const names=new Set([String(s.rackTypeName||'Rack type 1').trim().toLowerCase()]),ids=new Set(['primary']);
      for(const [i,raw] of s.rackTypes.entries()){
        if(!raw||typeof raw!=='object'){errors.push('Rack type '+(i+2)+' is invalid.');continue;}
        const type=configuredRackTypes({...s,primaryRackEnabled:true,rackTypes:[raw]})[1];
        if(!type.name.trim()||names.has(type.name.trim().toLowerCase()))errors.push('Each rack type needs a unique non-empty name.');names.add(type.name.trim().toLowerCase());
        if(ids.has(type.id))errors.push('Rack type identifiers must be unique.');ids.add(type.id);
        for(const error of validateSettings({...type,rackTypeName:type.name,rackTypes:[]}))errors.push(type.name+': '+error);
      }
    }
    return errors;
  }

  // Migrate once and persist: per-shift consumption stays fixed when the number
  // of shifts changes. Historical monthly/stock metadata is retained untouched.
  function normalizePart(input, settings) {
    const s = { ...createDefaultSettings(), ...settings };
    const has = key => Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined;
    const directShift = has('consumptionPerShift');
    const packagingInferred = !directShift &&
      !(Number.isFinite(input.qtyBox) && input.qtyBox > 0 && Number.isFinite(input.qtyOnPallet) && input.qtyOnPallet > 0) &&
      Number.isFinite(input.partsPerPallet) && input.partsPerPallet > 0;
    const qtyBox = packagingInferred ? input.partsPerPallet : (input.qtyBox ?? 0);
    const qtyOnPallet = packagingInferred ? 1 : (input.qtyOnPallet ?? 0);
    const partsPerPallet = qtyBox * qtyOnPallet;
    const consumptionPerShift = directShift ? input.consumptionPerShift :
      has('monthlyConsumption') && input.monthlyConsumption !== null
        ? input.monthlyConsumption / s.workingDaysPerMonth / s.shiftsPerDay
        : has('consumption') ? input.consumption / s.shiftsPerDay : NaN;
    const doh = has('doh') && (directShift || input.doh !== 0 || !has('providedCoverageDays'))
      ? input.doh : has('providedCoverageDays') ? input.providedCoverageDays : NaN;
    const stockQty = has('stockQty') ? input.stockQty :
      !directShift && has('qtyPallet') ? input.qtyPallet * partsPerPallet : null;
    return {
      ...input,
      partNumber: String(input.partNumber ?? ''),
      category: String(input.category ?? '').trim(),
      qtyBox, qtyOnPallet, partsPerPallet, consumptionPerShift, doh,
      stacking: has('stacking') ? input.stacking : 1,
      stockQty,
      monthlyConsumption: has('monthlyConsumption') ? input.monthlyConsumption : null,
      providedCoverageDays: doh,
      packagingInferred: Boolean(input.packagingInferred || packagingInferred),
      inputErrors: Array.isArray(input.inputErrors) ? [...input.inputErrors] : []
    };
  }

  function validateInput(p) {
    const errors = Array.isArray(p.inputErrors) ? p.inputErrors.map(String) : [];
    if (!String(p.partNumber == null ? '' : p.partNumber).trim())
      errors.push('Part Number is required.');
    const positive = {
      length: 'Pallet length', width: 'Pallet width',
      height: 'Loaded pallet height', stacking: 'Stacking',
      qtyBox: 'QTY in Box', qtyOnPallet: 'QTY boxes per Pallet', partsPerPallet: 'Parts per pallet'
    };
    const nonNegative = { consumptionPerShift: 'Consumption per shift', doh: 'DOH (Days on hand)' };
    const integers = { stacking: 'Stacking', qtyBox: 'QTY in Box',
      qtyOnPallet: 'QTY boxes per Pallet', partsPerPallet: 'Parts per pallet' };
    for (const [key, label] of Object.entries(positive)) {
      if (!Number.isFinite(p[key]) || p[key] <= 0)
        errors.push(label + ' must be a finite number greater than zero.');
    }
    for (const [key, label] of Object.entries(nonNegative)) {
      if (!Number.isFinite(p[key]) || p[key] < 0)
        errors.push(label + ' must be a finite non-negative number.');
    }
    for (const [key, label] of Object.entries(integers)) {
      if (Number.isFinite(p[key]) && !Number.isSafeInteger(p[key]))
        errors.push(label + ' must be a whole number within supported numeric precision.');
    }
    return errors;
  }

  function ceil(value, correctArithmeticNoise = true) {
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)
      throw new Error('Calculated quantities exceed supported numeric precision.');
    if (!correctArithmeticNoise) return Math.ceil(value);
    // Multiplication of fractional DOH may put an exact boundary a few ULPs above an
    // integer. Correct only floating arithmetic noise, never round a positive
    // fractional pallet near zero down to zero.
    const nearest = Math.round(value);
    return nearest !== 0 && Math.abs(value - nearest) <= Number.EPSILON * Math.abs(value) * 4
      ? nearest : Math.ceil(value);
  }
  function floor(value) {
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)
      throw new Error('Calculated quantities exceed supported numeric precision.');
    return Math.floor(value);
  }
  function ceilDivide(numerator, denominator) {
    const quotient = Math.floor(numerator / denominator);
    return quotient + (numerator % denominator === 0 ? 0 : 1);
  }
  function storageAreaCents(value) {
    const scaled = value * 100;
    if (!Number.isFinite(scaled) || Math.abs(scaled) > Number.MAX_SAFE_INTEGER)
      throw new Error('Floor storage area exceeds supported numeric precision.');
    return Math.round(scaled + Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4);
  }
  function resultFor(input, errors, requiredParts = null, requiredPallets = null, floorResult = null, rack = null, planning = null) {
    return {
      input, requiredParts, requiredPallets, floor: floorResult, rack, planning, errors,
      isFloorValid: floorResult !== null,
      isRackValid: rack !== null,
      isPlanningValid: planning !== null,
      isValid: errors.length === 0 && floorResult !== null && rack !== null
    };
  }

  function rackFit(input, settings) {
    if(![input.length,input.width,input.height].every(v=>Number.isFinite(v)&&v>0))return 'N/A';
    return configuredRackTypes(settings).some(t=>rackForPart(0,input,t))?'YES':'NO';
  }
  function surfaceAreas(depth, width, lanes, quantity, allowance, pitch, gangwayMetres) {
    if (![depth,width,lanes,quantity,allowance,pitch,gangwayMetres].every(v => Number.isFinite(v) && v >= 0))
      throw new Error('Surface allocation inputs must be finite and non-negative.');
    const gsNet = depth * width * lanes / 1000000;
    return {gsNet, gsWith: gsNet + width * lanes * gangwayMetres / 2000,
      prNet: quantity * allowance, prWith: quantity * pitch * gangwayMetres / 2000};
  }
  // Usable dimensions already exclude any configured physical allowances.
  // Both horizontal orientations are evaluated; no vertical stacking.
  function calculateBoxRack(requiredBoxes, length, width, height, slotLength, slotDepth, slotHeight, levels, gap = 0, structuralLength = 0, structuralDepth = 0, options = {}) {
    if (![structuralLength,structuralDepth].every(v=>Number.isFinite(v)&&v>=0)) throw new Error('Rack structural allowances must be finite and non-negative.');
    if (!Number.isFinite(gap) || gap < 0) throw new Error('Between boxes allowance must be finite and non-negative.');
    if (![length,width,height,slotLength,slotDepth,slotHeight].every(v => Number.isFinite(v) && v > 0) ||
        !Number.isSafeInteger(requiredBoxes) || requiredBoxes < 0 || !Number.isSafeInteger(levels) || levels < 1)
      throw new Error('Rack sizing requires whole non-negative boxes, positive dimensions and whole positive levels.');
    const stackLayers=options.rackAllowStacking?floor(slotHeight/height):1;
    const capacity = (l,w) => height <= slotHeight ? Math.max(0,floor((slotLength - gap) / (l + gap))) * Math.min(options.rackAllowDepthRows?2:1,floor((slotDepth + gap) / (w + gap))) * stackLayers : 0;
    const original = capacity(length,width), rotatedCapacity = capacity(width,length);
    const rotated=!!options.rackAllowRotation && (width<length ? rotatedCapacity>0 : original===0&&rotatedCapacity>0);
    const boxesPerSlot = rotated?rotatedCapacity:original;
    const fits = boxesPerSlot > 0;
    const capacityPerBay = boxesPerSlot * levels;
    if (!Number.isSafeInteger(capacityPerBay)) throw new Error('Rack capacity exceeds supported precision.');
    const bays = fits ? ceilDivide(requiredBoxes,capacityPerBay) : 0;
    const usableBayArea = slotLength * slotDepth / 1000000;
    const bayArea = (slotLength + structuralLength) * (slotDepth + structuralDepth) / 1000000;
    const withoutGangways = bays * bayArea;
    const availableShelfArea = bays * usableBayArea * levels;
    const occupiedShelfArea = fits ? ceilDivide(requiredBoxes,stackLayers) * length * width / 1000000 : 0;
    const unusedShelfArea = Math.max(0,availableShelfArea - occupiedShelfArea);
    const utilizationPercent = availableShelfArea > 0 ? occupiedShelfArea / availableShelfArea * 100 : null;
    const values = [bayArea,withoutGangways,availableShelfArea,occupiedShelfArea,unusedShelfArea];
    if (!values.every(Number.isFinite)) throw new Error('Rack surface exceeds supported precision.');
    return {fits, requiredBoxes, nonFittingBoxes: fits ? 0 : requiredBoxes, boxesPerSlot,
      capacityPerBay, bays, bayArea, usableBayArea, withoutGangways, rotated, stackLayers,
      availableShelfArea, occupiedShelfArea, unusedShelfArea, unusedPerLevel: unusedShelfArea / levels,
      utilizationPercent, unusedPercent: utilizationPercent === null ? null : 100-utilizationPercent};
  }
  function rackForPart(quantity,input,t) {
    const sizing=calculateBoxRack(quantity,input.length,input.width,input.height,t.rackSlotLength,t.rackSlotDepth,t.rackSlotHeight,t.rackLevels,t.betweenBoxesAllowance,t.rackStructuralLength,t.rackStructuralDepth,t);
    if(!sizing.fits)return null;
    const effectiveBayLength=t.rackSlotLength+t.rackStructuralLength,effectiveBayDepth=t.rackSlotDepth+t.rackStructuralDepth,effectiveBayHeight=t.rackSlotHeight+t.rackStructuralHeight;
    const maxBaysPerRun=floor(t.maxRackRunLength/effectiveBayLength),runs=ceilDivide(sizing.bays,maxBaysPerRun);
    if(runs>1000000)throw new Error('Rack run count exceeds the supported project size.');
    const baysPerRun=Array.from({length:runs},(_,i)=>Math.min(maxBaysPerRun,sizing.bays-i*maxBaysPerRun));
    const gangwayArea=sizing.bays*effectiveBayLength*t.gangwayWidth/2000000;
    return {...sizing,palletsPerSlot:sizing.boxesPerSlot,levels:t.rackLevels,effectiveBayLength,effectiveBayDepth,effectiveBayHeight,maxBaysPerRun,runs,baysPerRun,gangwayArea,withGangways:sizing.withoutGangways+gangwayArea,typeId:t.id,typeName:t.name,typeSettings:t};
  }
  function calculatePart(input, settings, requiredPalletOverride = null) {
    const s = { ...createDefaultSettings(), ...settings };
    input = normalizePart(input, s);
    const errors = validateSettings(s).concat(validateInput(input));
    if (errors.length) return resultFor(input, errors);
    let requiredParts = null, requiredPallets = null, floorResult = null, rack = null, planning = null;
    try {
      const consumptionPerShift = input.consumptionPerShift;
      const shiftConsumption = consumptionPerShift;
      const dailyConsumption = consumptionPerShift * s.shiftsPerDay;
      const palletsPerShift = consumptionPerShift / input.qtyBox / input.qtyOnPallet;
      // Kept for historical exports; required storage rounds the selected day.
      const roundedPalletsPerShift = palletsPerShift;
      const palletsPerDay = palletsPerShift * s.shiftsPerDay;
      const plannedPalletsPerDay = palletsPerDay;
      const knownStock = Number.isSafeInteger(input.stockQty) && input.stockQty >= 0;
      const currentPallets = knownStock ? input.stockQty / input.partsPerPallet : null;
      const noConsumption = dailyConsumption === 0;
      const palletDurationDays = noConsumption ? null : input.partsPerPallet / dailyConsumption;
      const actualCoverageDays = noConsumption || !knownStock ? null : input.stockQty / dailyConsumption;
      const coverageDifferenceDays = actualCoverageDays === null ? null : actualCoverageDays - input.doh;
      const targetCoverageDays = s.coverageMode === '24h' ? 1 : s.coverageMode === '48h' ? 2 :
        s.coverageMode === 'custom' ? s.customCoverageDays : input.doh;
      requiredParts = dailyConsumption * targetCoverageDays;
      requiredPallets = requiredPalletOverride===null?ceil(plannedPalletsPerDay * targetCoverageDays):requiredPalletOverride;
      if(!Number.isSafeInteger(requiredPallets)||requiredPallets<0)throw new Error('Required pallet allocation must be a whole non-negative number.');
      if (![dailyConsumption, shiftConsumption, palletsPerDay, requiredParts,
        ...[currentPallets, palletDurationDays, actualCoverageDays, coverageDifferenceDays].filter(value => value !== null)].every(Number.isFinite) || requiredParts > Number.MAX_SAFE_INTEGER)
        throw new Error('Shift planning values exceed supported numeric precision.');
      planning = {
        qtyBox: input.qtyBox, qtyOnPallet: input.qtyOnPallet,
        consumptionPerShift, palletsPerShift, roundedPalletsPerShift, plannedPalletsPerDay, requiredPallets,
        dailyConsumption, shiftConsumption, palletsPerDay, currentPallets,
        currentPalletPositions: knownStock ? ceil(currentPallets) : null, palletDurationDays,
        actualCoverageDays, coverageDifferenceDays,
        coverageMismatch: coverageDifferenceDays !== null && Math.abs(coverageDifferenceDays) > 1e-9,
        providedCoverageDays: input.doh,
        monthlyConsumption: Number.isFinite(input.monthlyConsumption) ? input.monthlyConsumption : null,
        partsPerPallet: input.partsPerPallet,
        stockQty: knownStock ? input.stockQty : null, noConsumption, targetCoverageDays,
        pallets24h: ceil(plannedPalletsPerDay),
        pallets48h: ceil(2 * plannedPalletsPerDay),
        palletsCustom: ceil(s.customCoverageDays * plannedPalletsPerDay),
        customCoverageDays: s.customCoverageDays
      };
      const maximumStacking = floor(s.maxFloorStackingHeight / input.height);
      const stackingSource = floorStackingMode(s);
      const allowedStacking = stackingSource==='height' ? maximumStacking : stackingSource==='imported' ? input.stacking : s.stackingMode==='manual' ? s.manualStacking : 1;
      const effectiveStacking = Math.min(allowedStacking, maximumStacking);
      const positions = effectiveStacking >= 1 ? ceilDivide(requiredPallets, effectiveStacking) : 0;
      const floorLength = input.length + s.floorPalletClearance;
      const floorWidth = input.width + s.floorPalletClearance;
      const palletsPerRow = s.maxFloorRowDepth === 0 ? Math.max(positions, 1) :
        floor(s.maxFloorRowDepth / floorLength);
      if (maximumStacking < 1)
        errors.push('Floor: loaded pallet height exceeds maximum floor stacking height.');
      if (palletsPerRow < 1)
        errors.push('Floor: pallet length cannot fit within the maximum row depth.');
      if (effectiveStacking >= 1 && palletsPerRow >= 1) {
        const rows = ceilDivide(positions, palletsPerRow);
        const rowWidth = floorWidth / 1000;
        const occupiedDepth = n => n > 0 ? n * floorLength / 1000 : 0;
        const lastRowPallets = rows > 0 ? positions - (rows - 1) * palletsPerRow : 0;
        const fullRowDepth = occupiedDepth(Math.min(positions, palletsPerRow));
        const lastRowDepth = occupiedDepth(lastRowPallets);
        const rowDepth = fullRowDepth;
        const totalOccupiedDepth = positions * floorLength / 1000;
        const withoutGangways = rowDepth * rowWidth * rows;
        const storageArea = withoutGangways;
        const formulaPositions = positions;
        const formulaStorageArea = withoutGangways;
        const gangwayArea = rowWidth * rows * s.gangwayWidth / 2000;
        const withGangways = withoutGangways + gangwayArea;
        if (![withoutGangways, formulaPositions, formulaStorageArea, gangwayArea, withGangways].every(Number.isFinite))
          throw new Error('Floor area exceeds supported numeric precision.');
        floorResult = { stackingSource, allowedStacking, floorLength, floorWidth, maximumStacking, effectiveStacking, positions,
          palletsPerRow, rows, rowWidth, rowDepth, totalOccupiedDepth, fullRowDepth,
          lastRowDepth, lastRowPallets, withoutGangways,
          storageArea, formulaPositions,
          formulaStorageArea, gangwayArea, withGangways };
      }

      const alternatives=configuredRackTypes(s).map(t=>rackForPart(requiredPallets,input,t)).filter(Boolean);
      alternatives.sort((a,b)=>(b.utilizationPercent||0)-(a.utilizationPercent||0)||a.withoutGangways-b.withoutGangways||a.unusedShelfArea-b.unusedShelfArea);
      rack=alternatives[0]||null;
      if(!rack)errors.push('Rack: unit does not fit the usable shelf length, depth and height of any configured rack type.');
    } catch (error) { errors.push(error.message); }
    return resultFor(input, errors, requiredParts, requiredPallets, floorResult, rack, planning);
  }

  function singleRackPlan(results, s) {
    const shelves=[];
    const rows=results.filter(r=>r.isRackValid).sort((a,b)=>b.input.length*b.input.width-a.input.length*a.input.width);
    const quantity=rows.reduce((n,r)=>n+r.requiredPallets,0);
    if(quantity>10000) return {available:false,error:'Shared rack preview supports up to 10,000 units.'};
    for(const r of rows) for(let unit=0;unit<r.requiredPallets;unit++) {
      let best=null;
      for(let shelf=0;shelf<shelves.length;shelf++) shelves[shelf].free.forEach((rect,index)=>{
        for(const [w,d] of [[front,dep]])
          if(w<=rect.w && d<=rect.d) { const score=rect.w*rect.d-w*d; if(!best||score<best.score)best={shelf,index,w,d,score}; }
      });
      if(!best){shelves.push({free:[{x:0,y:0,w:s.rackSlotLength,d:s.rackSlotDepth}],placements:[]});best={shelf:shelves.length-1,index:0,w:r.input.length,d:r.input.width};if(best.w>s.rackSlotLength||best.d>s.rackSlotDepth)[best.w,best.d]=[best.d,best.w];}
      const sh=shelves[best.shelf],rect=sh.free.splice(best.index,1)[0];
      sh.placements.push({partNumber:r.input.partNumber,x:rect.x,y:rect.y,length:best.w,depth:best.d,z:0,height:r.input.height,stackLayer:1,depthRow:rect.depthRow||0});
      if(rect.w>best.w+s.betweenBoxesAllowance)sh.free.push({x:rect.x+best.w+s.betweenBoxesAllowance,y:rect.y,w:rect.w-best.w-s.betweenBoxesAllowance,d:best.d});
      if(rect.d>best.d+s.betweenBoxesAllowance)sh.free.push({x:rect.x,y:rect.y+best.d+s.betweenBoxesAllowance,w:rect.w,d:rect.d-best.d-s.betweenBoxesAllowance});
    }
    const bays=ceilDivide(shelves.length,s.rackLevels),bayArea=(s.rackSlotLength+s.rackStructuralLength)*(s.rackSlotDepth+s.rackStructuralDepth)/1000000;
    const occupied=rows.reduce((n,r)=>n+r.requiredPallets*r.input.length*r.input.width/1000000,0),available=bays*s.rackSlotLength*s.rackSlotDepth/1000000*s.rackLevels;
    return {available:true,shelves,bays,quantity,withoutGangways:bays*bayArea,gangwayArea:bays*(s.rackSlotLength+s.rackStructuralLength)*s.gangwayWidth/2000000,withGangways:bays*bayArea+bays*(s.rackSlotLength+s.rackStructuralLength)*s.gangwayWidth/2000000,occupied,availableShelfArea:available,unused:Math.max(0,available-occupied),utilization:available>0?occupied/available*100:null};
  }
  function sharedRackPlan(results,s,limits=null) {
    const types=configuredRackTypes(s).filter(t=>limits===null||(limits[t.id]||0)>0);
    function finish(bayLayouts,quantity){
      const shelves=[],usage=new Map();let net=0,aisle=0,occupied=0,available=0,unusedPerLevel=0;
      bayLayouts.forEach((bay,i)=>{
        const t=bay.settings;bay.number=i+1;bay.typeId=t.id;bay.typeName=t.name;
        // Center each actual depth row as a group; retain all inter-unit gaps.
        for(const sh of bay.shelves){for(const depthRow of new Set(sh.placements.map(p=>p.depthRow||0))){
          const row=sh.placements.filter(p=>(p.depthRow||0)===depthRow),left=Math.min(...row.map(p=>p.x)),right=Math.max(...row.map(p=>p.x+p.length));
          const offset=(t.rackSlotLength-(right-left))/2-left;
          row.forEach(p=>p.x+=offset);
        }}
        const usable=t.rackSlotLength*t.rackSlotDepth/1000000,footprint=(t.rackSlotLength+t.rackStructuralLength)*(t.rackSlotDepth+t.rackStructuralDepth)/1000000;
        bay.withoutGangways=footprint;bay.availableShelfArea=usable*t.rackLevels;
        bay.occupiedShelfArea=bay.shelves.reduce((n,sh)=>n+sh.placements.reduce((v,p)=>v+(p.z?0:p.length*p.depth/1000000),0),0);
        bay.unusedShelfArea=Math.max(0,bay.availableShelfArea-bay.occupiedShelfArea);bay.utilizationPercent=bay.availableShelfArea?bay.occupiedShelfArea/bay.availableShelfArea*100:null;
        net+=footprint;aisle+=(t.rackSlotLength+t.rackStructuralLength)*s.gangwayWidth/2000000;occupied+=bay.occupiedShelfArea;available+=bay.availableShelfArea;unusedPerLevel+=bay.unusedShelfArea/t.rackLevels;
        const u=usage.get(t.id)||{typeId:t.id,typeName:t.name,settings:t,bays:0,withoutGangways:0};u.bays++;u.withoutGangways+=footprint;usage.set(t.id,u);
        bay.shelves.forEach((sh,j)=>{sh.bayNumber=i+1;sh.level=j+1;sh.typeId=t.id;sh.typeName=t.name;sh.settings=t;shelves.push(sh);});
      });
      const typeUsage=[...usage.values()];let runs=0;for(const u of typeUsage){u.runs=ceilDivide(u.bays,floor(u.settings.maxRackRunLength/(u.settings.rackSlotLength+u.settings.rackStructuralLength)));runs+=u.runs;}
      return {available:true,shelves,bayLayouts,typeUsage,bays:bayLayouts.length,runs,quantity,withoutGangways:net,gangwayArea:aisle,withGangways:net+aisle,occupied,availableShelfArea:available,unused:Math.max(0,available-occupied),unusedPerLevel,utilization:available?occupied/available*100:null};
    }
    const rows=results.filter(r=>r.isRackValid&&r.isPlanningValid&&types.some(t=>rackForPart(0,r.input,t))).map(r=>({input:r.input,quantity:r.requiredPallets,fitCount:types.filter(t=>rackForPart(0,r.input,t)).length})).sort((a,b)=>a.fitCount-b.fitCount||b.input.length*b.input.width-a.input.length*a.input.width);
    const quantity=rows.reduce((n,r)=>n+r.quantity,0);if(quantity>10000)return {available:false,error:'Shared rack preview supports up to 10,000 units.'};
    const remaining=rows.map(r=>r.quantity),bayLayouts=[];let steps=0;
    function candidate(t,stock=remaining){
      const used=stock.map(()=>0),shelves=[];let occupied=0,count=0;
      rows.forEach((r,index)=>{
        if(r.input.height>t.rackSlotHeight)return;
        for(let unit=0;unit<stock[index];unit++){
          if(++steps>5000000)throw new Error('Mixed rack allocation is too complex; reduce inventory or the number of rack types.');
          if(t.rackAllowStacking){
            let tower=null;
            for(const sh of shelves){
              const base=sh.placements.find(p=>p.partNumber===r.input.partNumber && !p.z && sh.placements.filter(q=>q.x===p.x&&q.y===p.y).length<Math.floor(t.rackSlotHeight/r.input.height));
              if(base){tower={sh,base};break;}
            }
            if(tower){const layer=tower.sh.placements.filter(p=>p.x===tower.base.x&&p.y===tower.base.y).length;tower.sh.placements.push({...tower.base,z:layer*r.input.height,stackLayer:layer+1});count++;used[index]++;continue;}
          }
          const sizing=rackForPart(0,r.input,t);if(!sizing)break;
          const front=sizing.rotated?r.input.width:r.input.length,dep=sizing.rotated?r.input.length:r.input.width;
          let best=null;
          shelves.forEach((sh,k)=>sh.free.forEach((rect,j)=>{
            for(const [w,d] of [[front,dep]])if(w<=rect.w&&d<=rect.d){const score=rect.w*rect.d-w*d,capacity=Math.floor((rect.w+t.betweenBoxesAllowance)/(w+t.betweenBoxesAllowance))*Math.floor((rect.d+t.betweenBoxesAllowance)/(d+t.betweenBoxesAllowance));if(!best||score<best.score||score===best.score&&capacity>best.capacity)best={k,j,w,d,score,capacity};}
          }));
          if(!best&&shelves.length<t.rackLevels){
            const sizing=rackForPart(0,r.input,t);if(!sizing)break;
            const w=sizing.rotated?r.input.width:r.input.length,d=sizing.rotated?r.input.length:r.input.width;
            const free=[{x:t.betweenBoxesAllowance,y:0,w:t.rackSlotLength-2*t.betweenBoxesAllowance,d:t.rackAllowDepthRows?d:t.rackSlotDepth,depthRow:0}];if(t.rackAllowDepthRows&&t.rackSlotDepth>d+t.betweenBoxesAllowance)free.push({x:t.betweenBoxesAllowance,y:d+t.betweenBoxesAllowance,w:t.rackSlotLength-2*t.betweenBoxesAllowance,d:t.rackSlotDepth-d-t.betweenBoxesAllowance,depthRow:1});shelves.push({free,placements:[]});best={k:shelves.length-1,j:0,w,d};
          }
          if(!best)break;
          const sh=shelves[best.k],rect=sh.free.splice(best.j,1)[0],g=t.betweenBoxesAllowance;
          sh.placements.push({partNumber:r.input.partNumber,x:rect.x,y:rect.y,length:best.w,depth:best.d,z:0,height:r.input.height,stackLayer:1,depthRow:rect.depthRow||0});
          if(rect.w>best.w+g)sh.free.push({x:rect.x+best.w+g,y:rect.y,w:rect.w-best.w-g,d:rect.d,depthRow:rect.depthRow||0});
          occupied+=best.w*best.d/1000000;count++;used[index]++;
        }
      });
      const available=t.rackSlotLength*t.rackSlotDepth/1000000*t.rackLevels,footprint=(t.rackSlotLength+t.rackStructuralLength)*(t.rackSlotDepth+t.rackStructuralDepth)/1000000;
      return {settings:t,shelves,used,count,occupied,footprint,utilization:available?occupied/available:0,unused:available-occupied,efficiency:occupied?footprint/occupied:Infinity};
    }
    try{
      if(limits!==null){
        const usedBays=new Map();
        while(remaining.some(n=>n>0)){
          const choices=types.filter(t=>(usedBays.get(t.id)||0)<limits[t.id]).map(t=>candidate(t)).filter(c=>c.count);
          choices.sort((a,b)=>b.count-a.count||b.utilization-a.utilization||a.footprint-b.footprint);
          const best=choices[0];if(!best)break;
          best.used.forEach((n,i)=>remaining[i]-=n);bayLayouts.push(best);usedBays.set(best.settings.id,(usedBays.get(best.settings.id)||0)+1);
        }
        // Empty existing bays still occupy floor area and retain their aisle allocation.
        for(const t of types)for(let n=usedBays.get(t.id)||0;n<limits[t.id];n++)bayLayouts.push({settings:t,shelves:[]});
        const result=finish(bayLayouts,quantity-remaining.reduce((n,v)=>n+v,0));
        result.placedByPN=Object.fromEntries(rows.map((r,i)=>[r.input.partNumber,r.quantity-remaining[i]]));
        return result;
      }
      while(remaining.some(n=>n>0)){
        const candidates=types.map(t=>candidate(t)).filter(c=>c.count);
        candidates.sort((a,b)=>b.utilization-a.utilization||a.efficiency-b.efficiency||a.unused-b.unused||b.occupied-a.occupied);
        let best=candidates[0];
        // Compare complete one/two-bay finishes before the next greedy step.
        // This avoids creating a small partial bay when a required larger bay can absorb it.
        let finishChoice=null;
        for(const first of candidates){
          const residual=remaining.map((n,i)=>n-first.used[i]),left=residual.reduce((n,v)=>n+v,0);
          const endings=left?types.map(t=>candidate(t,residual)).filter(c=>c.count===left):[null];
          for(const second of endings){const cost=first.footprint+(second?.footprint||0),unused=first.unused+(second?.unused||0);if(!finishChoice||cost<finishChoice.cost-1e-9||Math.abs(cost-finishChoice.cost)<1e-9&&unused<finishChoice.unused-1e-9)finishChoice={first,cost,unused};}
        }
        if(finishChoice)best=finishChoice.first;
        if(!best)return {available:false,error:'Some required units could not be placed in the configured rack types.'};
        best.used.forEach((n,i)=>remaining[i]-=n);bayLayouts.push(best);
      }
      return finish(bayLayouts,quantity);
    }catch(error){return {available:false,error:error.message};}
  }
  function calculateProject(parts, settings, category = null) {
    const s = { ...createDefaultSettings(), ...settings };
    const settingsErrors = validateSettings(s);
    const counts = new Map();
    const keyFor = p => String(p.partNumber == null ? '' : p.partNumber).trim().toUpperCase();
    parts.forEach(p => counts.set(keyFor(p), (counts.get(keyFor(p)) || 0) + 1));
    const results = parts.map((input,sourceIndex) => {
      if (settingsErrors.length)
        return {...resultFor(normalizePart(input, s), ['Warehouse settings are invalid. Correct the settings to calculate this part.']),sourceIndex};
      const result = calculatePart(input, s);
      result.sourceIndex=sourceIndex;
      result.rackFit = rackFit(result.input, s);
      if (counts.get(keyFor(input)) > 1) {
        result.errors.push('Duplicate Part Number. Consolidate this part into one input row.');
        result.isValid = false;
        result.isFloorValid = result.isRackValid = result.isPlanningValid = false;
      }
      return result;
    }).filter(r=>category===null || String(r.input.category||'').trim()===category);
    const valid = results.filter(r => r.isValid);
    const floors = results.filter(r => r.isFloorValid);
    const racks = results.filter(r => r.isRackValid);
    const planned = results.filter(r => r.isPlanningValid);
    const total = (rows, fn) => rows.reduce((sum, row) => sum + fn(row), 0);
    const project = {
      results, settingsErrors, invalidCount: results.length - valid.length,
      validCount: valid.length,
      floorValidCount: floors.length, rackValidCount: racks.length,
      totalRequiredPallets: total(planned, r => r.requiredPallets),
      totalFloorPositions: total(floors, r => r.floor.positions),
      totalFloorRows: total(floors, r => r.floor.rows),
      totalRackBays: total(racks, r => r.rack.bays),
      totalRackRuns: total(racks, r => r.rack.runs),
      // Sum the exact two-decimal contributions displayed in Floor storage m².
      floorWithoutGangways: total(floors, r => r.floor.withoutGangways),
      nonFittingPartCount: new Set(results.filter(r => r.rackFit === 'NO').map(r => keyFor(r.input))).size,
      nonFittingPallets: total(planned.filter(r => r.rackFit === 'NO'), r => r.requiredPallets),
      nonFittingUnknownQuantity: results.filter(r => r.rackFit === 'NO' && !r.isPlanningValid).length,
      floorWithGangways: total(floors, r => r.floor.withGangways),
      rackWithoutGangways: total(racks, r => r.rack.withoutGangways),
      rackWithGangways: total(racks, r => r.rack.withGangways),
      rackAvailableShelfArea: total(racks, r => r.rack.availableShelfArea),
      rackOccupiedShelfArea: total(racks, r => r.rack.occupiedShelfArea),
      rackUnusedShelfArea: total(racks, r => r.rack.unusedShelfArea),
      rackUnusedPerLevel: total(racks, r => r.rack.unusedPerLevel),
      floorGangwayArea: total(floors, r => r.floor.gangwayArea),
      rackGangwayArea: total(racks, r => r.rack.gangwayArea)
    };
    project.rackUtilizationPercent = project.rackAvailableShelfArea > 0 ? project.rackOccupiedShelfArea / project.rackAvailableShelfArea * 100 : null;
    project.rackUnusedPercent = project.rackUtilizationPercent === null ? null : 100-project.rackUtilizationPercent;
    const shared = settingsErrors.length ? {available:false,error:'Correct warehouse settings first.'} : sharedRackPlan(results,s);
    project.sharedRack = shared;
    if(shared.available){
      project.totalRackBays=shared.bays;
      project.totalRackRuns=shared.runs;
      project.rackWithoutGangways=shared.withoutGangways;project.rackWithGangways=shared.withGangways;project.rackGangwayArea=shared.gangwayArea;
      project.rackAvailableShelfArea=shared.availableShelfArea;project.rackOccupiedShelfArea=shared.occupied;
      project.rackUnusedShelfArea=shared.unused;project.rackUnusedPerLevel=shared.unusedPerLevel;
      project.rackUtilizationPercent=shared.utilization;project.rackUnusedPercent=shared.utilization===null?null:100-shared.utilization;
    }
    project.savingWithoutGangways = project.floorWithoutGangways - project.rackWithoutGangways;
    project.savingWithGangways = project.floorWithGangways - project.rackWithGangways;
    project.savingWithoutGangwaysPercent = project.floorWithoutGangways === 0 ? null :
      project.savingWithoutGangways / project.floorWithoutGangways * 100;
    project.savingWithGangwaysPercent = project.floorWithGangways === 0 ? null :
      project.savingWithGangways / project.floorWithGangways * 100;
    return project;
  }

  function calculateStorageSplit(parts,settings,threshold,category=null,existingCalculation=null){
    if(!Number.isSafeInteger(threshold)||threshold<0)throw new Error('Rack threshold must be a whole number of at least zero.');
    const all=existingCalculation||calculateProject(parts,settings,category),planned=all.results.filter(r=>r.isPlanningValid);
    const rackRows=planned.filter(r=>r.requiredPallets<=threshold),groundRows=planned.filter(r=>r.requiredPallets>threshold);
    const rack=calculateProject(rackRows.map(r=>r.input),settings);
    const groundValid=groundRows.filter(r=>r.isFloorValid),sum=(rows,fn)=>rows.reduce((n,r)=>n+fn(r),0);
    return {rack,groundRows,rackRows,settingsErrors:all.settingsErrors,unassigned:all.results.filter(r=>!r.isPlanningValid),
      rackPallets:sum(rackRows,r=>r.requiredPallets),groundPallets:sum(groundRows,r=>r.requiredPallets),
      groundWithoutGangways:sum(groundValid,r=>r.floor.withoutGangways),groundWithGangways:sum(groundValid,r=>r.floor.withGangways),
      groundInvalid:groundRows.filter(r=>!r.isFloorValid),rackInvalid:rack.results.filter(r=>!r.isRackValid)};
  }
  function calculateImplementation(parts,settings,config={},category=null){
    const base=calculateProject(parts,settings,category),errors=[...base.settingsErrors],types=configuredRackTypes({...createDefaultSettings(),...settings}),limits={};
    if(!config.greenfield&&config.useExistingRacks){
      for(const row of config.existingRacks||[]){
        const type=types.find(t=>t.id===row.typeId);
        if(!type){errors.push('An existing rack type was removed. Choose another type or remove its entry.');continue;}
        if(!Number.isSafeInteger(row.bays)||row.bays<0||row.bays>1000){errors.push(type.name+': enter a whole number of bays from 0 to 1000.');continue;}
        limits[type.id]=(limits[type.id]||0)+row.bays;
      }
    }
    if(Object.values(limits).reduce((a,b)=>a+b,0)>10000)errors.push('Implementation supports up to 10,000 existing bays.');
    if(errors.length)return {available:false,errors};
    const rack=sharedRackPlan(base.results,{...createDefaultSettings(),...settings},limits);
    if(!rack.available)return {available:false,errors:[rack.error]};
    const rows=base.results.map(r=>{
      if(!r.isPlanningValid)return {input:r.input,required:null,rackPallets:0,groundPallets:null,errors:r.errors};
      const rackPallets=rack.placedByPN?.[r.input.partNumber]||0,groundPallets=r.requiredPallets-rackPallets;
      const ground=groundPallets?calculatePart(r.input,settings,groundPallets):null;
      return {input:r.input,required:r.requiredPallets,rackPallets,groundPallets,ground:ground?.floor,errors:groundPallets&&!ground?.isFloorValid?(ground?.errors||['Invalid ground calculation']):[]};
    });
    const groundWithoutGangways=rows.reduce((n,r)=>n+(r.ground?.withoutGangways||0),0),groundWithGangways=rows.reduce((n,r)=>n+(r.ground?.withGangways||0),0);
    return {available:true,errors:[],rows,rack,totalPallets:base.totalRequiredPallets,rackPallets:rack.quantity,groundPallets:rows.reduce((n,r)=>n+(r.groundPallets||0),0),groundWithoutGangways,groundWithGangways,totalWithoutGangways:rack.withoutGangways+groundWithoutGangways,totalWithGangways:rack.withGangways+groundWithGangways,invalidCount:rows.filter(r=>r.errors.length).length};
  }
  scope.LogEnDomain = Object.freeze({ createDefaultSettings, configuredRackTypes, rackTypeFields, rackOptionFields, floorStackingMode, calculateBoxRack, rackFit, surfaceAreas, allocatedGangwayWidth, normalizePart, validateSettings, calculatePart, calculateProject, calculateStorageSplit, calculateImplementation });
})(globalThis);
