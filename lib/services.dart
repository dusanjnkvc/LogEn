import 'dart:convert';
import 'dart:typed_data';

import 'package:excel/excel.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'domain.dart';

/// One independent warehouse project. All data remains on the local device.
class WarehouseProject {
  WarehouseProject({
    required this.id,
    required this.name,
    this.parts = const [],
    WarehouseSettings? settings,
    this.sourceName,
    DateTime? updatedAt,
    this.rawInputRows,
  }) : settings = settings ?? WarehouseSettings(),
       updatedAt = updatedAt ?? DateTime.now();

  final String id;
  final String name;
  final List<PartInput> parts;
  final WarehouseSettings settings;
  final String? sourceName;
  final DateTime updatedAt;

  /// Original worksheet values, including unmapped columns and invalid cells.
  /// Formula text is retained as text; this app does not evaluate Excel formulas.
  final List<List<Object?>>? rawInputRows;

  WarehouseProject copyWith({
    String? id,
    String? name,
    List<PartInput>? parts,
    WarehouseSettings? settings,
    String? sourceName,
    DateTime? updatedAt,
    List<List<Object?>>? rawInputRows,
    bool clearRawInputRows = false,
    bool clearSourceName = false,
  }) => WarehouseProject(
    id: id ?? this.id,
    name: name ?? this.name,
    parts: parts ?? this.parts,
    settings: settings ?? this.settings,
    sourceName: clearSourceName ? null : sourceName ?? this.sourceName,
    updatedAt: updatedAt ?? DateTime.now(),
    rawInputRows: clearRawInputRows ? null : rawInputRows ?? this.rawInputRows,
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'name': name,
    'parts': parts.map((part) => part.toJson()).toList(),
    'settings': settings.toJson(),
    'sourceName': sourceName,
    'updatedAt': updatedAt.toIso8601String(),
    'rawInputRows': rawInputRows,
  };

  factory WarehouseProject.fromJson(Map<String, dynamic> json) {
    final settings = WarehouseSettings.fromJson(
      Map<String, dynamic>.from(json['settings'] as Map),
    );
    final migratedSettings = settings.copyWith(
      stockMode: StockMode.consumption,
      coverageMode: ['24h', '48h'].contains(settings.coverageMode)
          ? 'custom'
          : settings.coverageMode,
      customCoverageDays: settings.coverageMode == '24h'
          ? 1
          : settings.coverageMode == '48h'
          ? 2
          : settings.customCoverageDays,
    );
    return WarehouseProject(
      id: json['id'] as String,
      name: json['name'] as String,
      parts: (json['parts'] as List<dynamic>)
          .map(
            (value) => normalizePart(
              PartInput.fromJson(Map<String, dynamic>.from(value as Map)),
              settings,
            ),
          )
          .toList(),
      settings: migratedSettings,
      sourceName: json['sourceName'] as String?,
      updatedAt: DateTime.parse(json['updatedAt'] as String),
      rawInputRows: (json['rawInputRows'] as List<dynamic>?)
          ?.map((row) => List<Object?>.from(row as List))
          .toList(),
    );
  }
}

class ProjectStore {
  static const storageKey = 'logen.projects.v1';
  static const backupKey = 'logen.projects.backup.v1';

  Future<List<WarehouseProject>> load() async {
    final preferences = await SharedPreferences.getInstance();
    await preferences.reload();
    final text = preferences.getString(storageKey);
    if (text == null) return [];
    try {
      final envelope = jsonDecode(text) as Map<String, dynamic>;
      if (envelope['version'] != 1) {
        throw const FormatException('Unsupported project data version.');
      }
      return (envelope['projects'] as List<dynamic>)
          .map(
            (project) => WarehouseProject.fromJson(
              Map<String, dynamic>.from(project as Map),
            ),
          )
          .toList();
    } catch (error) {
      throw FormatException(
        'Saved projects could not be read. Your stored data has not been overwritten. '
        'A previous save may be available under $backupKey. ($error)',
      );
    }
  }

  Future<void> save(List<WarehouseProject> projects) async {
    // Encode first so an invalid object cannot replace the last valid save.
    final encoded = jsonEncode({
      'version': 1,
      'projects': projects.map((project) => project.toJson()).toList(),
    });
    final preferences = await SharedPreferences.getInstance();
    final previous = preferences.getString(storageKey);
    if (previous != null && !await preferences.setString(backupKey, previous)) {
      throw StateError('The project backup could not be saved on this device.');
    }
    if (!await preferences.setString(storageKey, encoded)) {
      throw StateError('Projects could not be saved on this device.');
    }
  }
}

class ImportResult {
  const ImportResult({
    required this.parts,
    required this.warnings,
    required this.rawInputRows,
  });

