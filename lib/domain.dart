import 'dart:math' as math;

/// Both storage scenarios always use the same stock requirement.
enum StockMode { consumption, entered }

double _number(Object? value, [double fallback = 0]) {
  if (value == null) return fallback;
  if (value is num) return value.toDouble();
  return double.tryParse(value.toString()) ?? double.nan;
}

// JSON cannot encode NaN/Infinity as numbers. Keeping their string form makes
// invalid persisted inputs remain invalid instead of becoming a valid zero.
Object _jsonNumber(double value) => value.isFinite ? value : value.toString();

int _integer(Object? value, int fallback) {
  final number = _number(value, fallback.toDouble());
  return number.isFinite && number == number.truncateToDouble()
      ? number.toInt()
      : 0;
}

class PartInput {
  const PartInput({
    required this.partNumber,
    this.qtyBox = 0,
    double? qtyPallet,
    this.qtyOnPallet = 0,
    double? consumption,
    double? doh,
    this.consumptionPerShift,
    this.packagingInferred = false,
    this.stockQty,
    this.partsPerPallet,
    this.monthlyConsumption,
    this.providedCoverageDays,
    required this.length,
    required this.width,
    required this.height,
    this.stacking = 1,
    this.inputErrors = const [],
  }) : qtyPallet = qtyPallet ?? 0,
       consumption = consumption ?? 0,
       doh = doh ?? 0,
       _hasLegacyPalletQuantity = qtyPallet != null,
       _hasLegacyDailyConsumption = consumption != null,
       _hasDoh = doh != null;

  final String partNumber;
  final double qtyBox;
  final double qtyPallet;
  final double qtyOnPallet;
  final double consumption;
  final double doh;
  final double? consumptionPerShift;
  final bool packagingInferred;
  final bool _hasLegacyPalletQuantity;
  final bool _hasLegacyDailyConsumption;
  final bool _hasDoh;
  final double? stockQty;
  final double? partsPerPallet;
  final double? monthlyConsumption;
  final double? providedCoverageDays;
  final double length;
  final double width;
  final double height;
  final double stacking;
  final List<String> inputErrors;

  Map<String, dynamic> toJson() => {
    'partNumber': partNumber,
    'qtyBox': _jsonNumber(qtyBox),
    if (_hasLegacyPalletQuantity) 'qtyPallet': _jsonNumber(qtyPallet),
    'qtyOnPallet': _jsonNumber(qtyOnPallet),
    if (_hasLegacyDailyConsumption) 'consumption': _jsonNumber(consumption),
    if (_hasDoh) 'doh': _jsonNumber(doh),
    if (consumptionPerShift != null)
      'consumptionPerShift': _jsonNumber(consumptionPerShift!),
    'packagingInferred': packagingInferred,
    'stockQty': stockQty == null ? null : _jsonNumber(stockQty!),
    if (partsPerPallet != null) 'partsPerPallet': _jsonNumber(partsPerPallet!),
    if (monthlyConsumption != null)
      'monthlyConsumption': _jsonNumber(monthlyConsumption!),
    if (providedCoverageDays != null)
      'providedCoverageDays': _jsonNumber(providedCoverageDays!),
    'length': _jsonNumber(length),
    'width': _jsonNumber(width),
    'height': _jsonNumber(height),
    'stacking': _jsonNumber(stacking),
    'inputErrors': inputErrors,
  };

  factory PartInput.fromJson(Map<String, dynamic> json) => PartInput(
    partNumber: json['partNumber']?.toString() ?? '',
    qtyBox: _number(json['qtyBox']),
    qtyPallet: json.containsKey('qtyPallet')
        ? _number(json['qtyPallet'], double.nan)
        : null,
    qtyOnPallet: _number(json['qtyOnPallet']),
    consumption: json.containsKey('consumption')
        ? _number(json['consumption'], double.nan)
        : null,
    doh: json.containsKey('doh') ? _number(json['doh'], double.nan) : null,
    consumptionPerShift: json.containsKey('consumptionPerShift')
        ? _number(json['consumptionPerShift'], double.nan)
        : null,
    packagingInferred: json['packagingInferred'] == true,
    stockQty: json['stockQty'] != null
        ? _number(json['stockQty'], double.nan)
        : null,
    partsPerPallet: json.containsKey('partsPerPallet')
        ? _number(json['partsPerPallet'], double.nan)
        : null,
    monthlyConsumption: json.containsKey('monthlyConsumption')
        ? _number(json['monthlyConsumption'], double.nan)
        : null,
    providedCoverageDays: json.containsKey('providedCoverageDays')
        ? _number(json['providedCoverageDays'], double.nan)
        : null,
    length: _number(json['length']),
    width: _number(json['width']),
    height: _number(json['height']),
    stacking: json.containsKey('stacking')
        ? _number(json['stacking'], double.nan)
        : 1,
    inputErrors: (json['inputErrors'] as List<dynamic>? ?? [])
        .map((value) => value.toString())
        .toList(),
  );
}

