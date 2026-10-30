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

Floor stacking values in each row remain read-only. Use the three stacking modes in Part details to calculate by height, use imported factors, or apply one manual factor to every part. Existing saved factors and project state are preserved until a mode is chosen.

## Required-pallet formula

Required pallets = consumption per shift / parts per box / boxes per pallet × shifts per day × DOH.
Keep decimals throughout multiplication; round up only final required pallets. For example, 0.16 × 2 × 10 = 3.2 → 4 pallets. Physical floor positions, rows, rack bays and runs retain whole-capacity rounding. Choose 1, 2 or 3 shifts and per-part or overridden DOH.

## Space planning

Both storage methods use the same required whole-pallet count. Each part receives dedicated floor rows and rack bays; part numbers are not mixed within them. Height and pallet dimensions drive floor stacking and rack fit independently.

Current Chrome surface formulas (full precision internally, m² displayed to two decimals):

- GS net = deepest occupied lane depth × lane width × lane count / 1,000,000 (mm).
- GS allocated = GS net + lane width × lanes × physical gangway metres / 2000.
- PR net = required whole vertical rack bays × usable shelf length × depth / 1,000,000. Each bay ground footprint is counted once.
- PR allocated = PR net + required whole rack bays × (usable shelf length + structural length) in mm × physical gangway metres / 2000.

Lanes use existing row count, row width (pallet width + clearance), and deepest occupied row depth. Ground length is pallet length + clearance; occupied lane depth uses this adjusted length per position, with no additional gaps. A partial final row reserves a complete lane. Depth limit 0 remains unrestricted. Shelf capacity is the maximum grid capacity of both horizontal orientations, FLOOR(shelf L / unit L) × FLOOR(shelf D / unit W), with unit height fitting usable shelf height. Rotation, vertical stacking and two-deep storage default off. Required storage pallets are the required rack units, as requested; existing part L/W/H describe each unit. Bays = CEILING(required units / (units per slot × levels)). These are half-shared-gangway allocations, not physical layouts. Gangway input remains in mm, default 4500.

Part Details includes Rack YES/NO/N/A from exact pallet length/width versus usable rack slot length/depth. Rack storage options apply per type. Usable shelf dimensions already exclude required structure/clearance; these allowances are not applied a second time. Shelf surface available = bays × shelf footprint × levels; occupied = required units × unit footprint. Waste = available − occupied; per-level equivalent = waste / levels. Overall utilization is total occupied / total available, never a sum of percentages. Shelf waste is not unused floor space and is not subtracted from floor area. Legacy surface allowance is retained in saved data but is unused. Non-fitting pallet totals use required pallets, count duplicate part numbers only once by excluding duplicate planning rows, and flag unavailable quantities. Missing dimensions show N/A. The bounded table viewport has sticky headers/totals and one synchronized native horizontal scrollbar.

The Chrome/offline implementation is the delivered app. Flutter source under lib/ is a retained legacy implementation and has not been migrated to these new surface formulas.

## Saved data and project management

Chrome stores projects for this file in the current browser profile. Keep the HTML at the same location. Use **Projects → Download backup** before moving the file, changing devices or clearing browser data. JSON backups include active and deleted projects. A save warning means the current changes exist only in memory.

**Projects → Delete project** asks for confirmation. Deleted projects keep their inventory and settings in **Deleted projects**, where **Restore project** recovers them. Deleting the final active project leaves an empty warehouse ready for use.

Earlier daily/monthly workbooks and saved projects are migrated once to a fixed per-shift rate using their previous production settings. Where direct pallet capacity existed without box quantities, it is represented as one box per pallet with a clear review notice. Review the packaging or import the new template. Missing current stock is kept unknown; the new nine-column input does not invent stock quantities or use them to override the required-pallet formula.

## Validation and source

Calculation tests cover selected-shift daily rounding, Stackability, shifts 1–3, per-part and overridden DOH, fractional/zero values, migration, invalid rows, actual/unrestricted ground depths and rack fit. DOM tests exercise live controls, the exact template, imports, downloads and project recovery. Flutter has matching calculation, workbook, persistence and widget tests. The final app is also checked for external asset dependencies.

- `webapp/`: browser UI, calculation engine, editors, Excel services and tests; ExcelJS 4.4.0 is bundled with its MIT license.
- `lib/`, `android/`, `test/`: Flutter implementation and tests. The ready-to-use deliverable is the Chrome HTML app; no Android APK is included.
- `tools/build_offline.py`: rebuild the self-contained HTML.
- `tools/write_template.cjs`: generate and verify the nine-column XLSX through the same service as the app.
- `tools/check_offline.py`: verify self-containment.
- `tools/preview_server.cjs`: development-only loopback preview, not required by the delivered file.

Run `node --test webapp/domain.test.cjs webapp/workbook.test.cjs webapp/app.test.cjs` for JavaScript tests. DOM tests use the development-only jsdom dependency in `.tooling/qa`. Run `flutter analyze` and `flutter test` with Flutter configured for the native source.

Part calculation details include front and top rack diagrams. Preview limits of three bays/eight lower levels are labeled; totals always include all allocated bays and levels. Shelf waste is shown in total and as an equivalent per level, without reducing required floor footprint.