  final List<PartInput> parts;
  final List<String> warnings;
  final List<List<Object?>> rawInputRows;
}

class WorkbookService {
  static const headers = [
    'Part Number',
    'QTY in Box',
    'QTY boxes per Pallet',
    'Consumption per shift',
    'DOH (Days on hand)',
    'L(mm)',
    'W(mm)',
    'H(mm)',
  ];
  static const _fields = [
    'partNumber',
    'qtyBox',
    'qtyOnPallet',
    'consumptionPerShift',
    'doh',
    'length',
    'width',
    'height',
  ];
  static const _monthlyHeaders = [
    'Part Number',
    'Stock Quantity',
    'Parts per Pallet',
    'Monthly Consumption',
    'Input Coverage (days)',
    'L (mm)',
    'W (mm)',
    'H (mm)',
  ];
  static const _monthlyFields = [
    'partNumber',
    'stockQty',
    'partsPerPallet',
    'monthlyConsumption',
    'providedCoverageDays',
    'length',
    'width',
    'height',
  ];
  static const _legacyHeaders = [
    'Part Number',
    'QTY Box',
    'QTY Pallet',
    'QTY on Pallet',
    'Consumption',
    'DOH',
    'L (mm)',
    'W (mm)',
    'H (mm)',
  ];
  static const _legacyFields = [
    'partNumber',
    'qtyBox',
    'qtyPallet',
    'qtyOnPallet',
    'consumption',
    'doh',
    'length',
    'width',
    'height',
  ];
  static const _aliases = <String, List<String>>{
    'partNumber': ['Part Number', 'Part No', 'PartNo', 'PN'],
    'stockQty': [
      'Stock Quantity',
      'Current Stock',
      'Total Stock',
      'Stock Qty',
      'Current Stock Quantity',
    ],
    'partsPerPallet': [
      'Parts per Pallet',
      'QTY per Pallet',
      'Quantity per Pallet',
      'Pallet Capacity',
    ],
    'monthlyConsumption': [
      'Monthly Consumption',
      'Consumption per Month',
      'Consumption Monthly',
    ],
    'providedCoverageDays': [
      'Input Coverage (days)',
      'Input Coverage',
      'DOH',
      'Stock Coverage (days)',
      'Stock Coverage',
      'Coverage Days',
    ],
    'length': ['L(mm)', 'L (mm)', 'Pallet Length (mm)', 'Length (mm)'],
    'width': ['W(mm)', 'W (mm)', 'Pallet Width (mm)', 'Width (mm)'],
    'height': ['H(mm)', 'H (mm)', 'Pallet Height (mm)', 'Height (mm)'],
    'stacking': ['Stacking', 'Allowed Stacking', 'Maximum Stacking'],
    'qtyBox': ['QTY in Box', 'QTY Box', 'Parts per Box'],
    'qtyPallet': ['QTY Pallet'],
    'qtyOnPallet': [
      'QTY boxes per Pallet',
      'QTY on Pallet',
      'Boxes per Pallet',
    ],
    'consumptionPerShift': [
      'Consumption per shift',
      'Shift Consumption',
      'Consumption per Shift (parts)',
    ],
    'consumption': ['Consumption', 'Daily Consumption'],
    'doh': ['DOH (Days on hand)', 'DOH', 'Days on hand'],
  };
  static const _planningHeaders = [
    'Parts per Box',
    'Boxes per Pallet',
    'Parts per Pallet',
    'Consumption per Shift (parts)',
    'Raw Pallets per Shift',
    'Rounded Pallets per Shift',
    'Shifts per Day',
    'Selected DOH (days)',
    'Planned Pallets per Day',
    'Required Pallets (nested rounding)',
    'Daily Consumption (parts/day)',
    'Current Stock (parts, optional)',
    'Current Pallet Equivalents (optional)',
    'Current Pallet Positions (optional)',
    'Actual Coverage (days, optional)',
    'Input DOH (days)',
    'Coverage Difference (days, optional)',
    'Packaging Inferred',
    'Required Pallets Formula',
  ];
  static const _sourceMarker = 'LOGEN ORIGINAL SOURCE DATA — REFERENCE ONLY';
  Uint8List templateBytes() {
    final workbook = Excel.createExcel();
    workbook.rename('Sheet1', 'Input Data');
    final sheet = workbook['Input Data'];
    _append(sheet, headers, header: true);
    _append(sheet, ['SAMPLE-001', 20, 40, 500, 5, 1200, 800, 1000]);
    _widths(sheet, headers.length);
    final instructions = workbook['Instructions'];
    _append(instructions, [
      'LogEn — offline warehouse comparison',
    ], header: true);
    for (final line in [
      'Keep exactly the eight template headings. Replace or delete SAMPLE-001 before adding your inventory.',
      'QTY in Box = individual parts in a box. QTY boxes per Pallet = boxes on one pallet.',
      'Consumption per shift = individual parts consumed in one shift. It is neither daily nor monthly consumption.',
      'DOH (Days on hand) = required coverage days for the part. Input DOH can be overridden by a custom project DOH.',
      'Required pallets = CEILING(CEILING(Consumption per shift / QTY in Box / QTY boxes per Pallet) × selected DOH × shifts per day).',
      'The inner CEILING rounds the pallet quantity for one shift up first. Do not replace it with one rounding of fractional daily demand.',
      'Shifts per day must be 1, 2 or 3; default 2. The project DOH override defaults to 5 days.',
      'L(mm), W(mm) and H(mm) are loaded pallet dimensions in millimeters.',
      'Floor stacking defaults to 1 because the template has no Stacking column. An optional extra Stacking column is supported and stacking can be edited manually.',
      'Current stock is optional. Without it, actual stock coverage is unavailable; unknown stock is never treated as zero.',
      'Older monthly and daily templates remain supported. Their rates are converted once to consumption per shift using production settings selected at import.',
      'Legacy direct pallet capacity without box quantities uses inferred packaging: one box containing that pallet capacity. Review inferred box quantities before relying on per-shift rounding.',
      'Use numeric cells or decimal-point text. Formula cells are not evaluated; paste values before importing.',
      'Each part has dedicated floor rows and rack bays. Both scenarios use the same required pallets. Gangway values allocate half (50%) of the configured width as planning estimates.',
      'All imports, calculations, project storage and exports run locally and work offline.',
    ]) {
      _append(instructions, [line]);
    }
    instructions.setColumnWidth(0, 110);
    return _encode(workbook);
  }