/// All dimensions are millimeters. Rack depth clearance is total clearance,
/// while frontage clearance is required at both ends and between pallets.
class WarehouseSettings {
  const WarehouseSettings({
    this.maxFloorStackingHeight = 5000,
    this.maxFloorRowDepth = 5000,
    this.gangwayWidth = 4500,
    this.floorPalletClearance = 100,
    this.rackLevels = 4,
    this.rackSlotLength = 2700,
    this.rackSlotDepth = 1200,
    this.rackSlotHeight = 1100,
    this.rackStructuralLength = 150,
    this.rackStructuralDepth = 200,
    this.rackStructuralHeight = 150,
    this.maxRackRunLength = 15000,
    this.rackFrontageClearance = 100,
    this.rackDepthClearance = 100,
    this.rackVerticalClearance = 100,
    this.allowRotation = false,
    this.stackabilityEnabled = false,
    this.stockMode = StockMode.consumption,
    this.workingDaysPerMonth = 22,
    this.shiftsPerDay = 2,
    this.coverageMode = 'input',
    this.customCoverageDays = 5,
  });

  final double maxFloorStackingHeight;
  final double maxFloorRowDepth;
  final double gangwayWidth;

  /// The allocated footprint uses the full configured physical aisle width.
  double get allocatedGangwayWidth => gangwayWidth;
  final double floorPalletClearance;
  final int rackLevels;
  final double rackSlotLength;
  final double rackSlotDepth;
  final double rackSlotHeight;
  final double rackStructuralLength;
  final double rackStructuralDepth;
  final double rackStructuralHeight;
  final double maxRackRunLength;
  final double rackFrontageClearance;
  final double rackDepthClearance;
  final double rackVerticalClearance;
  final bool allowRotation;
  final bool stackabilityEnabled;
  final StockMode stockMode;
  final int workingDaysPerMonth;
  final int shiftsPerDay;
  final String coverageMode;
  final double customCoverageDays;

  WarehouseSettings copyWith({
    double? maxFloorStackingHeight,
    double? maxFloorRowDepth,
    double? gangwayWidth,
    double? floorPalletClearance,
    int? rackLevels,
    double? rackSlotLength,
    double? rackSlotDepth,
    double? rackSlotHeight,
    double? rackStructuralLength,
    double? rackStructuralDepth,
    double? rackStructuralHeight,
    double? maxRackRunLength,
    double? rackFrontageClearance,
    double? rackDepthClearance,
    double? rackVerticalClearance,
    bool? allowRotation,
    bool? stackabilityEnabled,
    StockMode? stockMode,
    int? workingDaysPerMonth,
    int? shiftsPerDay,
    String? coverageMode,
    double? customCoverageDays,
  }) => WarehouseSettings(
    maxFloorStackingHeight:
        maxFloorStackingHeight ?? this.maxFloorStackingHeight,
    maxFloorRowDepth: maxFloorRowDepth ?? this.maxFloorRowDepth,
    gangwayWidth: gangwayWidth ?? this.gangwayWidth,
    floorPalletClearance: floorPalletClearance ?? this.floorPalletClearance,
    rackLevels: rackLevels ?? this.rackLevels,
    rackSlotLength: rackSlotLength ?? this.rackSlotLength,
    rackSlotDepth: rackSlotDepth ?? this.rackSlotDepth,
    rackSlotHeight: rackSlotHeight ?? this.rackSlotHeight,
    rackStructuralLength: rackStructuralLength ?? this.rackStructuralLength,
    rackStructuralDepth: rackStructuralDepth ?? this.rackStructuralDepth,
    rackStructuralHeight: rackStructuralHeight ?? this.rackStructuralHeight,
    maxRackRunLength: maxRackRunLength ?? this.maxRackRunLength,
    rackFrontageClearance: rackFrontageClearance ?? this.rackFrontageClearance,
    rackDepthClearance: rackDepthClearance ?? this.rackDepthClearance,
    rackVerticalClearance: rackVerticalClearance ?? this.rackVerticalClearance,
    allowRotation: allowRotation ?? this.allowRotation,
    stackabilityEnabled: stackabilityEnabled ?? this.stackabilityEnabled,
    stockMode: stockMode ?? this.stockMode,
    workingDaysPerMonth: workingDaysPerMonth ?? this.workingDaysPerMonth,
    shiftsPerDay: shiftsPerDay ?? this.shiftsPerDay,
    coverageMode: coverageMode ?? this.coverageMode,
    customCoverageDays: customCoverageDays ?? this.customCoverageDays,
  );