The rack icons on Overview open a shared shelf plan. Mixed part numbers share usable shelf rectangles using a deterministic packing heuristic (not a guaranteed optimum). Dashboard totals use complete physical bays for this shared plan. Part-level rows and diagrams remain explicitly standalone estimates. Excel Rack Calculations appends the shared bay/shelf/unit coordinates. Up to 10,000 units can be packed; larger inventories show an unavailable warning and retain standalone estimates. The shared overview bay selector provides access to every bay; total area always covers the complete plan.

Warehouse Settings → Rack structural allowances → Between boxes allowance (mm) sets horizontal gaps between rack units in both shelf directions. Default 0; no shelf-edge or vertical gap. Grid capacity uses FLOOR((usable dimension + gap) / (unit dimension + gap)); shared shelf placement reserves the same gaps. Box footprints remain unchanged, so gaps count as unused shelf surface.

Rack warehouse floor m² includes structural length and depth: bays × (usable shelf length + structural length allowance) × (usable shelf depth + structural depth allowance) / 1,000,000. Shelf capacity, utilization and unused shelf surface continue to use usable dimensions only. Example: 2700 × 1100 usable plus 150 × 200 structure = 2850 × 1300 = 3.705 m² per bay.

Rack with gangways follows the floor allocation rule: rack storage area plus a half-shared gangway strip along total bay frontage. Legacy rack pitch is no longer used.

Click a unit in the shared rack shelf diagram (or focus it and press Enter/Space) to show its PN, bay, shelf, box number, coordinates and placed dimensions. This only selects a diagram position and does not change inventory.

Click Required storage pallets to inspect required pallet counts that fit racks, do not fit, or need input review. The rack icon overview includes the same summary and a PN/quantity list for non-fitting and unresolved inputs. Unknown quantities and duplicate inputs are flagged instead of counted as zero or confirmed fit.

Export results also includes a separate Rack Layout worksheet listing every placed unit by bay, shelf, position, PN, quantity, and exact coordinates/dimensions. Non-fitting and unresolved input rows are listed separately.

Results exports include a Layout Graphic graphical worksheet with front views of vertical bays side by side and each pallet's Part Number inside its yellow box. Rack Layout retains the searchable allocation table without the X (mm) column. Graphical views are schematic and use the same saved shared allocation as the dashboard.

Layout Graphic shows four bays side by side per group, with levels in descending order and PN-labelled boxes on each shelf. Empty levels are shown; any extra row within a level represents units in shelf depth, not vertical stacking. This schematic uses the existing allocation unchanged.

Layout Graphic begins at E5 with no introductory text in A1–A3. Rack Layout omits both X and Y coordinate columns.

Part details provides floor stacking modes: calculate ROUNDDOWN(Maximum floor stacking height / pallet H), use imported Stacking, or one manual whole factor for all parts. All modes respect the height limit; imported factors remain saved when switching modes. Legacy projects retain their prior effective stacking until a mode is selected. Rack calculations and pallet demand are unaffected.

Warehouse Settings supports named rack types: the primary type plus additional types, each with usable dimensions, levels, structural allowances, between-box gap and maximum run length. Mixed allocation compares a simulated bay of every fitting type against remaining inventory. It favors higher occupied shelf percentage, then lower floor area per occupied surface and less unused surface. This deterministic heuristic is not a proof of the global minimum. Part rows show the most efficient standalone type; dashboard totals, bay overview and exports use the actual mixed-type bay allocation. Each exported bay/shelf identifies its type, and Warehouse Settings exports all configured types.

Near completion the mixed rack heuristic compares complete one- and two-bay finishes, preferring less floor area and unused surface, to avoid opening a small partial bay when a larger required bay can absorb those units. Up to 20 configured rack types are supported. A bounded packing effort reports an explicit unavailable warning rather than silently omitting inventory if a layout is excessively complex.

Current web checks: `node tools/check_floor_stacking.cjs`, `node tools/check_mixed_racks.cjs`, and `node tools/check_box_rack.cjs`. These cover the current calculation rules, controls, persistence, shared packing and Excel export.

## Rack storage options and categories

Each rack type can be deleted, including the primary type (which can be restored). Rotation prefers the shorter side along frontage when it fits, with fallback to the other orientation. Without rotation, entered L stays along frontage. Vertical stacking is opt-in, identical PN only, limited by usable shelf height. Front-to-back storage is opt-in and capped at two rows. Gaps apply horizontally, not between vertical layers. Shelf occupancy counts each stack base once. Mixed bay selection remains a feasible packing estimate.

The template includes Category; older eight-column inputs remain supported. The Category selector beside Required storage pallets scopes calculations, shared layouts and exports. Stored inventory remains complete, and duplicate validation spans the original project. Blank categories appear as Uncategorized.

Targeted validation: `node tools/check_rack_policies.cjs`, `node tools/check_box_rack.cjs`, `node tools/check_floor_stacking.cjs`, `node tools/check_mixed_racks.cjs`.

Between boxes allowance also reserves the same clearance at both frontage pillars. Frontage capacity = FLOOR((usable shelf length - gap) / (pallet frontage + gap)). Two 1200 mm pallets with 100 mm gaps need 2700 mm. Depth clearance remains between rows only; structural dimensions still add to warehouse floor area separately.

Rack rows are centered within each bay without changing capacity or gaps. The bundled ExcelJS VML writer includes a scoped note-anchor fallback (note.anchor) and 330 × 110 point comment shapes so proportional graphic columns do not squash box comments. Preserve this patch when upgrading the library.