  ImportResult importBytes(
    Uint8List bytes, [
    WarehouseSettings settings = const WarehouseSettings(),
  ]) {
    late final Excel workbook;
    try {
      workbook = Excel.decodeBytes(bytes);
    } catch (_) {
      throw const FormatException(
        'This file could not be read as an Excel .xlsx workbook. Save it as .xlsx and try again.',
      );
    }
    Sheet? input;
    var headerIndex = -1;
    var kind = 'shift';
    Map<String, int> columns = {};
    final schemaFields = {
      'shift': _fields,
      'monthly': _monthlyFields,
      'daily': _legacyFields,
    };
    final schemaLabels = {
      'shift': headers,
      'monthly': _monthlyHeaders,
      'daily': _legacyHeaders,
    };
    for (final sheet in workbook.tables.values) {
      for (
        var rowIndex = 0;
        rowIndex < sheet.rows.length && rowIndex < 30;
        rowIndex++
      ) {
        final candidate = <String, List<int>>{};
        final row = sheet.rows[rowIndex];
        for (var column = 0; column < row.length; column++) {
          final key = _normalize(_raw(row[column]?.value)?.toString() ?? '');
          (candidate[key] ??= []).add(column);
        }
        for (final schema in schemaFields.entries) {
          final fields = schema.value, labels = schemaLabels[schema.key]!;
          final mapping = <String, int>{};
          final duplicates = <String>[];
          for (var index = 0; index < fields.length; index++) {
            final matches = _aliases[fields[index]]!
                .expand((alias) => candidate[_normalize(alias)] ?? <int>[])
                .toSet();
            if (matches.length > 1) duplicates.add(labels[index]);
            if (matches.isNotEmpty) mapping[fields[index]] = matches.first;
          }
          if (mapping.length != fields.length) continue;
          for (final field in ['stacking', 'stockQty']) {
            if (mapping.containsKey(field)) continue;
            final matches = _aliases[field]!
                .expand((alias) => candidate[_normalize(alias)] ?? <int>[])
                .toSet();
            if (matches.length > 1) duplicates.add(field);
            if (matches.isNotEmpty) mapping[field] = matches.first;
          }
          if (duplicates.isNotEmpty) {
            throw FormatException(
              'Ambiguous duplicate column headings: ${duplicates.join(', ')}. Keep one column for each heading.',
            );
          }
          input = sheet;
          headerIndex = rowIndex;
          columns = mapping;
          kind = schema.key;
          break;
        }
        if (input != null) break;
      }
      if (input != null) break;
    }
    if (input == null) {
      throw FormatException(
        'No input worksheet has the eight required headings: ${headers.join(', ')}. Download the current LogEn template. Older monthly and daily templates are also supported.',
      );
    }
    final rawRows = input.rows
        .map((row) => row.map((cell) => _raw(cell?.value)).toList())
        .toList();
    final marker = rawRows.indexWhere(
      (row) =>
          row.isNotEmpty &&
          row.first == _sourceMarker &&
          row.skip(1).every((value) => value == null || value == ''),
    );
    final inputEnd = marker >= 0 ? marker : rawRows.length;
    final parts = <PartInput>[], sourceRows = <int>[];
    final warnings = <String>[];
    if (kind != 'shift' && ![1, 2, 3].contains(settings.shiftsPerDay)) {
      throw const FormatException(
        'Legacy conversion requires 1, 2 or 3 shifts per day.',
      );
    }
    if (kind == 'monthly' && settings.workingDaysPerMonth < 1) {
      throw const FormatException(
        'Legacy monthly conversion requires a positive working-days-per-month setting.',
      );
    }
    if (kind == 'daily') {
      warnings.add(
        'Legacy daily template converted once: Consumption is DAILY and was divided by ${settings.shiftsPerDay} shifts per day to obtain consumption per shift. Existing box quantities are retained, and old entered pallets provide optional current stock.',
      );
    }
    if (kind == 'monthly') {
      warnings.add(
        'Legacy monthly template converted once: Monthly Consumption was divided by ${settings.workingDaysPerMonth} working days per month and ${settings.shiftsPerDay} shifts per day. Direct pallet capacity requires inferred packaging; review box quantities before relying on per-shift rounding.',
      );
    }
    for (var rowIndex = headerIndex + 1; rowIndex < inputEnd; rowIndex++) {
      final row = rawRows[rowIndex];
      if (row.every(
        (value) => value == null || value.toString().trim().isEmpty,
      )) {
        continue;
      }
      final errors = <String>[];
      Object? value(String field) {
        final index = columns[field];
        return index != null && index < row.length ? row[index] : null;
      }

      double? number(
        String field,
        String label, {
        bool optional = false,
        double? fallback,
      }) {
        final raw = value(field);
        if (raw == null || raw.toString().trim().isEmpty) {
          if (!optional) {
            errors.add(
              'Excel row ${rowIndex + 1}: $label is required. Enter 0 explicitly when the value is zero.',
            );
          }
          return optional ? fallback : 0;
        }
        final parsed = raw is num
            ? raw.toDouble()
            : double.tryParse(raw.toString().trim());
        if (parsed == null || !parsed.isFinite) {
          errors.add(
            'Excel row ${rowIndex + 1}: $label must be a finite number (Excel formulas are not evaluated).',
          );
          return 0;
        }
        return parsed;
      }

      final fields = schemaFields[kind]!, labels = schemaLabels[kind]!;
      final values = <String, double?>{};
      for (var index = 1; index < fields.length; index++) {
        final field = fields[index];
        values[field] = number(
          field,
          labels[index],
          optional: field == 'stockQty' || field == 'qtyPallet',
        );
      }
      final stockQty = kind == 'daily'
          ? values['qtyPallet'] == null
                ? null
                : values['qtyPallet']! *
                      values['qtyBox']! *
                      values['qtyOnPallet']!
          : kind == 'monthly'
          ? values['stockQty']
          : number('stockQty', 'Current stock quantity', optional: true);
      final part = PartInput(
        partNumber: value('partNumber')?.toString().trim() ?? '',
        qtyBox: values['qtyBox'] ?? 0,
        qtyPallet: values['qtyPallet'],
        qtyOnPallet: values['qtyOnPallet'] ?? 0,
        consumptionPerShift: values['consumptionPerShift'],
        consumption: values['consumption'],
        doh: values['doh'] ?? values['providedCoverageDays'] ?? 0,
        stockQty: stockQty,
        partsPerPallet: values['partsPerPallet'],
        monthlyConsumption: values['monthlyConsumption'],
        providedCoverageDays: values['providedCoverageDays'],
        length: values['length']!,
        width: values['width']!,
        height: values['height']!,
        stacking: number('stacking', 'Stacking', optional: true, fallback: 1)!,
        inputErrors: errors,
      );
      parts.add(normalizePart(part, settings));
      sourceRows.add(rowIndex + 1);
    }
    final occurrences = <String, List<int>>{};
    for (var index = 0; index < parts.length; index++) {
      final key = parts[index].partNumber.toUpperCase();
      if (key.isNotEmpty) (occurrences[key] ??= []).add(index);
    }
    for (final duplicate in occurrences.values.where(
      (indices) => indices.length > 1,
    )) {
      warnings.add(
        'Duplicate part number on Excel rows ${duplicate.map((index) => sourceRows[index]).join(', ')}. Use one row per part number.',
      );
    }
    final inferred = parts.where((part) => part.packagingInferred).length;
    if (inferred > 0) {
      warnings.add(
        '$inferred part numbers use inferred packaging: QTY in Box = legacy pallet capacity and QTY boxes per Pallet = 1. Review actual box quantities.',
      );
    }
    if (parts.isEmpty) warnings.add('The input worksheet has no part data.');
    if (workbook.tables.length > 1) {
      warnings.add(
        'Imported worksheet ${input.sheetName}. Other worksheets were not imported.',
      );
    }
    if (parts.any((part) => part.inputErrors.isNotEmpty)) {
      warnings.add(
        'Some input rows contain errors. They remain visible and are excluded from comparison totals until corrected.',
      );
    }
    return ImportResult(
      parts: parts,
      warnings: warnings,
      rawInputRows: marker >= 0 ? rawRows.sublist(marker + 1) : rawRows,
    );
  }