  List<String> validate() {
    final errors = <String>[];
    final positive = {
      'Maximum floor stacking height': maxFloorStackingHeight,
      'Rack usable slot length': rackSlotLength,
      'Rack usable slot depth': rackSlotDepth,
      'Rack usable slot height': rackSlotHeight,
      'Maximum rack run length': maxRackRunLength,
    };
    final nonNegative = {
      'Gangway width': gangwayWidth,
      'Floor pallet clearance': floorPalletClearance,
      'Maximum floor row depth (0 = unrestricted)': maxFloorRowDepth,
      'Custom target coverage': customCoverageDays,
      'Rack structural length allowance': rackStructuralLength,
      'Rack structural depth allowance': rackStructuralDepth,
      'Rack structural height allowance': rackStructuralHeight,
      'Rack frontage clearance': rackFrontageClearance,
      'Rack depth clearance': rackDepthClearance,
      'Rack vertical clearance': rackVerticalClearance,
    };
    for (final entry in positive.entries) {
      if (!entry.value.isFinite || entry.value <= 0) {
        errors.add('${entry.key} must be a finite number greater than zero.');
      }
    }
    for (final entry in nonNegative.entries) {
      if (!entry.value.isFinite || entry.value < 0) {
        errors.add('${entry.key} must be a finite non-negative number.');
      }
    }
    if (rackLevels < 1 || rackLevels > _maxExactInteger) {
      errors.add(
        'Rack levels must be a positive integer within supported numeric precision.',
      );
    }
    if (shiftsPerDay < 1 || shiftsPerDay > 3) {
      errors.add('Shifts per day must be a whole number from 1 to 3.');
    }
    if (!['input', '24h', '48h', 'custom'].contains(coverageMode)) {
      errors.add('Coverage mode must be input, 24h, 48h or custom.');
    }
    if (rackSlotLength.isFinite &&
        rackStructuralLength.isFinite &&
        maxRackRunLength.isFinite &&
        rackSlotLength + rackStructuralLength > maxRackRunLength) {
      errors.add(
        'Maximum rack run length must fit at least one effective rack bay.',
      );
    }
    if (rackSlotLength.isFinite &&
        rackFrontageClearance.isFinite &&
        rackFrontageClearance >= rackSlotLength) {
      errors.add(
        'Rack frontage clearance must be smaller than the usable slot length.',
      );
    }
    if (rackSlotDepth.isFinite &&
        rackDepthClearance.isFinite &&
        rackDepthClearance >= rackSlotDepth) {
      errors.add(
        'Rack depth clearance must be smaller than the usable slot depth.',
      );
    }
    if (rackSlotHeight.isFinite &&
        rackVerticalClearance.isFinite &&
        rackVerticalClearance >= rackSlotHeight) {
      errors.add(
        'Rack vertical clearance must be smaller than the usable slot height.',
      );
    }
    return errors;
  }

  Map<String, dynamic> toJson() => {
    'maxFloorStackingHeight': _jsonNumber(maxFloorStackingHeight),
    'maxFloorRowDepth': _jsonNumber(maxFloorRowDepth),
    'gangwayWidth': _jsonNumber(gangwayWidth),
    'floorPalletClearance': _jsonNumber(floorPalletClearance),
    'rackLevels': rackLevels,
    'rackSlotLength': _jsonNumber(rackSlotLength),
    'rackSlotDepth': _jsonNumber(rackSlotDepth),
    'rackSlotHeight': _jsonNumber(rackSlotHeight),
    'rackStructuralLength': _jsonNumber(rackStructuralLength),
    'rackStructuralDepth': _jsonNumber(rackStructuralDepth),
    'rackStructuralHeight': _jsonNumber(rackStructuralHeight),
    'maxRackRunLength': _jsonNumber(maxRackRunLength),
    'rackFrontageClearance': _jsonNumber(rackFrontageClearance),
    'rackDepthClearance': _jsonNumber(rackDepthClearance),
    'rackVerticalClearance': _jsonNumber(rackVerticalClearance),
    'allowRotation': allowRotation,
    'stackabilityEnabled': stackabilityEnabled,
    'stockMode': stockMode.name,
    'workingDaysPerMonth': workingDaysPerMonth,
    'shiftsPerDay': shiftsPerDay,
    'coverageMode': coverageMode,
    'customCoverageDays': _jsonNumber(customCoverageDays),
  };

  factory WarehouseSettings.fromJson(Map<String, dynamic> json) =>
      WarehouseSettings(
        maxFloorStackingHeight: _number(json['maxFloorStackingHeight'], 5000),
        maxFloorRowDepth: _number(json['maxFloorRowDepth'], 5000),
        gangwayWidth: _number(json['gangwayWidth'], 4500),
        floorPalletClearance: _number(json['floorPalletClearance'], 100),
        rackLevels: _integer(json['rackLevels'], 4),
        rackSlotLength: _number(json['rackSlotLength'], 2700),
        rackSlotDepth: _number(json['rackSlotDepth'], 1200),
        rackSlotHeight: _number(json['rackSlotHeight'], 1100),
        rackStructuralLength: _number(json['rackStructuralLength'], 150),
        rackStructuralDepth: _number(json['rackStructuralDepth'], 200),
        rackStructuralHeight: _number(json['rackStructuralHeight'], 150),
        maxRackRunLength: _number(json['maxRackRunLength'], 15000),
        rackFrontageClearance: _number(json['rackFrontageClearance'], 100),
        rackDepthClearance: _number(json['rackDepthClearance'], 100),
        rackVerticalClearance: _number(json['rackVerticalClearance'], 100),
        allowRotation: json['allowRotation'] == true,
        stackabilityEnabled: json['stackabilityEnabled'] == true,
        stockMode: json['stockMode'] == 'entered'
            ? StockMode.entered
            : StockMode.consumption,
        workingDaysPerMonth: _integer(json['workingDaysPerMonth'], 22),
        shiftsPerDay: _integer(json['shiftsPerDay'], 2),
        coverageMode: json['coverageMode']?.toString() ?? 'input',
        customCoverageDays: _number(json['customCoverageDays'], 5),
      );
}

