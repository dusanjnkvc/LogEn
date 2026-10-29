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

Required pallets = consumption per shift / parts per box / boxes per pallet × shifts per day × DOH.
No daily or final pallet rounding. For example, 1.25 × 2 × 5 = 12.5 pallets. Physical floor positions, rows, rack bays and runs retain whole-capacity rounding. Choose 1, 2 or 3 shifts and per-part or overridden DOH.

## Space planning

Both storage methods use the same required whole-pallet count. Each part receives dedicated floor rows and rack bays; part numbers are not mixed within them. Height and pallet dimensions drive floor stacking and rack fit independently.

Current Chrome surface formulas (full precision internally, m² displayed to two decimals):

- GS net = deepest occupied lane depth × lane width × lane count / 1,000,000 (mm).
- GS allocated = GS net + lane width × lanes × physical gangway metres / 2000.
- PR net = required whole rack bays × rack surface allowance (default 4.125 m²).
- PR allocated = required whole rack bays × rack pitch (default 3300 mm) × physical gangway metres / 2000. PR net is not added.

Lanes use existing row count, row width (pallet width + clearance), and deepest occupied row depth. A partial final row reserves a complete lane. Depth limit 0 remains unrestricted. Bay quantity retains existing CEILING(required pallets / capacity per bay); the allocation formula itself supports fractional quantities but does not change existing bay sizing. These are half-shared-gangway allocations, not physical layouts. Gangway input remains in mm, default 4500.

Part Details includes Rack YES/NO/N/A from exact pallet length/width versus usable rack slot length/depth. The existing rotation setting defaults off and is preserved. Height and clearance restrictions remain independent eligibility checks. Non-fitting pallet totals use required pallets, count duplicate part numbers only once by excluding duplicate planning rows, and flag unavailable quantities. Missing dimensions show N/A. The bounded table viewport has sticky headers/totals and one synchronized native horizontal scrollbar.

The Chrome/offline implementation is the delivered app. Flutter source under lib/ is a retained legacy implementation and has not been migrated to these new surface formulas.

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