  Uint8List exportBytes(
    WarehouseProject project,
    ProjectCalculation calculation,
  ) {
    final workbook = Excel.createExcel();
    workbook.rename('Sheet1', 'Original Input Data');
    final settingsValue = project.settings;
    final parts = project.parts
        .map((p) => normalizePart(p, settingsValue))
        .toList();
    final includeStacking = parts.any((p) => p.stacking != 1);
    final includeStock = parts.any((p) => p.stockQty != null);
    final original = workbook['Original Input Data'];
    _append(original, [
      ...headers,
      if (includeStacking) 'Stacking',
      if (includeStock) 'Current Stock',
    ], header: true);
    for (final part in parts) {
      _append(original, [
        ..._inputValues(part),
        if (includeStacking) part.stacking,
        if (includeStock) part.stockQty,
      ]);
    }
    final sourceRows = project.rawInputRows;
    if (sourceRows != null && sourceRows.isNotEmpty) {
      _append(original, []);
      _append(original, [_sourceMarker], header: true);
      for (var index = 0; index < sourceRows.length; index++) {
        _append(original, sourceRows[index], header: index == 0);
      }
    }
    _widths(original, original.maxColumns);

    final floor = workbook['Floor Pallet Calculations'];
    final floorHeaders = [
      ...headers,
      'Allowed Floor Stacking',
      'Status',
      'Validation Errors',
      'Required Parts',
      'Required Pallets',
      'Maximum Stacking by Height',
      'Effective Floor Stacking',
      'Floor Positions',
      'Pallets Per Row',
      'Required Floor Rows',
      'Row Width (m)',
      'Deepest Actual Occupied Row Depth (m)',
      'Without Gangways (m²)',
      'Allocated Gangway Area (m²)',
      'With Allocated Gangways (m²)',
      'Full Row Actual Depth (m)',
      'Last Row Actual Depth (m)',
      'Last Row Pallets',
      'Total Occupied Row Depth (m)',
      ..._planningHeaders,
    ];
    _append(floor, floorHeaders, header: true);
    for (final result in calculation.results) {
      final f = result.floor;
      _append(floor, [
        ..._inputValues(result.input),
        result.input.stacking,
        result.isValid ? 'Valid' : 'Invalid — excluded from totals',
        result.errors.join(' | '),
        result.requiredParts,
        result.requiredPallets,
        f?.maximumStacking,
        f?.effectiveStacking,
        f?.positions,
        f?.palletsPerRow,
        f?.rows,
        f?.rowWidth,
        f?.rowDepth,
        f?.withoutGangways,
        f?.gangwayArea,
        f?.withGangways,
        f?.fullRowDepth,
        f?.lastRowDepth,
        f?.lastRowPallets,
        f?.totalOccupiedDepth,
        ..._planningValues(result.planning, result.input, settingsValue),
      ]);
    }
    _widths(floor, floorHeaders.length);
    final rack = workbook['Rack Calculations'];
    final rackHeaders = [
      'Part Number',
      'Status',
      'Validation Errors',
      'Required Pallets',
      'Pallet L (mm)',
      'Pallet W (mm)',
      'Loaded H (mm)',
      'Rotated 90 Degrees',
      'Pallets Per Slot',
      'Rack Levels',
      'Capacity Per Bay',
      'Required Rack Bays',
      'Effective Bay Length (mm)',
      'Effective Bay Depth (mm)',
      'Effective Bay Height (mm)',
      'Maximum Bays Per Run',
      'Required Rack Runs',
      'Bays Per Run',
      'Actual Run Lengths (m)',
      'Total Run Frontage (m)',
      'Without Gangways (m²)',
      'Allocated Gangway Area (m²)',
      'With Allocated Gangways (m²)',
      ..._planningHeaders,
    ];
    _append(rack, rackHeaders, header: true);
    for (final result in calculation.results) {
      final r = result.rack;
      final bayLength = r?.effectiveBayLength ?? 0;
      _append(rack, [
        result.input.partNumber,
        result.isValid ? 'Valid' : 'Invalid — excluded from totals',
        result.errors.join(' | '),
        result.requiredPallets,
        result.input.length,
        result.input.width,
        result.input.height,
        r?.rotated,
        r?.palletsPerSlot,
        r?.levels,
        r?.capacityPerBay,
        r?.bays,
        r?.effectiveBayLength,
        r?.effectiveBayDepth,
        r?.effectiveBayHeight,
        r?.maxBaysPerRun,
        r?.runs,
        r?.baysPerRun.join(', '),
        r?.baysPerRun
            .map((bays) => (bays * bayLength / 1000).toStringAsFixed(3))
            .join(', '),
        r == null ? null : r.bays * r.effectiveBayLength / 1000,
        r?.withoutGangways,
        r?.gangwayArea,
        r?.withGangways,
        ..._planningValues(result.planning, result.input, settingsValue),
      ]);
    }
    _widths(rack, rackHeaders.length);

    final comparison = workbook['Warehouse Comparison'];
    final available = calculation.settingsErrors.isEmpty;
    _append(comparison, [
      'LogEn — ${project.name}',
      'Footprint (m²)',
    ], header: true);
    for (final row in <List<Object?>>[
      ['Pallets without gangways (m²)', calculation.floorWithoutGangways],
      ['Pallets with allocated gangways (m²)', calculation.floorWithGangways],
      ['Racks without gangways (m²)', calculation.rackWithoutGangways],
      ['Racks with allocated gangways (m²)', calculation.rackWithGangways],
    ]) {
      _append(comparison, [
        row[0],
        available ? row[1] : 'Unavailable — invalid settings',
      ], emphasis: true);
    }
    _append(comparison, []);
    for (final row in <List<Object?>>[
      [
        'Totals status',
        !available
            ? 'INVALID SETTINGS — totals unavailable'
            : calculation.invalidCount > 0
            ? 'PARTIAL TOTALS — ${calculation.invalidCount} invalid part rows excluded'
            : 'Complete — all imported part rows are valid',
      ],
      ['Settings validation', calculation.settingsErrors.join(' | ')],
      ['Total imported part rows', project.parts.length],
      ['Valid part rows included in totals', calculation.validCount],
      ['Invalid part rows', calculation.invalidCount],
      ['Total required pallets (valid rows)', calculation.totalRequiredPallets],
      ['Total floor positions', calculation.totalFloorPositions],
      ['Total floor rows', calculation.totalFloorRows],
      ['Total rack bays', calculation.totalRackBays],
      ['Total rack runs', calculation.totalRackRuns],
      ['Floor allocated gangway area (m²)', calculation.floorGangwayArea],
      ['Rack allocated gangway area (m²)', calculation.rackGangwayArea],
      ['Space saving without gangways (m²)', calculation.savingWithoutGangways],
      [
        'Space saving without gangways (%)',
        calculation.savingWithoutGangwaysPercent ??
            'N/A — floor footprint is zero',
      ],
      [
        'Space saving with allocated gangways (m²)',
        calculation.savingWithGangways,
      ],
      [
        'Space saving with allocated gangways (%)',
        calculation.savingWithGangwaysPercent ??
            'N/A — floor footprint is zero',
      ],
    ]) {
      if (!available &&
          RegExp(
            r'^(Total (required|floor|rack)|Floor allocated|Rack allocated|Space saving)',
          ).hasMatch(row[0].toString())) {
        row[1] = 'Unavailable — invalid settings';
      }
      _append(comparison, row);
    }
    _append(comparison, []);
    for (final line in [
      'Both storage scenarios use the same required pallets, with dedicated floor rows and rack bays per part.',
      'Gangway-inclusive values allocate half (50%) of the configured gangway width, not an optimized physical warehouse design. Count shared gangways once in an actual layout.',
      'Floor gangway = rows × row width (m) × (configured gangway width (mm) / 2 / 1000).',
      'Rack gangway = sum of actual run frontages (m) × (configured gangway width (mm) / 2 / 1000).',
      'Invalid parts remain visible in calculations and are excluded from partial totals.',
      'Negative savings mean racks require more ground area. Numeric footprints retain precision and display two decimals.',
    ]) {
      _append(comparison, [line]);
    }
    _append(comparison, []);
    _append(comparison, ['Part shift rounding and DOH planning'], header: true);
    _append(comparison, [
      'Part Number',
      'Status',
      'Validation Errors',
      ..._planningHeaders,
    ], header: true);
    for (final result in calculation.results) {
      _append(comparison, [
        result.input.partNumber,
        result.isValid ? 'Valid' : 'Invalid',
        result.errors.join(' | '),
        ..._planningValues(result.planning, result.input, settingsValue),
      ]);
    }
    _append(comparison, [
      'Required-pallet formula',
      'CEILING(CEILING(consumption per shift / parts per box / boxes per pallet) × selected DOH × shifts per day). Round one shift first; only a fractional final DOH total needs the outer ceiling.',
    ]);
    _append(comparison, [
      'Optional stock interpretation',
      'The eight-column template has no current stock quantity. Unknown stock and actual stock coverage remain unavailable, never zero.',
    ]);
    comparison.setColumnWidth(0, 105);
    comparison.setColumnWidth(1, 75);

    final settings = workbook['Warehouse Settings'];
    final s = settingsValue;
    _append(settings, ['Setting', 'Value', 'Unit / Description'], header: true);
    for (final row in <List<Object?>>[
      ['Project', project.name],
      ['Source workbook', project.sourceName ?? 'Manual entry'],
      ['Exported at (UTC)', DateTime.now().toUtc().toIso8601String()],
      [
        'Stock formula',
        'Nested per-shift pallet rounding',
        'Always used for both floor and rack scenarios',
      ],
      ['Shifts per day', s.shiftsPerDay, 'integer: 1, 2 or 3'],
      [
        'DOH mode',
        s.coverageMode,
        'input = each part DOH; custom = project DOH override',
      ],
      [
        'Project DOH override',
        s.customCoverageDays,
        'days; applied when DOH mode is custom',
      ],
      [
        'Legacy import working days per month',
        s.workingDaysPerMonth,
        'only needed to migrate old monthly data; explicit consumption per shift stays fixed',
      ],
      [
        'Packaging warnings',
        calculation.results
            .where((r) => r.input.packagingInferred)
            .map((r) => r.input.partNumber)
            .join(', '),
        'Inferred packaging should be checked against actual boxes per pallet',
      ],
      ['Maximum floor stacking height', s.maxFloorStackingHeight, 'mm'],
      [
        'Maximum floor row depth LIMIT',
        s.maxFloorRowDepth,
        'mm; 0 = unlimited. Footprint uses actual occupied depth.',
      ],
      ['Gangway width', s.gangwayWidth, 'mm; full configured width'],
      [
        'Gangway allocation factor',
        0.5,
        '50% for both floor and rack footprints',
      ],
      [
        'Allocated gangway width (50%)',
        s.allocatedGangwayWidth,
        'mm; configured gangway width / 2',
      ],
      ['Floor pallet clearance', s.floorPalletClearance, 'mm'],
      ['Rack levels', s.rackLevels, 'levels'],
      ['Rack usable slot length', s.rackSlotLength, 'mm'],
      ['Rack usable slot depth', s.rackSlotDepth, 'mm'],
      ['Rack usable slot height', s.rackSlotHeight, 'mm'],
      ['Rack structural length allowance', s.rackStructuralLength, 'mm'],
      ['Rack structural depth allowance', s.rackStructuralDepth, 'mm'],
      ['Rack structural height allowance', s.rackStructuralHeight, 'mm'],
      ['Maximum rack run length', s.maxRackRunLength, 'mm'],
      [
        'Rack frontage clearance',
        s.rackFrontageClearance,
        'mm; before, between and after pallets',
      ],
      ['Rack depth clearance', s.rackDepthClearance, 'mm total'],
      ['Rack vertical clearance', s.rackVerticalClearance, 'mm'],
      [
        'Allow pallet rotation',
        s.allowRotation,
        '90 degrees; highest valid capacity wins',
      ],
    ]) {
      _append(settings, row);
    }
    _append(settings, []);
    for (final line in [
      'Parts per pallet = QTY in Box × QTY boxes per Pallet. Raw pallets per shift = Consumption per shift / QTY in Box / QTY boxes per Pallet.',
      'Rounded pallets per shift = CEILING(raw pallets per shift). Required pallets = CEILING(rounded pallets per shift × selected DOH × shifts per day). The inner ceiling is mandatory.',
      'Daily consumption = Consumption per shift × shifts per day. Planned pallets per day = Rounded pallets per shift × shifts per day. Shifts must be 1, 2 or 3.',
      'The template has exactly eight columns. Floor stacking defaults to 1 unless an optional Stacking column or manual value is supplied.',
      'Floor positions = CEILING(required pallets / MIN(allowed stacking, FLOOR(maximum stacking height / loaded pallet H))).',
      'Pallets per row = FLOOR((maximum row-depth LIMIT + clearance) / (pallet L + clearance)); limit 0 means one unrestricted row per part.',
      'Floor storage area = row width × total actual occupied row depth, including clearances between pallets. Unused row depth is not reserved.',
      'Rack pallets per slot = FLOOR((slot length - frontage clearance) / (pallet frontage + frontage clearance)); pallet depth and height must fit separate clearances.',
      'Capacity per bay = pallets per slot × rack levels. Rack footprint = required bays × effective bay length × effective bay depth / 1000000; levels never multiply ground area.',
      'Allocated gangway width = configured gangway width / 2. Floor gangway area = rows × row width × allocated width / 1000; rack gangway area = actual run frontage × allocated width / 1000. These are allocated estimates, not optimized layouts.',
    ]) {
      _append(settings, [line]);
    }
    settings.setColumnWidth(0, 115);
    settings.setColumnWidth(1, 35);
    settings.setColumnWidth(2, 65);
    workbook.setDefaultSheet('Original Input Data');
    return _encode(workbook);
  }

