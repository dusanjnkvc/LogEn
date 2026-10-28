import 'dart:typed_data';
import 'package:excel/excel.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:logen/domain.dart';
import 'package:logen/services.dart';

const headings = [
  'Part Number',
  'QTY in Box',
  'QTY boxes per Pallet',
  'Consumption per shift',
  'DOH (Days on hand)',
  'L(mm)',
  'W(mm)',
  'H(mm)',
];
List<Object?> row([String id = 'SAMPLE-001']) => [
  id,
  20,
  40,
  500,
  5,
  1200,
  800,
  1000,
];
CellValue? cellValue(Object? value) => switch (value) {
  null => null,
  CellValue() => value,
  int() => IntCellValue(value),
  double() => DoubleCellValue(value),
  bool() => BoolCellValue(value),
  _ => TextCellValue(value.toString()),
};
Uint8List source(List<List<Object?>> rows) {
  final b = Excel.createExcel();
  for (final r in rows) {
    b['Sheet1'].appendRow(r.map(cellValue).toList());
  }
  return Uint8List.fromList(b.encode()!);
}

String? value(Sheet sheet, String label, {int row = 1}) {
  final col = sheet.rows.first.indexWhere((c) => c?.value.toString() == label);
  expect(col, greaterThanOrEqualTo(0), reason: 'Missing $label');
  return sheet.rows[row][col]?.value.toString();
}

double numeric(Sheet sheet, String label, {int row = 1}) =>
    double.parse(value(sheet, label, row: row)!);