/// Migrate once and persist: the per-shift rate remains fixed when shifts change.
PartInput normalizePart(PartInput input, WarehouseSettings settings) {
  final directShift = input.consumptionPerShift != null;
  final inferPackaging =
      !directShift &&
      !(input.qtyBox.isFinite &&
          input.qtyBox > 0 &&
          input.qtyOnPallet.isFinite &&
          input.qtyOnPallet > 0) &&
      input.partsPerPallet != null &&
      input.partsPerPallet!.isFinite &&
      input.partsPerPallet! > 0;
  final qtyBox = inferPackaging ? input.partsPerPallet! : input.qtyBox;
  final qtyOnPallet = inferPackaging ? 1.0 : input.qtyOnPallet;
  final capacity = qtyBox * qtyOnPallet;
  final perShift =
      input.consumptionPerShift ??
      (input.monthlyConsumption != null
          ? input.monthlyConsumption! /
                settings.workingDaysPerMonth /
                settings.shiftsPerDay
          : input._hasLegacyDailyConsumption
          ? input.consumption / settings.shiftsPerDay
          : double.nan);
  final doh =
      input._hasDoh &&
          (directShift || input.doh != 0 || input.providedCoverageDays == null)
      ? input.doh
      : input.providedCoverageDays ?? double.nan;
  return PartInput(
    partNumber: input.partNumber,
    qtyBox: qtyBox,
    qtyPallet: input._hasLegacyPalletQuantity ? input.qtyPallet : null,
    qtyOnPallet: qtyOnPallet,
    consumption: input._hasLegacyDailyConsumption ? input.consumption : null,
    consumptionPerShift: perShift,
    packagingInferred: input.packagingInferred || inferPackaging,
    doh: doh,
    stockQty:
        input.stockQty ??
        (!directShift && input._hasLegacyPalletQuantity
            ? input.qtyPallet * capacity
            : null),
    partsPerPallet: capacity,
    monthlyConsumption: input.monthlyConsumption,
    providedCoverageDays: doh,
    length: input.length,
    width: input.width,
    height: input.height,
    stacking: input.stacking,
    inputErrors: input.inputErrors,
  );
}

class FloorCalculation {
  const FloorCalculation({
    required this.maximumStacking,
    required this.effectiveStacking,
    required this.positions,
    required this.palletsPerRow,
    required this.rows,
    required this.rowWidth,
    required this.rowDepth,
    required this.totalOccupiedDepth,
    required this.fullRowDepth,
    required this.lastRowDepth,
    required this.lastRowPallets,
    required this.withoutGangways,
    required this.formulaPositions,
    required this.formulaStorageArea,
    required this.gangwayArea,
    required this.withGangways,
  });

  final int maximumStacking;
  final int effectiveStacking;
  final int positions;
  final int palletsPerRow;
  final int rows;
  final double rowWidth;
  final double rowDepth;
  final double totalOccupiedDepth;
  final double fullRowDepth;
  final double lastRowDepth;
  final int lastRowPallets;
  final double withoutGangways;
  double get storageArea => _storageAreaCents(withoutGangways) / 100;

  /// Unrounded Q/S used only for the independent with-gangways formula.
  final double formulaPositions;
  final double formulaStorageArea;
  final double gangwayArea;
  final double withGangways;
}

class RackCalculation {
  const RackCalculation({
    required this.palletsPerSlot,
    required this.levels,
    required this.capacityPerBay,
    required this.bays,
    required this.maxBaysPerRun,
    required this.runs,
    required this.rotated,
    required this.effectiveBayLength,
    required this.effectiveBayDepth,
    required this.effectiveBayHeight,
    required this.withoutGangways,
    required this.gangwayArea,
    required this.withGangways,
    required this.baysPerRun,
  });

  final int palletsPerSlot;
  final int levels;
  final int capacityPerBay;
  final int bays;
  final int maxBaysPerRun;
  final int runs;
  final bool rotated;
  final double effectiveBayLength;
  final double effectiveBayDepth;
  final double effectiveBayHeight;
  final double withoutGangways;
  final double gangwayArea;
  final double withGangways;
  final List<int> baysPerRun;
}

