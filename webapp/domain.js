/* LogEn warehouse calculation engine. Dimensions: mm; footprint results: m².
 * This file has no UI, network or third-party dependencies. */
(function (scope) {
  'use strict';

  function createDefaultSettings() {
    return {
      maxFloorStackingHeight: 5000, maxFloorRowDepth: 5000,
      gangwayWidth: 4500, floorPalletClearance: 100,
      rackSurfaceAllowance: 4.125, rackPitch: 3300, rackLevels: 4, rackSlotLength: 2700, rackSlotDepth: 1200,
      rackSlotHeight: 1100, betweenBoxesAllowance: 0, rackStructuralLength: 150,
      rackStructuralDepth: 200, rackStructuralHeight: 150,
      maxRackRunLength: 15000, rackFrontageClearance: 100,
      rackDepthClearance: 100, rackVerticalClearance: 100,
      allowRotation: false, stockMode: 'consumption',
      workingDaysPerMonth: 22, shiftsPerDay: 2,
      coverageMode: 'input', customCoverageDays: 5, stackabilityEnabled: false
    };
  }

  const positiveSettings = {
    rackPitch: 'Rack pitch',
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

  function validateSettings(s) {
    const errors = [];
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
    const values = [input.length,input.width,input.height,settings.rackSlotLength,settings.rackSlotDepth,settings.rackSlotHeight];
    if (!values.every(v => Number.isFinite(v) && v > 0)) return 'N/A';
    return input.height <= settings.rackSlotHeight &&
      ((input.length <= settings.rackSlotLength && input.width <= settings.rackSlotDepth) ||
       (input.width <= settings.rackSlotLength && input.length <= settings.rackSlotDepth)) ? 'YES' : 'NO';
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
  function calculateBoxRack(requiredBoxes, length, width, height, slotLength, slotDepth, slotHeight, levels, gap = 0) {
    if (!Number.isFinite(gap) || gap < 0) throw new Error('Between boxes allowance must be finite and non-negative.');
    if (![length,width,height,slotLength,slotDepth,slotHeight].every(v => Number.isFinite(v) && v > 0) ||
        !Number.isSafeInteger(requiredBoxes) || requiredBoxes < 0 || !Number.isSafeInteger(levels) || levels < 1)
      throw new Error('Rack sizing requires whole non-negative boxes, positive dimensions and whole positive levels.');
    const capacity = (l,w) => height <= slotHeight ? floor((slotLength + gap) / (l + gap)) * floor((slotDepth + gap) / (w + gap)) : 0;
    const original = capacity(length,width), rotatedCapacity = capacity(width,length);
    const boxesPerSlot = Math.max(original,rotatedCapacity);
    const fits = boxesPerSlot > 0;
    const capacityPerBay = boxesPerSlot * levels;
    if (!Number.isSafeInteger(capacityPerBay)) throw new Error('Rack capacity exceeds supported precision.');
    const bays = fits ? ceilDivide(requiredBoxes,capacityPerBay) : 0;
    const bayArea = slotLength * slotDepth / 1000000;
    const withoutGangways = bays * bayArea;
    const availableShelfArea = withoutGangways * levels;
    const occupiedShelfArea = fits ? requiredBoxes * length * width / 1000000 : 0;
    const unusedShelfArea = Math.max(0,availableShelfArea - occupiedShelfArea);
    const utilizationPercent = availableShelfArea > 0 ? occupiedShelfArea / availableShelfArea * 100 : null;
    const values = [bayArea,withoutGangways,availableShelfArea,occupiedShelfArea,unusedShelfArea];
    if (!values.every(Number.isFinite)) throw new Error('Rack surface exceeds supported precision.');
    return {fits, requiredBoxes, nonFittingBoxes: fits ? 0 : requiredBoxes, boxesPerSlot,
      capacityPerBay, bays, bayArea, withoutGangways, rotated: rotatedCapacity > original,
      availableShelfArea, occupiedShelfArea, unusedShelfArea, unusedPerLevel: unusedShelfArea / levels,
      utilizationPercent, unusedPercent: utilizationPercent === null ? null : 100-utilizationPercent};
  }
  function calculatePart(input, settings) {
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
      requiredPallets = ceil(plannedPalletsPerDay * targetCoverageDays);
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
      const effectiveStacking = Math.min(s.stackabilityEnabled ? input.stacking : 1, maximumStacking);
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
        floorResult = { floorLength, floorWidth, maximumStacking, effectiveStacking, positions,
          palletsPerRow, rows, rowWidth, rowDepth, totalOccupiedDepth, fullRowDepth,
          lastRowDepth, lastRowPallets, withoutGangways,
          storageArea, formulaPositions,
          formulaStorageArea, gangwayArea, withGangways };
      }

      const sizing = calculateBoxRack(requiredPallets, input.length, input.width, input.height,
        s.rackSlotLength, s.rackSlotDepth, s.rackSlotHeight, s.rackLevels, s.betweenBoxesAllowance);
      if (!sizing.fits) {
        errors.push('Rack: unit does not fit the usable shelf length, depth and height in either horizontal orientation.');
      } else {
        const {bays, capacityPerBay, rotated} = sizing;
        const palletsPerSlot = sizing.boxesPerSlot;
        const effectiveBayLength = s.rackSlotLength + s.rackStructuralLength;
        const effectiveBayDepth = s.rackSlotDepth + s.rackStructuralDepth;
        const effectiveBayHeight = s.rackSlotHeight + s.rackStructuralHeight;
        const maxBaysPerRun = floor(s.maxRackRunLength / effectiveBayLength);
        const runs = ceilDivide(bays, maxBaysPerRun);
        if (runs > 1000000)
          throw new Error('Rack run count exceeds the supported project size (1,000,000 runs per part).');
        const baysPerRun = Array.from({ length: runs }, (_, index) =>
          Math.min(maxBaysPerRun, bays - index * maxBaysPerRun));
        const withoutGangways = sizing.withoutGangways;
        const totalFrontageMetres = baysPerRun.reduce((total, count) =>
          total + count * effectiveBayLength / 1000, 0);
        const gangwayArea = bays * s.rackPitch * (s.gangwayWidth / 1000) / 2000;
        const withGangways = gangwayArea;
        if (![withoutGangways, gangwayArea, withGangways, effectiveBayHeight].every(Number.isFinite))
          throw new Error('Rack area exceeds supported numeric precision.');
        rack = { ...sizing, palletsPerSlot, levels: s.rackLevels, capacityPerBay, bays,
          maxBaysPerRun, runs, rotated, effectiveBayLength, effectiveBayDepth,
          effectiveBayHeight, withoutGangways, gangwayArea, withGangways, baysPerRun };
      }
    } catch (error) { errors.push(error.message); }
    return resultFor(input, errors, requiredParts, requiredPallets, floorResult, rack, planning);
  }

  function sharedRackPlan(results, s) {
    const shelves=[];
    const rows=results.filter(r=>r.isRackValid).sort((a,b)=>b.input.length*b.input.width-a.input.length*a.input.width);
    const quantity=rows.reduce((n,r)=>n+r.requiredPallets,0);
    if(quantity>10000) return {available:false,error:'Shared rack preview supports up to 10,000 units.'};
    for(const r of rows) for(let unit=0;unit<r.requiredPallets;unit++) {
      let best=null;
      for(let shelf=0;shelf<shelves.length;shelf++) shelves[shelf].free.forEach((rect,index)=>{
        for(const [w,d] of [[r.input.length,r.input.width],[r.input.width,r.input.length]])
          if(w<=rect.w && d<=rect.d) { const score=rect.w*rect.d-w*d; if(!best||score<best.score)best={shelf,index,w,d,score}; }
      });
      if(!best){shelves.push({free:[{x:0,y:0,w:s.rackSlotLength,d:s.rackSlotDepth}],placements:[]});best={shelf:shelves.length-1,index:0,w:r.input.length,d:r.input.width};if(best.w>s.rackSlotLength||best.d>s.rackSlotDepth)[best.w,best.d]=[best.d,best.w];}
      const sh=shelves[best.shelf],rect=sh.free.splice(best.index,1)[0];
      sh.placements.push({partNumber:r.input.partNumber,x:rect.x,y:rect.y,length:best.w,depth:best.d});
      if(rect.w>best.w+s.betweenBoxesAllowance)sh.free.push({x:rect.x+best.w+s.betweenBoxesAllowance,y:rect.y,w:rect.w-best.w-s.betweenBoxesAllowance,d:best.d});
      if(rect.d>best.d+s.betweenBoxesAllowance)sh.free.push({x:rect.x,y:rect.y+best.d+s.betweenBoxesAllowance,w:rect.w,d:rect.d-best.d-s.betweenBoxesAllowance});
    }
    const bays=ceilDivide(shelves.length,s.rackLevels),bayArea=s.rackSlotLength*s.rackSlotDepth/1000000;
    const occupied=rows.reduce((n,r)=>n+r.requiredPallets*r.input.length*r.input.width/1000000,0),available=bays*bayArea*s.rackLevels;
    return {available:true,shelves,bays,quantity,withoutGangways:bays*bayArea,withGangways:bays*s.rackPitch*s.gangwayWidth/2000000,occupied,availableShelfArea:available,unused:Math.max(0,available-occupied),utilization:available>0?occupied/available*100:null};
  }
  function calculateProject(parts, settings) {
    const s = { ...createDefaultSettings(), ...settings };
    const settingsErrors = validateSettings(s);
    const counts = new Map();
    const keyFor = p => String(p.partNumber == null ? '' : p.partNumber).trim().toUpperCase();
    parts.forEach(p => counts.set(keyFor(p), (counts.get(keyFor(p)) || 0) + 1));
    const results = parts.map(input => {
      if (settingsErrors.length)
        return resultFor(normalizePart(input, s), ['Warehouse settings are invalid. Correct the settings to calculate this part.']);
      const result = calculatePart(input, s);
      result.rackFit = rackFit(result.input, s);
      if (counts.get(keyFor(input)) > 1) {
        result.errors.push('Duplicate Part Number. Consolidate this part into one input row.');
        result.isValid = false;
        result.isFloorValid = result.isRackValid = result.isPlanningValid = false;
      }
      return result;
    });
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
      project.totalRackRuns=ceilDivide(shared.bays, floor(s.maxRackRunLength/(s.rackSlotLength+s.rackStructuralLength)));
      project.rackWithoutGangways=shared.withoutGangways;project.rackWithGangways=shared.withGangways;project.rackGangwayArea=shared.withGangways;
      project.rackAvailableShelfArea=shared.availableShelfArea;project.rackOccupiedShelfArea=shared.occupied;
      project.rackUnusedShelfArea=shared.unused;project.rackUnusedPerLevel=shared.unused/s.rackLevels;
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

  scope.LogEnDomain = Object.freeze({ createDefaultSettings, calculateBoxRack, rackFit, surfaceAreas, allocatedGangwayWidth, normalizePart, validateSettings, calculatePart, calculateProject });
})(globalThis);