WarehouseProject project(
  List<PartInput> parts, {
  WarehouseSettings settings = const WarehouseSettings(),
  List<List<Object?>>? raw,
}) => WarehouseProject(
  id: 'a',
  name: 'Warehouse',
  parts: parts,
  settings: settings,
  rawInputRows: raw,
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final service = WorkbookService();
  Excel output(WarehouseProject p) => Excel.decodeBytes(
    service.exportBytes(p, calculateProject(p.parts, p.settings)),
  );
  test(
    'template has exactly eight shift headers and sample uses whole-shift rounding',
    () {
      expect(WorkbookService.headers, headings);
      final bytes = service.templateBytes(), b = Excel.decodeBytes(bytes);
      expect(
        b['Input Data'].rows.first.map((c) => c?.value.toString()).toList(),
        headings,
      );
      final input = service.importBytes(bytes),
          p = input.parts.single,
          c = calculateProject(input.parts, const WarehouseSettings());
      expect(p.qtyBox, 20);
      expect(p.qtyOnPallet, 40);
      expect(p.consumptionPerShift, 500);
      expect(p.doh, 5);
      expect(p.stacking, 1);
      expect(p.stockQty, isNull);
      expect(c.invalidCount, 0);
      expect(c.totalRequiredPallets, 10);
      expect(c.floorWithoutGangways, closeTo(11.34, 1e-9));
      expect(c.floorWithGangways, closeTo(27.54, 1e-9));
      expect(c.rackWithoutGangways, closeTo(7.98, 1e-9));
      expect(c.rackWithGangways, closeTo(33.63, 1e-9));
    },
  );
  test(
    'export preserves the nested rounding formula and all five worksheets',
    () {
      final r = row();
      r[3] = 1000;
      final input = service.importBytes(source([headings, r])),
          p = project(input.parts, raw: input.rawInputRows),
          b = output(p);
      expect(calculateProject(p.parts, p.settings).totalRequiredPallets, 20);
      expect(b.tables.keys.toList(), [
        'Original Input Data',
        'Floor Pallet Calculations',
        'Rack Calculations',
        'Warehouse Comparison',
        'Warehouse Settings',
      ]);
      final f = b['Floor Pallet Calculations'];
      expect(numeric(f, 'Raw Pallets per Shift'), 1.25);
      expect(numeric(f, 'Rounded Pallets per Shift'), 2);
      expect(numeric(f, 'Required Pallets (nested rounding)'), 20);
      expect(
        value(f, 'Required Pallets Formula'),
        contains('CEILING(CEILING(1000.0 / 20.0 / 40.0)'),
      );
    },
  );
  test('selected1–3 shifts and DOH override appear in result exports', () {
    final input = service.importBytes(service.templateBytes());
    for (final shifts in [1, 2, 3]) {
      final s = WarehouseSettings(
            shiftsPerDay: shifts,
            coverageMode: 'custom',
            customCoverageDays: 7,
          ),
          p = project(input.parts, settings: s),
          c = calculateProject(p.parts, s),
          f = output(p)['Floor Pallet Calculations'];
      expect(c.totalRequiredPallets, 7 * shifts);
      expect(numeric(f, 'Shifts per Day'), shifts);
      expect(numeric(f, 'Selected DOH (days)'), 7);
    }
    final bad = calculateProject(
      input.parts,
      const WarehouseSettings(shiftsPerDay: 4),
    );
    expect(bad.settingsErrors, isNotEmpty);
    expect(
      calculateProject(
        input.parts,
        const WarehouseSettings(
          shiftsPerDay: 3,
          coverageMode: 'custom',
          customCoverageDays: .25,
        ),
      ).totalRequiredPallets,
      1,
    );
  });
  test(
    'aliases, reversed columns, heading case and blank leading rows work',
    () {
      final imported = service.importBytes(
        source([
          [],
          headings.reversed.map((s) => ' ${s.toUpperCase()} ').toList(),
          row().reversed.toList(),
        ]),
      );
      expect(imported.parts.single.length, 1200);
      expect(imported.parts.single.consumptionPerShift, 500);
      final aliases = [
        'PN',
        'Parts per Box',
        'Boxes per Pallet',
        'Shift Consumption',
        'Days on hand',
        'Length (mm)',
        'Width (mm)',
        'Height (mm)',
      ];
      expect(
        service.importBytes(source([aliases, row()])).parts.single.qtyOnPallet,
        40,
      );
    },
  );
  test(
    'optional stacking and known stock roundtrip without adding template columns',
    () {
      final input = service.importBytes(
        source([
          [...headings, 'Stacking', 'Current Stock'],
          [...row(), 3, 5600],
        ]),
      );
      final bytes = service.exportBytes(
            project(input.parts),
            calculateProject(input.parts, const WarehouseSettings()),
          ),
          again = service.importBytes(bytes);
      expect(again.parts, hasLength(1));
      expect(again.parts.single.stacking, 3);
      expect(again.parts.single.stockQty, 5600);
      expect(WorkbookService.headers, headings);
    },
  );
  test(
    'daily legacy imports convert once and keep raw originals below canonical inputs',
    () {
      const h = [
        'Part Number',
        'QTY Box',
        'QTY Pallet',
        'QTY on Pallet',
        'Consumption',
        'DOH',
        'L (mm)',
        'W (mm)',
        'H (mm)',
        'Stacking',
      ];
      final r = ['OLD', 20, 7, 40, 1000, 5, 1200, 800, 1000, 3],
          input = service.importBytes(source([h, r]));
      expect(input.parts.single.consumptionPerShift, 500);
      expect(input.parts.single.stockQty, 5600);
      expect(input.warnings.join(), contains('DAILY'));
      expect(
        calculateProject(
          input.parts,
          const WarehouseSettings(shiftsPerDay: 3),
        ).totalRequiredPallets,
        15,
      );
      final p = project(input.parts, raw: input.rawInputRows),
          bytes = service.exportBytes(p, calculateProject(p.parts, p.settings)),
          b = Excel.decodeBytes(bytes),
          original = b['Original Input Data'];
      final marker = original.rows.indexWhere(
        (r) =>
            r.first?.value.toString().startsWith(
              'LOGEN ORIGINAL SOURCE DATA',
            ) ??
            false,
      );
      expect(marker, greaterThan(0));
      expect(original.rows[marker + 2][4]!.value.toString(), '1000');
      expect(service.importBytes(bytes).parts, hasLength(1));
      final unknownStockRow = List<Object?>.from(r)..[2] = null;
      final unknownStock = service.importBytes(source([h, unknownStockRow]));
      expect(unknownStock.parts.single.stockQty, isNull);
    },
  );
  test('monthly legacy inputs infer packaging with explicit warnings', () {
    const h = [
      'Part Number',
      'Stock Quantity',
      'Parts per Pallet',
      'Monthly Consumption',
      'Input Coverage (days)',
      'L (mm)',
      'W (mm)',
      'H (mm)',
      'Stacking',
    ];
    final input = service.importBytes(
          source([
            h,
            ['MONTH', 5600, 800, 22000, 5, 1200, 800, 1000, 3],
          ]),
        ),
        p = input.parts.single;
    expect(p.consumptionPerShift, 500);
    expect(p.qtyBox, 800);
    expect(p.qtyOnPallet, 1);
    expect(p.packagingInferred, isTrue);
    expect(input.warnings.join(), contains('inferred packaging'));
    expect(
      calculateProject(
        input.parts,
        const WarehouseSettings(shiftsPerDay: 3, workingDaysPerMonth: 30),
      ).totalRequiredPallets,
      15,
    );
  });
  test(
    'invalid, blank and formula rows remain visible instead of vanishing',
    () {
      final bad = row('BAD');
      bad[5] = 'bad length';
      final formula = row('FORMULA');
      formula[5] = FormulaCellValue('600*2');
      final blank = row('BLANK');
      blank[3] = null;
      final input = service.importBytes(
            source([headings, bad, formula, blank, row('GOOD')]),
          ),
          c = calculateProject(input.parts, const WarehouseSettings());
      expect(input.parts, hasLength(4));
      expect(c.invalidCount, 3);
      expect(input.parts[0].inputErrors.join(), contains('L(mm)'));
      expect(
        input.parts[1].inputErrors.join(),
        contains('formulas are not evaluated'),
      );
      expect(input.parts[2].inputErrors.join(), contains('is required'));
      final b = output(project(input.parts, raw: input.rawInputRows));
      expect(
        b['Warehouse Comparison'].rows[6][1]!.value.toString(),
        contains('PARTIAL TOTALS'),
      );
      expect(
        value(b['Floor Pallet Calculations'], 'Status'),
        contains('Invalid'),
      );
    },
  );
  test('duplicate identifiers are dynamic validation errors', () {
    final input = service.importBytes(
      source([headings, row('DUP'), row('dup')]),
    );
    expect(
      calculateProject(input.parts, const WarehouseSettings()).invalidCount,
      2,
    );
    expect(input.warnings.join(), contains('Duplicate'));
    expect(
      calculateProject([
        input.parts.first,
      ], const WarehouseSettings()).invalidCount,
      0,
    );
  });
  test(
    'unlimited floor limit and actual occupied depth remain distinct in export',
    () {
      final input = service.importBytes(service.templateBytes()),
          b = output(
            project(
              input.parts,
              settings: const WarehouseSettings(maxFloorRowDepth: 0),
            ),
          );
      expect(
        numeric(b['Floor Pallet Calculations'], 'Total Occupied Row Depth (m)'),
        closeTo(12.9, 1e-9),
      );
      final r = b['Warehouse Settings'].rows.firstWhere(
        (r) => r.first?.value.toString() == 'Maximum floor row depth LIMIT',
      );
      expect(double.parse(r[1]!.value.toString()), 0);
      expect(r[2]!.value.toString(), contains('unlimited'));
    },
  );
  test('zero consumption and unknown stock have honest safe export labels', () {
    final r = row();
    r[3] = 0;
    final input = service.importBytes(source([headings, r])),
        b = output(project(input.parts)),
        f = b['Floor Pallet Calculations'];
    expect(numeric(f, 'Rounded Pallets per Shift'), 0);
    expect(value(f, 'Current Stock (parts, optional)'), 'Not provided');
    expect(value(f, 'Actual Coverage (days, optional)'), 'No consumption');
    for (final r in b['Warehouse Comparison'].rows) {
      if (r.first?.value.toString().contains('(%)') ?? false) {
        expect(r[1]!.value.toString(), contains('N/A'));
      }
    }
  });
  test('invalid settings export unavailable totals instead of zeros', () {
    final input = service.importBytes(service.templateBytes()),
        b = output(
          project(
            input.parts,
            settings: const WarehouseSettings(shiftsPerDay: 4),
          ),
        );
    expect(
      b['Warehouse Comparison'].rows[1][1]!.value.toString(),
      contains('Unavailable'),
    );
    expect(
      b['Warehouse Comparison'].rows[6][1]!.value.toString(),
      contains('INVALID SETTINGS'),
    );
  });
  test('unreadable workbook and missing headings fail explicitly', () {
    expect(
      () => service.importBytes(Uint8List.fromList([1, 2, 3])),
      throwsFormatException,
    );
    expect(
      () => service.importBytes(
        source([
          ['Part Number'],
        ]),
      ),
      throwsFormatException,
    );
  });
  test(
    'project storage retains independent settings, parts and source data',
    () async {
      SharedPreferences.setMockInitialValues({});
      final store = ProjectStore(),
          input = service.importBytes(service.templateBytes());
      await store.save([
        WarehouseProject(
          id: 'a',
          name: 'A',
          parts: input.parts,
          settings: const WarehouseSettings(shiftsPerDay: 3),
          rawInputRows: input.rawInputRows,
        ),
        WarehouseProject(
          id: 'b',
          name: 'B',
          settings: const WarehouseSettings(gangwayWidth: 6000),
        ),
      ]);
      final loaded = await store.load();
      expect(loaded, hasLength(2));
      expect(loaded.first.parts.single.consumptionPerShift, 500);
      expect(loaded.first.settings.shiftsPerDay, 3);
      expect(loaded.last.settings.gangwayWidth, 6000);
      expect(loaded.first.rawInputRows![1][3], 500);
      await store.save([loaded.first]);
      expect(
        (await SharedPreferences.getInstance()).getString(
          ProjectStore.backupKey,
        ),
        isNotNull,
      );
    },
  );
  test(
    'legacy saved rates migrate once before shifts or obsolete coverage presets change',
    () async {
      SharedPreferences.setMockInitialValues({});
      final store = ProjectStore();
      final old = PartInput(
        partNumber: 'OLD',
        stockQty: 5600,
        partsPerPallet: 800,
        monthlyConsumption: 22000,
        providedCoverageDays: 5,
        length: 1200,
        width: 800,
        height: 1000,
        stacking: 3,
      );
      await store.save([
        WarehouseProject(
          id: 'old',
          name: 'Old',
          parts: [old],
          settings: const WarehouseSettings(coverageMode: '48h'),
        ),
      ]);
      final prefs = await SharedPreferences.getInstance(),
          before = prefs.getString(ProjectStore.storageKey),
          loaded = (await store.load()).single;
      expect(loaded.parts.single.consumptionPerShift, 500);
      expect(loaded.settings.coverageMode, 'custom');
      expect(loaded.settings.customCoverageDays, 2);
      expect(prefs.getString(ProjectStore.storageKey), before);
      await store.save([
        loaded.copyWith(
          settings: loaded.settings.copyWith(
            shiftsPerDay: 3,
            workingDaysPerMonth: 30,
          ),
        ),
      ]);
      final changed = (await store.load()).single;
      expect(changed.parts.single.consumptionPerShift, 500);
      expect(
        calculateProject(changed.parts, changed.settings).totalRequiredPallets,
        6,
      );
    },
  );
  test(
    'corrupt persisted data stays intact and reports a recoverable error',
    () async {
      SharedPreferences.setMockInitialValues({
        ProjectStore.storageKey: 'broken',
      });
      await expectLater(ProjectStore().load(), throwsFormatException);
      expect(
        (await SharedPreferences.getInstance()).getString(
          ProjectStore.storageKey,
        ),
        'broken',
      );
    },
  );
}