class PlanningCalculation {
  const PlanningCalculation({
    required this.qtyBox,
    required this.qtyOnPallet,
    required this.consumptionPerShift,
    required this.palletsPerShift,
    required this.roundedPalletsPerShift,
    required this.plannedPalletsPerDay,
    required this.requiredPallets,
    required this.dailyConsumption,
    required this.shiftConsumption,
    required this.palletsPerDay,
    required this.currentPallets,
    required this.currentPalletPositions,
    required this.palletDurationDays,
    required this.actualCoverageDays,
    required this.coverageDifferenceDays,
    required this.coverageMismatch,
    required this.providedCoverageDays,
    required this.monthlyConsumption,
    required this.partsPerPallet,
    required this.stockQty,
    required this.noConsumption,
    required this.targetCoverageDays,
    required this.pallets24h,
    required this.pallets48h,
    required this.palletsCustom,
    required this.customCoverageDays,
  });
  final double qtyBox;
  final double qtyOnPallet;
  final double consumptionPerShift;
  final double palletsPerShift;
  final int roundedPalletsPerShift;
  final int plannedPalletsPerDay;
  final int requiredPallets;
  final double dailyConsumption;
  final double shiftConsumption;
  final double palletsPerDay;
  final double? currentPallets;
  final int? currentPalletPositions;
  final double? palletDurationDays;
  final double? actualCoverageDays;
  final double? coverageDifferenceDays;
  final bool coverageMismatch;
  final double providedCoverageDays;
  final double? monthlyConsumption;
  final double partsPerPallet;
  final double? stockQty;
  final bool noConsumption;
  final double targetCoverageDays;
  final int pallets24h;
  final int pallets48h;
  final int palletsCustom;
  final double customCoverageDays;
}

class PartCalculation {
  const PartCalculation({
    required this.input,
    this.requiredParts,
    this.requiredPallets,
    this.floor,
    this.rack,
    this.planning,
    this.errors = const [],
    this.excludedFromTotals = false,
  });

  final PartInput input;
  final double? requiredParts;
  final int? requiredPallets;
  final FloorCalculation? floor;
  final RackCalculation? rack;
  final PlanningCalculation? planning;
  final List<String> errors;
  final bool excludedFromTotals;
  bool get isFloorValid => !excludedFromTotals && floor != null;
  bool get isRackValid => !excludedFromTotals && rack != null;
  bool get isPlanningValid => !excludedFromTotals && planning != null;
  bool get isValid =>
      !excludedFromTotals && errors.isEmpty && floor != null && rack != null;
}

int _storageAreaCents(double value) {
  final scaled = value * 100;
  if (!scaled.isFinite || scaled.abs() > _maxExactInteger) {
    throw const FormatException(
      'Floor storage area exceeds supported numeric precision.',
    );
  }
  return (scaled + 2.220446049250313e-16 * math.max(1, scaled.abs()) * 4)
      .round();
}

// Keep integer calculations exact on both Android and Flutter Web.
const _maxExactInteger = 9007199254740991;

int _ceil(double value, {bool correctArithmeticNoise = true}) {
  if (!value.isFinite || value.abs() > _maxExactInteger) {
    throw const FormatException(
      'Calculated quantities exceed supported numeric precision.',
    );
  }
  if (!correctArithmeticNoise) return value.ceil();
  final nearest = value.round();
  return nearest != 0 &&
          (value - nearest).abs() <= 2.220446049250313e-16 * value.abs() * 4
      ? nearest
      : value.ceil();
}

int _floor(double value) {
  if (!value.isFinite || value.abs() > _maxExactInteger) {
    throw const FormatException(
      'Calculated quantities exceed supported numeric precision.',
    );
  }
  return value.floor();
}

int _ceilDivide(int numerator, int denominator) =>
    numerator ~/ denominator + (numerator % denominator == 0 ? 0 : 1);

List<String> _validateInput(PartInput p) {
  final errors = <String>[...p.inputErrors];
  if (p.partNumber.trim().isEmpty) errors.add('Part Number is required.');
  final positive = <String, double>{
    'Pallet length': p.length,
    'Pallet width': p.width,
    'Loaded pallet height': p.height,
    'Stacking': p.stacking,
    'QTY in Box': p.qtyBox,
    'QTY boxes per Pallet': p.qtyOnPallet,
    'Parts per pallet': p.partsPerPallet!,
  };
  final nonNegative = <String, double>{
    'Consumption per shift': p.consumptionPerShift!,
    'DOH (Days on hand)': p.doh,
  };
  for (final entry in positive.entries) {
    if (!entry.value.isFinite || entry.value <= 0) {
      errors.add('${entry.key} must be a finite number greater than zero.');
    }
  }
  for (final entry in nonNegative.entries) {
    if (!entry.value.isFinite || entry.value < 0) {
      errors.add('${entry.key} must be a finite non-negative number.');
    }
  }
  final integerFields = <String, double>{
    'Stacking': p.stacking,
    'QTY in Box': p.qtyBox,
    'QTY boxes per Pallet': p.qtyOnPallet,
    'Parts per pallet': p.partsPerPallet!,
  };
  for (final entry in integerFields.entries) {
    if (entry.value.isFinite && entry.value != entry.value.truncateToDouble()) {
      errors.add('${entry.key} must be a whole number.');
    }
    if (entry.value.isFinite && entry.value.abs() > _maxExactInteger) {
      errors.add('${entry.key} exceeds supported numeric precision.');
    }
  }
  return errors;
}

