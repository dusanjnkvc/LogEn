import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:logen/domain.dart';

PartInput part([Map<String, dynamic> changes = const {}]) =>
    PartInput.fromJson({
      'partNumber': 'SHIFT-001',
      'qtyBox': 20,
      'qtyOnPallet': 40,
      'consumptionPerShift': 500,
      'doh': 5,
      'length': 1200,
      'width': 800,
      'height': 1000,
      ...changes,
    });
WarehouseSettings settings([Map<String, dynamic> changes = const {}]) =>
    WarehouseSettings.fromJson({
      ...const WarehouseSettings().toJson(),
      ...changes,
    });
PartCalculation calculate([
  Map<String, dynamic> p = const {},
  Map<String, dynamic> s = const {},
]) => calculatePart(part(p), settings(s));
PartCalculation forPallets(
  int count, {
  double stacking = 1,
  double depth = 5000,
}) => calculate(
  {'consumptionPerShift': 1, 'doh': count, 'stacking': stacking},
  {'shiftsPerDay': 1, 'maxFloorRowDepth': depth},
);

void main() {
  test(
    'eight-column sample defaults to one-high and drives all four footprints',
    () {
      final r = calculate();
      expect(r.errors, isEmpty);
      expect(r.input.stacking, 1);
      expect(r.requiredParts, 5000);
      expect(r.requiredPallets, 10);
      expect(r.planning!.partsPerPallet, 800);
      expect(r.planning!.palletsPerShift, .625);
      expect(r.planning!.roundedPalletsPerShift, 1);
      expect(r.planning!.plannedPalletsPerDay, 2);
      expect(r.floor!.withoutGangways, closeTo(11.34, 1e-9));
      expect(r.floor!.withGangways, closeTo(63.6, 1e-9));
      expect(r.rack!.withoutGangways, closeTo(7.98, 1e-9));
      expect(r.rack!.withGangways, closeTo(33.63, 1e-9));
    },
  );
  test('rounding is per shift before DOH and shifts, not over total parts', () {
    final r = calculate({'consumptionPerShift': 1000});
    expect(r.planning!.palletsPerShift, 1.25);
    expect(r.planning!.roundedPalletsPerShift, 2);
    expect(r.requiredPallets, 20);
    expect((r.requiredParts! / 800).ceil(), 13);
  });
  test(
    'one to three shifts multiply fixed per-shift consumption and storage',
    () {
      for (final shifts in [1, 2, 3]) {
        final r = calculate({}, {'shiftsPerDay': shifts});
        expect(r.planning!.consumptionPerShift, 500);
        expect(r.planning!.dailyConsumption, 500 * shifts);
        expect(r.requiredPallets, 5 * shifts);
      }
      for (final invalid in [0, 4, 1.5, double.nan]) {
        expect(settings({'shiftsPerDay': invalid}).validate(), isNotEmpty);
      }
    },
  );
  test('per-part DOH and project DOH override remain distinct', () {
    expect(calculate({'doh': 2}).requiredPallets, 4);
    final r = calculate(
      {'doh': 2},
      {'coverageMode': 'custom', 'customCoverageDays': 5},
    );
    expect(r.requiredPallets, 10);
    expect(r.planning!.providedCoverageDays, 2);
    expect(r.planning!.targetCoverageDays, 5);
  });
  test(
    'fractional DOH rounds final storage to whole pallets and zero DOH is safe',
    () {
      for (final entry in {0.0: 0, .1: 1, .5: 1, 1.25: 3, 2.25: 5}.entries) {
        expect(calculate({'doh': entry.key}).requiredPallets, entry.value);
      }
      final zero = calculate({'doh': 0});
      expect(zero.floor!.rows, 0);
      expect(zero.rack!.runs, 0);
    },
  );
  test('old entered-stock mode cannot bypass the required shift formula', () {
    final r = calculate({'stockQty': 801}, {'stockMode': 'entered'});
    expect(r.requiredPallets, 10);
    expect(r.requiredParts, 5000);
    expect(r.planning!.currentPalletPositions, 2);
  });
  test('new input never fabricates actual stock or monthly consumption', () {
    final r = calculate();
    expect(r.input.stockQty, isNull);
    expect(r.planning!.currentPallets, isNull);
    expect(r.planning!.actualCoverageDays, isNull);
    expect(r.planning!.monthlyConsumption, isNull);
    expect(r.planning!.coverageMismatch, isFalse);
  });
  test('new packaging and shift values override stale historical metadata', () {
    final r = calculate({
      'partsPerPallet': 1,
      'monthlyConsumption': 1,
      'consumption': 9999,
      'providedCoverageDays': 100,
      'doh': 2,
    });
    expect(r.input.partsPerPallet, 800);
    expect(r.requiredPallets, 4);
    expect(r.planning!.dailyConsumption, 1000);
  });
  test(
    'legacy daily data migrates once and remains fixed when shifts change',
    () {
      final old = PartInput.fromJson({
        'partNumber': 'OLD',
        'qtyBox': 20,
        'qtyOnPallet': 40,
        'qtyPallet': 7,
        'consumption': 1000,
        'doh': 5,
        'length': 1200,
        'width': 800,
        'height': 1000,
        'stacking': 3,
      });
      final migrated = normalizePart(old, settings());
      expect(migrated.consumptionPerShift, 500);
      expect(migrated.stockQty, 5600);
      expect(migrated.packagingInferred, isFalse);
      final r = calculatePart(migrated, settings({'shiftsPerDay': 3}));
      expect(r.requiredPallets, 15);
      expect(r.planning!.dailyConsumption, 1500);
    },
  );
  test(
    'monthly legacy conversion flags inferred packaging and keeps its source',
    () {
      final old = PartInput.fromJson({
        'partNumber': 'OLD',
        'partsPerPallet': 800,
        'monthlyConsumption': 22000,
        'providedCoverageDays': 5,
        'length': 1200,
        'width': 800,
        'height': 1000,
      });
      final migrated = normalizePart(old, settings());
      expect(migrated.qtyBox, 800);
      expect(migrated.qtyOnPallet, 1);
      expect(migrated.packagingInferred, isTrue);
      expect(migrated.consumptionPerShift, 500);
      expect(migrated.monthlyConsumption, 22000);
      expect(migrated.stockQty, isNull);
      final saved = PartInput.fromJson(
        jsonDecode(jsonEncode(migrated.toJson())),
      );
      expect(
        calculatePart(saved, settings({'shiftsPerDay': 3})).requiredPallets,
        15,
      );
    },
  );
  test(
    'obsolete calendar and unknown stock do not invalidate explicit shift data',
    () {
      expect(calculate({}, {'workingDaysPerMonth': 0}).isValid, isTrue);
      final r = calculate({'monthlyConsumption': double.nan, 'stockQty': -1});
      expect(r.isValid, isTrue);
      expect(r.planning!.currentPallets, isNull);
    },
  );
  test(
    'zero shift demand has zero storage and undefined consumption durations',
    () {
      final r = calculate({'consumptionPerShift': 0, 'stockQty': 5600});
      expect(r.isValid, isTrue);
      expect(r.requiredPallets, 0);
      expect(r.planning!.noConsumption, isTrue);
      expect(r.planning!.palletDurationDays, isNull);
      expect(r.planning!.actualCoverageDays, isNull);
      expect(r.floor!.withoutGangways, 0);
      expect(r.rack!.withGangways, 0);
    },
  );
  test(
    'whole-pallet boundaries retain meaningful fractions and reject overflow',
    () {
      expect(
        calculate({
          'consumptionPerShift': 800,
        }).planning!.roundedPalletsPerShift,
        1,
      );
      expect(
        calculate({
          'consumptionPerShift': 800.00001,
        }).planning!.roundedPalletsPerShift,
        2,
      );
      expect(
        calculate({
          'consumptionPerShift': 800.0000000000002,
        }).planning!.roundedPalletsPerShift,
        2,
      );
      expect(calculate({'consumptionPerShift': 1e-20}).requiredPallets, 10);
      expect(calculate({'consumptionPerShift': 1e300}).isValid, isFalse);
    },
  );
  test('invalid packaging, shift rate, DOH and geometry remain visible', () {
    for (final changes in <Map<String, dynamic>>[
      {'qtyBox': 0},
      {'qtyBox': 1.5},
      {'qtyOnPallet': 0},
      {'qtyOnPallet': .5},
      {'consumptionPerShift': -1},
      {'consumptionPerShift': double.nan},
      {'doh': -1},
      {'height': double.nan},
      {'stacking': 0},
      {
        'inputErrors': ['Invalid Excel cell'],
      },
    ]) {
      expect(calculate(changes).errors, isNotEmpty);
    }
  });
  test(
    'JSON roundtrip retains invalid numeric inputs instead of valid zero',
    () {
      final original = part({'consumptionPerShift': double.nan});
      final restored = PartInput.fromJson(
        jsonDecode(jsonEncode(original.toJson())),
      );
      expect(restored.consumptionPerShift!.isNaN, isTrue);
      expect(calculatePart(restored, settings()).isValid, isFalse);
    },
  );
  test(
    'manual floor stacking is height-limited and never changes rack capacity',
    () {
      final a = calculate(), b = calculate({'stacking': 3});
      expect(b.floor!.positions, 4);
      expect(b.floor!.withoutGangways, closeTo(4.5, 1e-9));
      expect(b.floor!.withGangways, closeTo(21.2, 1e-9));
      expect(a.rack!.bays, b.rack!.bays);
      expect(calculate({'stacking': 99}).floor!.effectiveStacking, 5);
    },
  );
  test('floor fit error preserves independent planning and rack result', () {
    final r = calculate({}, {'maxFloorRowDepth': 1000});
    expect(r.isValid, isFalse);
    expect(r.floor, isNull);
    expect(r.rack, isNotNull);
    expect(r.requiredPallets, 10);
    expect(r.planning!.roundedPalletsPerShift, 1);
  });
  test(
    'actual floor depth counts full and partial rows without unused depth',
    () {
      final r = forPallets(19, stacking: 3);
      expect(r.floor!.positions, 7);
      expect(r.floor!.rows, 3);
      expect(r.floor!.lastRowPallets, 1);
      expect(r.floor!.totalOccupiedDepth, closeTo(8.8, 1e-9));
      expect(r.floor!.withoutGangways, closeTo(7.92, 1e-9));
    },
  );
  test(
    'zero floor depth is unrestricted and rack depth remains independent',
    () {
      final r = forPallets(19, stacking: 3, depth: 0);
      expect(r.floor!.rows, 1);
      expect(r.floor!.palletsPerRow, 7);
      expect(r.floor!.rowDepth, 9);
      expect(r.floor!.withoutGangways, closeTo(8.1, 1e-9));
      expect(
        r.rack!.withoutGangways,
        forPallets(19, stacking: 3).rack!.withoutGangways,
      );
      expect(settings({'rackSlotDepth': 0}).validate(), isNotEmpty);
    },
  );
  test(
    'rack runs use actual final bay allocation and levels do not multiply area',
    () {
      final r = forPallets(41);
      expect(r.rack!.bays, 6);
      expect(r.rack!.runs, 2);
      expect(r.rack!.baysPerRun, [5, 1]);
      expect(r.rack!.withoutGangways, closeTo(23.94, 1e-9));
      expect(r.rack!.gangwayArea, closeTo(76.95, 1e-9));
    },
  );
  test('rack depth and vertical clearances enforce independent boundaries', () {
    expect(calculate({'height': 1000, 'width': 1100}).isValid, isTrue);
    expect(calculate({'height': 1001}).rack, isNull);
    expect(calculate({'height': 1001}).floor, isNotNull);
    expect(calculate({'width': 1101}).rack, isNull);
    expect(
      calculate({'width': 1101}, {'rackDepthClearance': 99}).rack,
      isNotNull,
    );
  });
  test('rack rotation is opt-in and selects the best valid orientation', () {
    final a = calculate({'length': 1000, 'width': 600});
    final b = calculate(
      {'length': 1000, 'width': 600},
      {'allowRotation': true},
    );
    expect(a.rack!.palletsPerSlot, 2);
    expect(b.rack!.palletsPerSlot, 3);
    expect(b.rack!.rotated, isTrue);
  });
  test(
    'parts have dedicated rows and bays and share one pallet requirement',
    () {
      final r = calculateProject([
        part({'partNumber': 'A'}),
        part({'partNumber': 'B'}),
      ], settings());
      expect(r.invalidCount, 0);
      expect(r.totalRequiredPallets, 20);
      expect(r.totalFloorRows, 8);
      expect(r.totalRackBays, 4);
      expect(r.floorWithoutGangways, closeTo(22.68, 1e-9));
      expect(r.rackWithGangways, closeTo(67.26, 1e-9));
    },
  );
  test(
    'invalid rows stay listed and totals include only complete valid rows',
    () {
      final r = calculateProject([
        part(),
        part({'partNumber': 'BAD', 'qtyBox': 0}),
      ], settings());
      expect(r.results.length, 2);
      expect(r.invalidCount, 1);
      expect(r.totalRequiredPallets, 10);
      expect(r.floorWithoutGangways, closeTo(11.34, 1e-9));
    },
  );
  test('floor total sums displayed storage cents independently of rack fit', () {
    final r = calculateProject([
      part({'partNumber': 'OK'}), part({'partNumber': 'TALL', 'height': 1100}),
    ], settings());
    expect(r.invalidCount, 1);
    expect(r.floorValidCount, 2); expect(r.rackValidCount, 1);
    expect(r.results.last.isFloorValid, isTrue); expect(r.results.last.isRackValid, isFalse);
    expect(r.totalRequiredPallets, 20); expect(r.totalFloorPositions, 20);
    expect(r.floorWithoutGangways, closeTo(22.68, 1e-9));
    expect(r.floorWithGangways, closeTo(127.2, 1e-9));
    expect(r.rackWithoutGangways, closeTo(7.98, 1e-9));
    final cents = calculateProject([
      part({'partNumber': 'C1', 'width': 801}), part({'partNumber': 'C2', 'width': 801}),
    ], settings());
    expect(cents.results.map((row) => row.floor!.storageArea), [11.35, 11.35]);
    expect(cents.floorWithoutGangways, 22.70);
    final floorBad = calculateProject([part()], settings({'maxFloorRowDepth': 1000}));
    expect(floorBad.floorValidCount, 0); expect(floorBad.rackValidCount, 1);
    expect(floorBad.floorWithoutGangways, 0);
    expect(floorBad.rackWithoutGangways, closeTo(7.98, 1e-9));
    final duplicates = calculateProject([part(), part()], settings());
    expect(duplicates.floorValidCount, 0); expect(duplicates.rackValidCount, 0);
    expect(duplicates.floorWithoutGangways, 0);
  });
  test(
    'duplicate part numbers are case-insensitive and revalidation clears them',
    () {
      final a = part({'partNumber': 'Same'}),
          b = part({'partNumber': ' same '});
      expect(calculateProject([a, b], settings()).invalidCount, 2);
      expect(calculateProject([a], settings()).invalidCount, 0);
    },
  );
  test(
    'negative savings are preserved and zero denominators stay undefined',
    () {
      final r = calculateProject([part({'stacking': 3})], settings());
      expect(r.savingWithGangways, closeTo(-12.43, 1e-9));
      expect(r.savingWithGangwaysPercent, lessThan(0));
      final zero = calculateProject([
        part({'consumptionPerShift': 0}),
      ], settings());
      expect(zero.savingWithGangwaysPercent, isNull);
    },
  );
  test('both scenarios allocate the full saved physical gangway width', () {
    final baseline = calculate({}, {'gangwayWidth': 0});
    for (final width in [0, 3000, 4500, 4501]) {
      final s = settings({'gangwayWidth': width});
      final r = calculatePart(part(), s);
      expect(s.gangwayWidth, width);
      expect(s.allocatedGangwayWidth, width);
      expect(r.requiredPallets, baseline.requiredPallets);
      expect(r.floor!.withoutGangways, baseline.floor!.withoutGangways);
      expect(r.rack!.withoutGangways, baseline.rack!.withoutGangways);
      expect(r.floor!.gangwayArea, closeTo(10 * 1.2 * (width / 1000), 1e-9));
      expect(r.rack!.gangwayArea, closeTo(5.7 * (width / 1000), 1e-9));
      expect(r.floor!.withGangways,
          closeTo(baseline.floor!.formulaStorageArea + r.floor!.gangwayArea, 1e-9));
      expect(r.rack!.withGangways,
          closeTo(baseline.rack!.withoutGangways + r.rack!.gangwayArea, 1e-9));
    }
    final r = calculate();
    expect(r.floor!.gangwayArea, closeTo(54, 1e-9));
    expect(r.rack!.gangwayArea, closeTo(25.65, 1e-9));
  });
  test('floor formula uses unrounded Q/S and excludes row clearances', () {
    final r = forPallets(7, stacking: 3);
    expect(r.floor!.positions, 3);
    expect(r.floor!.formulaPositions, closeTo(7 / 3, 1e-9));
    expect(r.floor!.formulaStorageArea, closeTo(2.24, 1e-9));
    expect(r.floor!.gangwayArea, closeTo(12.6, 1e-9));
    expect(r.floor!.withGangways, closeTo(14.84, 1e-9));
    final differentRows = calculate(
      {'consumptionPerShift': 1, 'doh': 7, 'stacking': 3},
      {'shiftsPerDay': 1, 'maxFloorRowDepth': 2500, 'floorPalletClearance': 50},
    );
    expect(differentRows.floor!.withoutGangways, isNot(r.floor!.withoutGangways));
    expect(differentRows.floor!.withGangways, r.floor!.withGangways);
    final noAisle = calculate(
      {'consumptionPerShift': 1, 'doh': 7, 'stacking': 3},
      {'shiftsPerDay': 1, 'gangwayWidth': 0},
    );
    expect(noAisle.floor!.withGangways, closeTo(2.24, 1e-9));
    expect(noAisle.floor!.gangwayArea, 0);
    expect(noAisle.floor!.withGangways, isNot(noAisle.floor!.withoutGangways));
    final heightLimited = calculate(
      {'consumptionPerShift': 1, 'doh': 7, 'stacking': 3},
      {'shiftsPerDay': 1, 'maxFloorStackingHeight': 2000},
    );
    expect(heightLimited.floor!.effectiveStacking, 2);
    expect(heightLimited.floor!.withGangways, closeTo(22.26, 1e-9));
    expect(r.rack!.withGangways, closeTo(16.815, 1e-9));
    final zero = calculate({'doh': 0});
    expect(zero.floor!.formulaPositions, 0);
    expect(zero.floor!.formulaStorageArea, 0);
    expect(zero.floor!.withGangways, 0);
  });
  test('gangways alter allocated area only', () {
    final a = calculate(), b = calculate({}, {'gangwayWidth': 3000});
    expect(a.floor!.withoutGangways, b.floor!.withoutGangways);
    expect(a.rack!.withoutGangways, b.rack!.withoutGangways);
    expect(b.floor!.withGangways, closeTo(45.6, 1e-9));
  });
  test('invalid settings and empty projects remain safe and explicit', () {
    final r = calculateProject([part()], settings({'maxRackRunLength': 2000}));
    expect(r.settingsErrors, isNotEmpty);
    expect(r.results.length, 1);
    expect(r.totalRequiredPallets, 0);
    final empty = calculateProject([], settings());
    expect(empty.invalidCount, 0);
    expect(empty.totalRackRuns, 0);
    expect(empty.savingWithoutGangwaysPercent, isNull);
  });
}
