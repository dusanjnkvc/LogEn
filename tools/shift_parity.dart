// Development QA: compare the Dart engine with the standalone JavaScript model.
import 'dart:convert';
import 'dart:io';

import 'package:logen/domain.dart';

Object? finiteJson(Object? value) {
  if (value is num) return value.isFinite ? value : null;
  if (value is List) return value.map(finiteJson).toList();
  if (value is Map) {
    return value.map((key, entry) => MapEntry(key.toString(), finiteJson(entry)));
  }
  return value;
}

Map<String, Object?> snapshot(PartCalculation result) {
  final input = result.input;
  final planning = result.planning;
  final floor = result.floor;
  final rack = result.rack;
  return {
    'input': {
      'partNumber': input.partNumber,
      'qtyBox': input.qtyBox,
      'qtyOnPallet': input.qtyOnPallet,
      'partsPerPallet': input.partsPerPallet,
      'consumptionPerShift': input.consumptionPerShift,
      'doh': input.doh,
      'stacking': input.stacking,
      'stockQty': input.stockQty,
      'packagingInferred': input.packagingInferred,
    },
    'isValid': result.isValid,
    'errorCount': result.errors.length,
    'requiredParts': result.requiredParts,
    'requiredPallets': result.requiredPallets,
    'planning': planning == null ? null : {
      'qtyBox': planning.qtyBox,
      'qtyOnPallet': planning.qtyOnPallet,
      'partsPerPallet': planning.partsPerPallet,
      'consumptionPerShift': planning.consumptionPerShift,
      'palletsPerShift': planning.palletsPerShift,
      'roundedPalletsPerShift': planning.roundedPalletsPerShift,
      'plannedPalletsPerDay': planning.plannedPalletsPerDay,
      'requiredPallets': planning.requiredPallets,
      'dailyConsumption': planning.dailyConsumption,
      'shiftConsumption': planning.shiftConsumption,
      'palletsPerDay': planning.palletsPerDay,
      'targetCoverageDays': planning.targetCoverageDays,
      'currentPallets': planning.currentPallets,
      'currentPalletPositions': planning.currentPalletPositions,
      'actualCoverageDays': planning.actualCoverageDays,
      'coverageDifferenceDays': planning.coverageDifferenceDays,
      'palletDurationDays': planning.palletDurationDays,
      'stockQty': planning.stockQty,
      'noConsumption': planning.noConsumption,
      'pallets24h': planning.pallets24h,
      'pallets48h': planning.pallets48h,
      'palletsCustom': planning.palletsCustom,
    },
    'floor': floor == null ? null : {
      'maximumStacking': floor.maximumStacking,
      'effectiveStacking': floor.effectiveStacking,
      'positions': floor.positions,
      'palletsPerRow': floor.palletsPerRow,
      'rows': floor.rows,
      'rowWidth': floor.rowWidth,
      'rowDepth': floor.rowDepth,
      'totalOccupiedDepth': floor.totalOccupiedDepth,
      'fullRowDepth': floor.fullRowDepth,
      'lastRowDepth': floor.lastRowDepth,
      'lastRowPallets': floor.lastRowPallets,
      'withoutGangways': floor.withoutGangways,
      'gangwayArea': floor.gangwayArea,
      'withGangways': floor.withGangways,
    },
    'rack': rack == null ? null : {
      'palletsPerSlot': rack.palletsPerSlot,
      'levels': rack.levels,
      'capacityPerBay': rack.capacityPerBay,
      'bays': rack.bays,
      'maxBaysPerRun': rack.maxBaysPerRun,
      'runs': rack.runs,
      'rotated': rack.rotated,
      'effectiveBayLength': rack.effectiveBayLength,
      'effectiveBayDepth': rack.effectiveBayDepth,
      'effectiveBayHeight': rack.effectiveBayHeight,
      'withoutGangways': rack.withoutGangways,
      'gangwayArea': rack.gangwayArea,
      'withGangways': rack.withGangways,
      'baysPerRun': rack.baysPerRun,
    },
  };
}

Future<void> main() async {
  final text = await stdin.transform(utf8.decoder).join();
  final cases = jsonDecode(text) as List<dynamic>;
  final results = <Object?>[];
  for (final raw in cases) {
    final item = Map<String, dynamic>.from(raw as Map);
    final settings = WarehouseSettings.fromJson(
      Map<String, dynamic>.from(item['settings'] as Map),
    );
    var part = PartInput.fromJson(Map<String, dynamic>.from(item['input'] as Map));
    if (item['importSettings'] != null) {
      part = normalizePart(part, WarehouseSettings.fromJson(
        Map<String, dynamic>.from(item['importSettings'] as Map),
      ));
    }
    results.add(finiteJson(snapshot(calculatePart(part, settings))));
  }
  stdout.write(jsonEncode(results));
}