PartCalculation calculatePart(PartInput input, WarehouseSettings settings) {
  input = normalizePart(input, settings);
  final errors = <String>[...settings.validate(), ..._validateInput(input)];
  if (errors.isNotEmpty) return PartCalculation(input: input, errors: errors);

  double? requiredParts;
  int? requiredPallets;
  FloorCalculation? floor;
  RackCalculation? rack;
  PlanningCalculation? planning;
  try {
    final capacity = input.partsPerPallet!;
    final consumptionPerShift = input.consumptionPerShift!;
    final shiftConsumption = consumptionPerShift;
    final dailyConsumption = consumptionPerShift * settings.shiftsPerDay;
    final palletsPerShift =
        consumptionPerShift / input.qtyBox / input.qtyOnPallet;
    final roundedPalletsPerShift = _ceil(
      palletsPerShift,
      correctArithmeticNoise: false,
    );
    final palletsPerDay = palletsPerShift * settings.shiftsPerDay;
    final plannedPalletsPerDay = _ceil(
      palletsPerDay,
      correctArithmeticNoise: false,
    );
    final stock = input.stockQty;
    final knownStock =
        stock != null &&
        stock.isFinite &&
        stock >= 0 &&
        stock <= _maxExactInteger &&
        stock == stock.truncateToDouble();
    final currentPallets = knownStock ? stock / capacity : null;
    final noConsumption = dailyConsumption == 0;
    final palletDurationDays = noConsumption
        ? null
        : capacity / dailyConsumption;
    final actualCoverageDays = noConsumption || !knownStock
        ? null
        : stock / dailyConsumption;
    final coverageDifferenceDays = actualCoverageDays == null
        ? null
        : actualCoverageDays - input.doh;
    final targetCoverageDays = settings.coverageMode == '24h'
        ? 1.0
        : settings.coverageMode == '48h'
        ? 2.0
        : settings.coverageMode == 'custom'
        ? settings.customCoverageDays
        : input.doh;
    requiredParts = dailyConsumption * targetCoverageDays;
    requiredPallets = _ceil(plannedPalletsPerDay * targetCoverageDays);
    if (![
          dailyConsumption,
          shiftConsumption,
          palletsPerDay,
          requiredParts,
          ?currentPallets,
          ?palletDurationDays,
          ?actualCoverageDays,
          ?coverageDifferenceDays,
        ].every((value) => value.isFinite) ||
        requiredParts > _maxExactInteger) {
      throw const FormatException(
        'Shift planning values exceed supported numeric precision.',
      );
    }
    planning = PlanningCalculation(
      qtyBox: input.qtyBox,
      qtyOnPallet: input.qtyOnPallet,
      consumptionPerShift: consumptionPerShift,
      palletsPerShift: palletsPerShift,
      roundedPalletsPerShift: roundedPalletsPerShift,
      plannedPalletsPerDay: plannedPalletsPerDay,
      requiredPallets: requiredPallets,
      dailyConsumption: dailyConsumption,
      shiftConsumption: shiftConsumption,
      palletsPerDay: palletsPerDay,
      currentPallets: currentPallets,
      currentPalletPositions: knownStock ? _ceil(currentPallets!) : null,
      palletDurationDays: palletDurationDays,
      actualCoverageDays: actualCoverageDays,
      coverageDifferenceDays: coverageDifferenceDays,
      coverageMismatch:
          coverageDifferenceDays != null && coverageDifferenceDays.abs() > 1e-9,
      providedCoverageDays: input.doh,
      monthlyConsumption: input.monthlyConsumption?.isFinite == true
          ? input.monthlyConsumption
          : null,
      partsPerPallet: capacity,
      stockQty: knownStock ? stock : null,
      noConsumption: noConsumption,
      targetCoverageDays: targetCoverageDays,
      pallets24h: plannedPalletsPerDay,
      pallets48h: _ceil(2.0 * plannedPalletsPerDay),
      palletsCustom: _ceil(settings.customCoverageDays * plannedPalletsPerDay),
      customCoverageDays: settings.customCoverageDays,
    );

    final maximumStacking = _floor(
      settings.maxFloorStackingHeight / input.height,
    );
    final effectiveStacking = math.min(
      settings.stackabilityEnabled ? input.stacking.toInt() : 1,
      maximumStacking,
    );
    final positions = effectiveStacking >= 1
        ? _ceilDivide(requiredPallets, effectiveStacking)
        : 0;
    final palletsPerRow = settings.maxFloorRowDepth == 0
        ? math.max(positions, 1)
        : _floor(
            (settings.maxFloorRowDepth + settings.floorPalletClearance) /
                (input.length + settings.floorPalletClearance),
          );
    if (maximumStacking < 1) {
      errors.add(
        'Floor: loaded pallet height exceeds maximum floor stacking height.',
      );
    }
    if (palletsPerRow < 1) {
      errors.add(
        'Floor: pallet length cannot fit within the maximum row depth.',
      );
    }
    if (effectiveStacking >= 1 && palletsPerRow >= 1) {
      final rows = _ceilDivide(positions, palletsPerRow);
      final rowWidth = (input.width + settings.floorPalletClearance) / 1000;
      double occupiedDepth(int count) => count > 0
          ? (count * input.length +
                    (count - 1) * settings.floorPalletClearance) /
                1000
          : 0;
      final lastRowPallets = rows > 0
          ? positions - (rows - 1) * palletsPerRow
          : 0;
      final fullRowDepth = occupiedDepth(math.min(positions, palletsPerRow));
      final lastRowDepth = occupiedDepth(lastRowPallets);
      final rowDepth = fullRowDepth;
      final totalOccupiedDepth =
          (positions * input.length +
              math.max(0, positions - rows) * settings.floorPalletClearance) /
          1000;
      final without = rowWidth * totalOccupiedDepth;
      _storageAreaCents(
        without,
      ); // Validate the displayed storage contribution.
      // The with-gangways formula keeps Q/S fractional. Rounded floor positions
      // and row clearances continue to apply to the storage-only calculation.
      final formulaPositions = requiredPallets / effectiveStacking;
      final formulaStorageArea =
          formulaPositions * input.length * input.width / 1000000;
      final gangway =
          formulaPositions *
          input.length *
          settings.allocatedGangwayWidth /
          1000000;
      final withGangways =
          formulaPositions *
          input.length *
          (input.width + settings.allocatedGangwayWidth) /
          1000000;
      if (![
        without,
        formulaPositions,
        formulaStorageArea,
        gangway,
        withGangways,
      ].every((v) => v.isFinite)) {
        throw const FormatException(
          'Floor area exceeds supported numeric precision.',
        );
      }
      floor = FloorCalculation(
        maximumStacking: maximumStacking,
        effectiveStacking: effectiveStacking,
        positions: positions,
        palletsPerRow: palletsPerRow,
        rows: rows,
        rowWidth: rowWidth,
        rowDepth: rowDepth,
        totalOccupiedDepth: totalOccupiedDepth,
        fullRowDepth: fullRowDepth,
        lastRowDepth: lastRowDepth,
        lastRowPallets: lastRowPallets,
        withoutGangways: without,
        formulaPositions: formulaPositions,
        formulaStorageArea: formulaStorageArea,
        gangwayArea: gangway,
        withGangways: withGangways,
      );
    }

    int orientationCapacity(double frontage, double depth) {
      if (depth + settings.rackDepthClearance > settings.rackSlotDepth ||
          input.height + settings.rackVerticalClearance >
              settings.rackSlotHeight) {
        return 0;
      }
      return math.max(
        0,
        _floor(
          (settings.rackSlotLength - settings.rackFrontageClearance) /
              (frontage + settings.rackFrontageClearance),
        ),
      );
    }

    final originalCapacity = orientationCapacity(input.length, input.width);
    final rotatedCapacity = settings.allowRotation
        ? orientationCapacity(input.width, input.length)
        : 0;
    final rotated = rotatedCapacity > originalCapacity;
    final palletsPerSlot = math.max(originalCapacity, rotatedCapacity);
    if (palletsPerSlot < 1) {
      if (input.height + settings.rackVerticalClearance >
          settings.rackSlotHeight) {
        errors.add(
          'Rack: loaded pallet height plus vertical clearance exceeds usable slot height.',
        );
      } else {
        errors.add(
          'Rack: pallet cannot fit the usable slot frontage/depth with the configured clearances${settings.allowRotation ? ' in either orientation' : ''}.',
        );
      }
    } else {
      if (palletsPerSlot > _maxExactInteger ~/ settings.rackLevels) {
        throw const FormatException(
          'Rack capacity exceeds supported numeric precision.',
        );
      }
      final capacity = palletsPerSlot * settings.rackLevels;
      final bays = _ceilDivide(requiredPallets, capacity);
      final bayLength = settings.rackSlotLength + settings.rackStructuralLength;
      final bayDepth = settings.rackSlotDepth + settings.rackStructuralDepth;
      final bayHeight = settings.rackSlotHeight + settings.rackStructuralHeight;
      final maxBaysPerRun = _floor(settings.maxRackRunLength / bayLength);
      final runs = _ceilDivide(bays, maxBaysPerRun);
      // Store only the allocation, never a phantom full final run.
      // An upper bound avoids allocating unbounded RAM for corrupt inputs.
      if (runs > 1000000) {
        throw const FormatException(
          'Rack run count exceeds the supported project size (1,000,000 runs per part).',
        );
      }
      final baysPerRun = List<int>.generate(
        runs,
        (index) => math.min(maxBaysPerRun, bays - index * maxBaysPerRun),
      );
      final without = bays * bayLength * bayDepth / 1000000;
      final frontageMetres = baysPerRun.fold<double>(
        0,
        (sum, count) => sum + count * bayLength / 1000,
      );
      final gangway = frontageMetres * settings.allocatedGangwayWidth / 1000;
      // Combine storage and the full-width allocation before unit conversion.
      final withGangways =
          bays *
          bayLength *
          (bayDepth + settings.allocatedGangwayWidth) /
          1000000;
      if (![
        without,
        gangway,
        withGangways,
        bayHeight,
      ].every((v) => v.isFinite)) {
        throw const FormatException(
          'Rack area exceeds supported numeric precision.',
        );
      }
      rack = RackCalculation(
        palletsPerSlot: palletsPerSlot,
        levels: settings.rackLevels,
        capacityPerBay: capacity,
        bays: bays,
        maxBaysPerRun: maxBaysPerRun,
        runs: runs,
        rotated: rotated,
        effectiveBayLength: bayLength,
        effectiveBayDepth: bayDepth,
        effectiveBayHeight: bayHeight,
        withoutGangways: without,
        gangwayArea: gangway,
        withGangways: withGangways,
        baysPerRun: List.unmodifiable(baysPerRun),
      );
    }
  } on FormatException catch (error) {
    errors.add(error.message);
  }
  return PartCalculation(
    input: input,
    requiredParts: requiredParts,
    requiredPallets: requiredPallets,
    floor: floor,
    rack: rack,
    planning: planning,
    errors: List.unmodifiable(errors),
  );
}

