# LogEn

An offline yellow-and-black warehouse calculator with the supplied warehouse logo. It evaluates the same required inventory in four scenarios: floor pallets and pallet racks, each with and without allocated gangways.

## Open the app

Use the [hosted calculator](https://dusanjnkvc.github.io/LogEn/) in Chrome, or open **LogEn.html** directly for fully offline use. After an update, refresh the open tab. The HTML file embeds its code, logo and Excel library; no launcher, server, installation or account is required for local use.

The public GitHub repository contains the application and synthetic examples. Imported workbooks and saved warehouse projects remain in your browser. The hosted address and local HTML use separate browser storage; use **Projects → Download backup** and **Restore backup** to transfer your projects between them. To reopen without internet, keep the downloaded **LogEn.html** file.

GitHub Pages serves the generated `docs/index.html` from the `main` branch. Run `python tools/build_pages.py` after rebuilding the offline file to refresh the published copy.

## Eight-column input template

Use **LogEn_Shift_Inventory_Template.xlsx**, also available from **Download template** in the app. Its Input Data sheet contains exactly these columns:

1. Part Number
2. QTY in Box
3. QTY boxes per Pallet
4. Consumption per shift
5. DOH (Days on hand)
6. L(mm)
7. W(mm)
8. H(mm)

QTY in Box means individual parts per box. QTY boxes per Pallet means boxes carried by a pallet. Consumption per shift is individual parts consumed in one shift. L, W and H describe a loaded pallet in millimeters. Replace the sample, save as `.xlsx`, import, and review the confirmation.

The eight-column template does not specify floor stacking. New projects start with **Stackability unchecked** and use one pallet high. Check **Stackability** in **Shifts & days on hand** to edit a stacking factor for each part in Shift consumption, Part details, or the part editor. Unchecking it uses one-high storage while keeping every saved factor. Height limits still apply. Exports include an optional Stacking column when needed to preserve manually changed factors on re-import; the template remains exactly eight columns. Existing projects without the checkbox setting enable it automatically if they already contain a factor greater than one.

## Required-pallet formula

```text
Raw pallets per day = Consumption per shift / QTY in Box / QTY boxes per Pallet × shifts per day
Rounded pallets per day = ROUNDUP(Raw pallets per day, 0)
Required pallets = ROUNDUP(Rounded pallets per day × DOH, 0)
```

Multiply by the selected shifts **before rounding**. For example, 0.13 pallets/shift becomes 0.13, 0.26 or 0.39 for 1, 2 or 3 shifts; each rounds up to **1 pallet per day**. At 5 DOH, each requires 5 pallets. Another example: 1,000 parts/shift ÷ 20 parts/box ÷ 40 boxes/pallet = 1.25 pallets/shift. With 2 shifts, 2.5 pallets/day rounds up to 3; at 5 DOH, the answer is **15 pallets**. A final ceiling keeps storage pallets whole when DOH is fractional. Raw consumption values retain their decimals.

Choose **1, 2 or 3 shifts per day** (default 2). Use **DOH from each part** or a project DOH override. Editing the override immediately applies it to all parts; choose the per-part source to return to the Excel values. Changing shifts multiplies daily usage while the entered consumption per shift remains fixed. All four space results update automatically.

The default template sample (20 parts/box, 40 boxes/pallet, 500 parts/shift, 5 DOH, two shifts) requires **10 pallets**. At 1200 × 800 × 1000 mm, one-high floor storage and the default warehouse settings, the four footprints are **11.34 / 63.60 / 7.98 / 33.63 m²**.

## Space planning

Both storage methods use the same required whole-pallet count. Each part receives dedicated floor rows and rack bays; part numbers are not mixed within them. Height and pallet dimensions drive floor stacking and rack fit independently.

Ground storage-only area uses actual occupied depths of full and partial rows, including between-pallet clearances. The configured ground depth is a row-capacity limit; **0 means unrestricted**. Rack depth and fit rules are independent.

**PALLETS — WITHOUT GANGWAYS** is the sum of the two-decimal **Floor storage m²** values across the whole project, before searching or pagination. Floor totals include every calculable floor row even when that part does not fit the racks. Rack totals independently include calculable rack rows. Input errors and duplicate part numbers remain visible and are excluded from affected totals; a validation notice reports the floor and rack contribution counts. Raw occupied-depth calculations are retained for formula details, while the floor storage column and its total use the same rounded area contributions.

Floor area with gangways uses **SQM = (Q / S) × L × (W + G) / 1,000,000**. Q is required pallets, S is effective floor stacking (allowed stacking capped by the loaded-pallet height limit), and L/W/G are pallet length, pallet width and full gangway width in mm. **Q / S is not rounded**; the formula excludes pallet clearances and row-depth reservations. For Q=7, S=3, L=1200, W=800 and G=4500, it gives **14.84 m²**.

The floor formula base is (Q/S) × L × W / 1,000,000 and its gangway component is (Q/S) × L × G / 1,000,000. The independent storage-only floor result still uses rounded floor positions and occupied-row clearances, so adding that result to the formula gangway component does not reproduce the with-gangways value.

Racks retain the existing bay dimensions, rack levels and run-frontage calculation. Rack gangway area = actual rack run frontage × (gangway width / 1000). Both scenarios use the full configured gangway width: **4500 mm uses 4500 mm**. These are allocated planning estimates rather than optimized physical layouts; shared gangways count once in a physical design.

Use **Shift consumption** for raw and rounded per-shift demand, input and used DOH, daily demand, required pallets and space. Click a part number for substituted formulas. **Export results** creates Original Input Data, Floor Pallet Calculations, Rack Calculations, Warehouse Comparison and Warehouse Settings. Original legacy source cells are retained in a separate source-data section of the input sheet.

## Saved data and project management

Chrome stores projects for this file in the current browser profile. Keep the HTML at the same location. Use **Projects → Download backup** before moving the file, changing devices or clearing browser data. JSON backups include active and deleted projects. A save warning means the current changes exist only in memory.

**Projects → Delete project** asks for confirmation. Deleted projects keep their inventory and settings in **Deleted projects**, where **Restore project** recovers them. Deleting the final active project leaves an empty warehouse ready for use.

Earlier daily/monthly workbooks and saved projects are migrated once to a fixed per-shift rate using their previous production settings. Where direct pallet capacity existed without box quantities, it is represented as one box per pallet with a clear review notice. Review the packaging or import the new template. Missing current stock is kept unknown; the new eight-column input does not invent stock quantities or use them to override the required-pallet formula.

## Validation and source

Calculation tests cover selected-shift daily rounding, Stackability, shifts 1–3, per-part and overridden DOH, fractional/zero values, migration, invalid rows, actual/unrestricted ground depths and rack fit. DOM tests exercise live controls, the exact template, imports, downloads and project recovery. Flutter has matching calculation, workbook, persistence and widget tests. The final app is also checked for external asset dependencies.

- `webapp/`: browser UI, calculation engine, editors, Excel services and tests; ExcelJS 4.4.0 is bundled with its MIT license.
- `lib/`, `android/`, `test/`: Flutter implementation and tests. The ready-to-use deliverable is the Chrome HTML app; no Android APK is included.
- `tools/build_offline.py`: rebuild the self-contained HTML.
- `tools/write_template.cjs`: generate and verify the eight-column XLSX through the same service as the app.
- `tools/check_offline.py`: verify self-containment.
- `tools/preview_server.cjs`: development-only loopback preview, not required by the delivered file.

Run `node --test webapp/domain.test.cjs webapp/workbook.test.cjs webapp/app.test.cjs` for JavaScript tests. DOM tests use the development-only jsdom dependency in `.tooling/qa`. Run `flutter analyze` and `flutter test` with Flutter configured for the native source.
