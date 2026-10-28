import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:logen/domain.dart';
import 'package:logen/main.dart';
import 'package:logen/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

Finder field(String label) => find.byWidgetPredicate(
  (widget) => widget is TextField && widget.decoration?.labelText == label,
);
String textValue(WidgetTester tester, String key) =>
    tester.widget<Text>(find.byKey(ValueKey(key))).data!;
String kpi(WidgetTester tester, String key) => textValue(tester, key);

const sample = PartInput(
  partNumber: 'SAMPLE-001',
  qtyBox: 20,
  qtyOnPallet: 40,
  consumptionPerShift: 500,
  doh: 5,
  length: 1200,
  width: 800,
  height: 1000,
  stacking: 1,
);

Future<void> launch(WidgetTester tester, {bool mobile = false}) async {
  tester.view.physicalSize = mobile
      ? const Size(390, 844)
      : const Size(1500, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(const MainApp());
  await tester.pumpAndSettle();
}

Future<void> openSettings(WidgetTester tester) async {
  await tester.ensureVisible(find.byKey(const Key('warehouse-settings')));
  await tester.tap(find.byKey(const Key('warehouse-settings')));
  await tester.pumpAndSettle();
}

Future<void> choose(WidgetTester tester, String key, String choice) async {
  await tester.ensureVisible(find.byKey(Key(key)));
  await tester.tap(find.byKey(Key(key)));
  await tester.pumpAndSettle();
  await tester.tap(find.text(choice).last);
  await tester.pumpAndSettle();
}

Future<void> saveSettings(WidgetTester tester) async {
  await tester.tap(find.widgetWithText(FilledButton, 'Save settings'));
  await tester.pumpAndSettle();
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets(
    'shift-first sample drives all four footprints and saved gangways',
    (tester) async {
      await launch(tester);
      expect(kpi(tester, 'kpi-floor-without'), '11.34 m²');
      expect(kpi(tester, 'kpi-floor-with'), '19.44 m²');
      expect(kpi(tester, 'kpi-rack-without'), '7.98 m²');
      expect(kpi(tester, 'kpi-rack-with'), '20.81 m²');
      expect(textValue(tester, 'raw-pallets-SAMPLE-001'), '0.625');
      expect(textValue(tester, 'rounded-pallets-SAMPLE-001'), '1');
      expect(textValue(tester, 'required-SAMPLE-001'), '10');
      expect(find.text('MONTHLY\nCONSUMPTION'), findsNothing);
      await openSettings(tester);
      expect(
        textValue(tester, 'allocated-gangway-width'),
        'Allocated gangway width = 4500 ÷ 2 = 2250 mm for both floor and rack calculations.',
      );
      await saveSettings(tester);
      expect((await ProjectStore().load()).single.settings.gangwayWidth, 4500);
      expect(kpi(tester, 'kpi-floor-with'), '19.44 m²');
      await openSettings(tester);
      await tester.ensureVisible(field('Gangway width'));
      await tester.enterText(field('Gangway width'), '0');
      await saveSettings(tester);
      expect(kpi(tester, 'kpi-floor-with'), '11.34 m²');
      expect(kpi(tester, 'kpi-rack-with'), '7.98 m²');
      expect((await ProjectStore().load()).single.settings.gangwayWidth, 0);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'manual input previews the inner rounding before DOH and searches formulas',
    (tester) async {
      await launch(tester);
      await tester.tap(find.byKey(const Key('add-part')));
      await tester.pumpAndSettle();
      await tester.enterText(field('Part Number'), 'EXTRA-001');
      await tester.enterText(field('Consumption per shift'), '1000');
      await tester.pump();
      expect(find.text('1000 parts/shift'), findsOneWidget);
      expect(find.text('1.25 pallets/shift'), findsOneWidget);
      expect(find.text('2 pallets/shift'), findsOneWidget);
      expect(find.text('20 pallets'), findsOneWidget);
      await tester.enterText(field('Consumption per shift'), '500');
      await tester.tap(find.widgetWithText(FilledButton, 'Add part number'));
      await tester.pumpAndSettle();
      expect(kpi(tester, 'kpi-floor-without'), '22.68 m²');
      final parts = (await ProjectStore().load()).single.parts;
      expect(parts.length, 2);
      expect(parts.last.qtyBox, 20);
      expect(parts.last.qtyOnPallet, 40);
      expect(parts.last.consumptionPerShift, 500);
      expect(parts.last.stacking, 1);
      final search = find.byKey(const Key('part-search'));
      await tester.ensureVisible(search);
      await tester.enterText(search, 'missing');
      await tester.pumpAndSettle();
      expect(find.text('No matching part numbers.'), findsOneWidget);
      await tester.enterText(search, 'EXTRA');
      await tester.pumpAndSettle();
      expect(find.text('EXTRA-001'), findsNWidgets(2));
      expect(find.text('SAMPLE-001'), findsNothing);
      await tester.ensureVisible(find.text('EXTRA-001').last);
      await tester.tap(find.text('EXTRA-001').last);
      await tester.pumpAndSettle();
      expect(find.text('Round up for one shift first'), findsOneWidget);
      expect(find.text('D · Racks with allocated gangways'), findsOneWidget);
      expect(
        find.textContaining('Allocated gangway width = 2250 mm'),
        findsNWidgets(2),
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'settings expose only 1–3 shifts and multiply fixed shift demand',
    (tester) async {
      await launch(tester);
      await openSettings(tester);
      expect(find.text('Working days per month'), findsNothing);
      await choose(tester, 'settings-shifts', '1 shift');
      expect(find.text('500 parts/shift'), findsOneWidget);
      expect(find.text('500 parts/day'), findsOneWidget);
      await saveSettings(tester);
      expect(textValue(tester, 'shift-SAMPLE-001'), '500');
      expect(textValue(tester, 'daily-SAMPLE-001'), '500');
      expect(textValue(tester, 'required-SAMPLE-001'), '5');
      await openSettings(tester);
      await choose(tester, 'settings-shifts', '3 shifts');
      expect(find.text('1500 parts/day'), findsOneWidget);
      expect(find.text('4 shifts'), findsNothing);
      await saveSettings(tester);
      expect(textValue(tester, 'shift-SAMPLE-001'), '500');
      expect(textValue(tester, 'daily-SAMPLE-001'), '1500');
      expect(textValue(tester, 'required-SAMPLE-001'), '15');
      expect((await ProjectStore().load()).single.settings.shiftsPerDay, 3);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'DOH override and unrestricted floor depth persist and recalculate',
    (tester) async {
      await launch(tester);
      await openSettings(tester);
      await choose(tester, 'settings-shifts', '3 shifts');
      await choose(tester, 'settings-doh-source', 'Project DOH override');
      await tester.ensureVisible(field('Project DOH override'));
      await tester.enterText(field('Project DOH override'), '3.5');
      await tester.ensureVisible(field('Maximum row depth (0 = unrestricted)'));
      await tester.enterText(
        field('Maximum row depth (0 = unrestricted)'),
        '0',
      );
      await saveSettings(tester);
      expect(textValue(tester, 'required-SAMPLE-001'), '11');
      expect(textValue(tester, 'used-doh-SAMPLE-001'), '3.5');
      expect(kpi(tester, 'kpi-floor-without'), '12.78 m²');
      expect(kpi(tester, 'kpi-floor-with'), '14.81 m²');
      expect(kpi(tester, 'kpi-rack-without'), '7.98 m²');
      final saved = (await ProjectStore().load()).single.settings;
      expect(saved.shiftsPerDay, 3);
      expect(saved.coverageMode, 'custom');
      expect(saved.customCoverageDays, 3.5);
      expect(saved.maxFloorRowDepth, 0);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('each input DOH is used until a project override is selected', (
    tester,
  ) async {
    await ProjectStore().save([
      WarehouseProject(
        id: 'different-doh',
        name: 'Part-specific DOH',
        parts: const [
          PartInput(
            partNumber: 'A',
            qtyBox: 20,
            qtyOnPallet: 40,
            consumptionPerShift: 500,
            doh: 2,
            length: 1200,
            width: 800,
            height: 1000,
            stacking: 1,
          ),
          PartInput(
            partNumber: 'B',
            qtyBox: 20,
            qtyOnPallet: 40,
            consumptionPerShift: 500,
            doh: 5,
            length: 1200,
            width: 800,
            height: 1000,
            stacking: 1,
          ),
        ],
      ),
    ]);
    await launch(tester);
    expect(textValue(tester, 'required-A'), '4');
    expect(textValue(tester, 'required-B'), '10');
    await openSettings(tester);
    await choose(tester, 'settings-doh-source', 'Project DOH override');
    await tester.ensureVisible(field('Project DOH override'));
    await tester.enterText(field('Project DOH override'), '2.5');
    await saveSettings(tester);
    expect(textValue(tester, 'required-A'), '5');
    expect(textValue(tester, 'required-B'), '5');
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'zero per-shift consumption is zero demand without invented stock',
    (tester) async {
      await ProjectStore().save([
        WarehouseProject(
          id: 'zero',
          name: 'No demand',
          parts: const [
            PartInput(
              partNumber: 'NO-DEMAND',
              qtyBox: 20,
              qtyOnPallet: 40,
              consumptionPerShift: 0,
              doh: 5,
              length: 1200,
              width: 800,
              height: 1000,
              stacking: 1,
            ),
          ],
        ),
      ]);
      await launch(tester);
      expect(kpi(tester, 'kpi-floor-without'), '0.00 m²');
      expect(textValue(tester, 'required-NO-DEMAND'), '0');
      expect(textValue(tester, 'daily-NO-DEMAND'), '0');
      expect(
        (await ProjectStore().load()).single.parts.single.stockQty,
        isNull,
      );
      expect(find.text('CURRENT\nPALLETS'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('dashboard and shift settings fit a narrow Android viewport', (
    tester,
  ) async {
    await launch(tester, mobile: true);
    expect(tester.takeException(), isNull);
    await openSettings(tester);
    expect(find.text('Save settings'), findsOneWidget);
    await choose(tester, 'settings-shifts', '3 shifts');
    expect(tester.takeException(), isNull);
  });

  testWidgets('canceling project deletion retains the inventory', (
    tester,
  ) async {
    await launch(tester);
    final original = (await ProjectStore().load()).single;
    await tester.tap(find.byKey(const Key('project-delete')));
    await tester.pumpAndSettle();
    expect(find.text('Delete project?'), findsOneWidget);
    await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
    await tester.pumpAndSettle();
    expect((await ProjectStore().load()).single.id, original.id);
    expect(kpi(tester, 'kpi-floor-without'), '11.34 m²');
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'deleting the final project and Undo preserve packaging and per-shift data',
    (tester) async {
      await launch(tester);
      final original = (await ProjectStore().load()).single;
      await tester.tap(find.byKey(const Key('project-delete')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('confirm-project-delete')));
      await tester.pumpAndSettle();
      final replacement = (await ProjectStore().load()).single;
      expect(replacement.id, isNot(original.id));
      expect(replacement.parts, isEmpty);
      expect(kpi(tester, 'kpi-floor-without'), '0.00 m²');
      await tester.tap(find.text('Undo'));
      await tester.pumpAndSettle();
      final restored = (await ProjectStore().load()).single;
      expect(restored.id, original.id);
      expect(restored.parts.single.qtyBox, 20);
      expect(restored.parts.single.qtyOnPallet, 40);
      expect(restored.parts.single.consumptionPerShift, 500);
      expect(restored.settings.toJson(), original.settings.toJson());
      expect(kpi(tester, 'kpi-floor-without'), '11.34 m²');
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'deleting the active project selects a surviving saved warehouse',
    (tester) async {
      await ProjectStore().save([
        WarehouseProject(id: 'first', name: 'First warehouse'),
        WarehouseProject(id: 'second', name: 'Second warehouse'),
      ]);
      await launch(tester);
      await tester.tap(find.byKey(const Key('project-delete')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('confirm-project-delete')));
      await tester.pumpAndSettle();
      expect((await ProjectStore().load()).single.id, 'second');
      expect(find.text('Second warehouse'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