/// Aggregate floor and rack scenarios independently and retain validation errors.
/// Floor storage totals add the exact two-decimal contributions shown per part.
class ProjectCalculation {
  ProjectCalculation({required this.results, this.settingsErrors = const []});

  final List<PartCalculation> results;
  final List<String> settingsErrors;

  Iterable<PartCalculation> get _floor => results.where((r) => r.isFloorValid);
  Iterable<PartCalculation> get _rack => results.where((r) => r.isRackValid);
  Iterable<PartCalculation> get _planned =>
      results.where((r) => r.isPlanningValid);
  int get invalidCount => results.where((r) => !r.isValid).length;
  int get validCount => results.length - invalidCount;
  int get floorValidCount => _floor.length;
  int get rackValidCount => _rack.length;
  int get totalRequiredPallets =>
      _planned.fold(0, (sum, r) => sum + r.requiredPallets!);
  int get totalFloorPositions =>
      _floor.fold(0, (sum, r) => sum + r.floor!.positions);
  int get totalFloorRows => _floor.fold(0, (sum, r) => sum + r.floor!.rows);
  int get totalRackBays => _rack.fold(0, (sum, r) => sum + r.rack!.bays);
  int get totalRackRuns => _rack.fold(0, (sum, r) => sum + r.rack!.runs);
  double get floorWithoutGangways =>
      _floor.fold<int>(
        0,
        (sum, r) => sum + _storageAreaCents(r.floor!.withoutGangways),
      ) /
      100;
  double get floorWithGangways =>
      _floor.fold(0, (sum, r) => sum + r.floor!.withGangways);
  double get rackWithoutGangways =>
      _rack.fold(0, (sum, r) => sum + r.rack!.withoutGangways);
  double get rackWithGangways =>
      _rack.fold(0, (sum, r) => sum + r.rack!.withGangways);
  double get floorGangwayArea =>
      _floor.fold(0, (sum, r) => sum + r.floor!.gangwayArea);
  double get rackGangwayArea =>
      _rack.fold(0, (sum, r) => sum + r.rack!.gangwayArea);
  double get savingWithoutGangways =>
      floorWithoutGangways - rackWithoutGangways;
  double get savingWithGangways => floorWithGangways - rackWithGangways;
  double? get savingWithoutGangwaysPercent => floorWithoutGangways == 0
      ? null
      : savingWithoutGangways / floorWithoutGangways * 100;
  double? get savingWithGangwaysPercent => floorWithGangways == 0
      ? null
      : savingWithGangways / floorWithGangways * 100;
}

ProjectCalculation calculateProject(
  List<PartInput> inputs,
  WarehouseSettings settings,
) {
  final settingsErrors = settings.validate();
  if (settingsErrors.isNotEmpty) {
    return ProjectCalculation(
      settingsErrors: settingsErrors,
      results: inputs
          .map(
            (input) => PartCalculation(
              input: normalizePart(input, settings),
              errors: [
                'Warehouse settings are invalid. Correct the settings to calculate this part.',
              ],
            ),
          )
          .toList(),
    );
  }
  final counts = <String, int>{};
  for (final input in inputs) {
    final key = input.partNumber.trim().toUpperCase();
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return ProjectCalculation(
    results: inputs.map((input) {
      final result = calculatePart(input, settings);
      if ((counts[input.partNumber.trim().toUpperCase()] ?? 0) > 1) {
        return PartCalculation(
          input: result.input,
          requiredParts: result.requiredParts,
          requiredPallets: result.requiredPallets,
          floor: result.floor,
          rack: result.rack,
          planning: result.planning,
          excludedFromTotals: true,
          errors: [
            ...result.errors,
            'Duplicate Part Number. Consolidate this part into one input row.',
          ],
        );
      }
      return result;
    }).toList(),
  );
}
