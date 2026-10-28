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

The eight-column template does not specify floor stacking. New imports therefore default to **one pallet high**. The part editor has an advanced permitted-stacking field for cases where stacking is physically allowed. Exports include an optional Stacking column when needed to preserve a manually changed stacking value on re-import; the download template remains exactly eight columns.

## Required-pallet formula

```text
Rounded pallets per shift = ROUNDUP(Consumption per shift / QTY in Box / QTY boxes per Pallet, 0)
Required pallets = Rounded pallets per shift × DOH × shifts per day
```

The rounding order is intentional: round one shift first, then multiply by DOH and shifts. For example, 1,000 parts/shift ÷ 20 parts/box ÷ 40 boxes/pallet = 1.25 pallets/shift, rounded to 2. With 5 DOH and 2 shifts/day, the answer is **20 pallets**, rather than 13 from rounding only the combined parts total. If fractional DOH produces a fractional final count, that count is rounded up to whole storage pallets.

Choose **1, 2 or 3 shifts per day** (default 2). Use **DOH from each part** or a project DOH override. Editing the override immediately applies it to all parts; choose the per-part source to return to the Excel values. Changing shifts multiplies daily usage while the entered consumption per shift remains fixed. All four space results update automatically.

The default template sample (20 parts/box, 40 boxes/pallet, 500 parts/shift, 5 DOH, two shifts) requires **10 pallets**. At 1200 × 800 × 1000 mm, one-high floor storage and the default warehouse settings, the four footprints are **11.34 / 27.54 / 7.98 / 33.63 m²**.

## Space planning

Both storage methods use the same required whole-pallet count. Each part receives dedicated floor rows and rack bays; part numbers are not mixed within them. Height and pallet dimensions drive floor stacking and rack fit independently.

Ground storage-only area uses actual occupied depths of full and partial rows, including between-pallet clearances. The configured ground depth is a row-capacity limit; **0 means unrestricted**. Rack depth and fit rules are independent. Gangway-inclusive results are allocated planning estimates rather than an optimized physical layout. Shared gangways count once in a physical design.

Use **Shift consumption** for raw and rounded per-shift demand, input and used DOH, daily demand, required pallets and space. Click a part number for substituted formulas. **Export results** creates Original Input Data, Floor Pallet Calculations, Rack Calculations, Warehouse Comparison and Warehouse Settings. Original legacy source cells are retained in a separate source-data section of the input sheet.

## Saved data and project management

Chrome stores projects for this file in the current browser profile. Keep the HTML at the same location. Use **Projects → Download backup** before moving the file, changing devices or clearing browser data. JSON backups include active and deleted projects. A save warning means the current changes exist only in memory.

**Projects → Delete project** asks for confirmation. Deleted projects keep their inventory and settings in **Deleted projects**, where **Restore project** recovers them. Deleting the final active project leaves an empty warehouse ready for use.

Earlier daily/monthly workbooks and saved projects are migrated once to a fixed per-shift rate using their previous production settings. Where direct pallet capacity existed without box quantities, it is represented as one box per pallet with a clear review notice. Review the packaging or import the new template. Missing current stock is kept unknown; the new eight-column input does not invent stock quantities or use them to override the required-pallet formula.

## Validation and source

Calculation tests cover the inner rounding order, shifts 1–3, per-part and overridden DOH, fractional/zero values, migration, invalid rows, actual/unrestricted ground depths and rack fit. DOM tests exercise live controls, the exact template, imports, downloads and project recovery. Flutter has matching calculation, workbook, persistence and widget tests. The final app is also checked for external asset dependencies.

- `webapp/`: browser UI, calculation engine, editors, Excel services and tests; ExcelJS 4.4.0 is bundled with its MIT license.
- `lib/`, `android/`, `test/`: Flutter implementation and tests. The ready-to-use deliverable is the Chrome HTML app; no Android APK is included.
- `tools/build_offline.py`: rebuild the self-contained HTML.
- `tools/write_template.cjs`: generate and verify the eight-column XLSX through the same service as the app.
- `tools/check_offline.py`: verify self-containment.
- `tools/preview_server.cjs`: development-only loopback preview, not required by the delivered file.

Run `node --test webapp/domain.test.cjs webapp/workbook.test.cjs webapp/app.test.cjs` for JavaScript tests. DOM tests use the development-only jsdom dependency in `.tooling/qa`. Run `flutter analyze` and `flutter test` with Flutter configured for the native source.