  static String _normalize(String value) =>
      value.trim().toLowerCase().replaceAll(RegExp(r'[^a-z0-9]'), '');

  static Object? _raw(CellValue? value) => switch (value) {
    null => null,
    TextCellValue() => value.toString(),
    IntCellValue() => value.value,
    DoubleCellValue() =>
      value.value.isFinite ? value.value : value.value.toString(),
    BoolCellValue() => value.value,
    FormulaCellValue() => '=${value.formula}',
    _ => value.toString(),
  };

  static List<Object?> _inputValues(PartInput part) => [
    part.partNumber,
    part.qtyBox,
    part.qtyOnPallet,
    part.consumptionPerShift,
    part.doh,
    part.length,
    part.width,
    part.height,
  ];
  static List<Object?> _planningValues(
    PlanningCalculation? p,
    PartInput input,
    WarehouseSettings settings,
  ) => p == null
      ? List<Object?>.filled(_planningHeaders.length, null)
      : [
          p.qtyBox,
          p.qtyOnPallet,
          p.partsPerPallet,
          p.consumptionPerShift,
          p.palletsPerShift,
          p.roundedPalletsPerShift,
          settings.shiftsPerDay,
          p.targetCoverageDays,
          p.plannedPalletsPerDay,
          p.requiredPallets,
          p.dailyConsumption,
          p.stockQty ?? 'Not provided',
          p.currentPallets ?? 'N/A — stock not provided',
          p.currentPalletPositions ?? 'N/A — stock not provided',
          p.actualCoverageDays ??
              (p.noConsumption ? 'No consumption' : 'N/A — stock not provided'),
          input.doh,
          p.coverageDifferenceDays ?? 'N/A',
          input.packagingInferred,
          'CEILING(CEILING(${input.consumptionPerShift} / ${input.qtyBox} / ${input.qtyOnPallet}) × ${p.targetCoverageDays} × ${settings.shiftsPerDay}) = ${p.requiredPallets}',
        ];

  static Uint8List _encode(Excel workbook) {
    final bytes = workbook.encode();
    if (bytes == null) {
      throw StateError('The Excel workbook could not be generated.');
    }
    return Uint8List.fromList(bytes);
  }

  static void _widths(Sheet sheet, int columns) {
    for (var index = 0; index < columns; index++) {
      sheet.setColumnWidth(index, index == 0 ? 26 : 24);
    }
  }

  static void _append(
    Sheet sheet,
    List<Object?> values, {
    bool header = false,
    bool emphasis = false,
  }) {
    final row = sheet.maxRows;
    if (values.isEmpty) {
      sheet
          .cell(CellIndex.indexByColumnRow(columnIndex: 0, rowIndex: row))
          .value = TextCellValue(
        '',
      );
      return;
    }
    sheet.appendRow(
      values.map<CellValue?>((value) {
        if (value == null) return null;
        if (value is int) return IntCellValue(value);
        if (value is double && value.isFinite) return DoubleCellValue(value);
        if (value is bool) return BoolCellValue(value);
        // Input text is always text, including strings beginning with '='.
        return TextCellValue(value.toString());
      }).toList(),
    );
    for (var column = 0; column < values.length; column++) {
      final cell = sheet.cell(
        CellIndex.indexByColumnRow(columnIndex: column, rowIndex: row),
      );
      cell.cellStyle = CellStyle(
        bold: header || emphasis,
        fontSize: header
            ? 12
            : emphasis
            ? 14
            : 11,
        backgroundColorHex: header
            ? ExcelColor.black
            : emphasis
            ? ExcelColor.amber
            : ExcelColor.none,
        fontColorHex: header ? ExcelColor.amber : ExcelColor.black,
        verticalAlign: VerticalAlign.Center,
        textWrapping: TextWrapping.WrapText,
        numberFormat: values[column] is double
            ? CustomNumericNumFormat(formatCode: '#,##0.00')
            : NumFormat.standard_0,
      );
    }
  }
}
