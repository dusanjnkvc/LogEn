# Warehouse drawing recognition — implementation report

Updated 2 November 2026.

LogEn now reads supported DWG/DXF geometry locally in a browser worker, previews detected storage regions and classified objects, and feeds separate storage/movement restrictions into the existing placement and 3D systems. Recognition uses geometry, names and project-local corrections. It does not guarantee automatic interpretation of every customer's CAD conventions or certify a warehouse's safety.

## Previous detection problem

The previous editor required one manually chosen closed straight polyline. Other drawing objects defaulted to a single blocked-area role. Connected LINE/open-polyline enclosures were not reconstructed, INSERT geometry could be reduced to bounding boxes, and pedestrian circulation had no separate classification. That combination made valid Layer 0 enclosures difficult to identify and conflated storage exclusions with physical movement barriers.

All valid closed areas on Layer 0 are usable storage by default, as requested. They are selected together as “All Layer 0 usable areas”, including saved projects that previously selected only one Layer 0 outline. Separate areas are combined as a polygon union: overlapping space is counted once and the space between separate outlines is not invented as storage. Older Layer 0 classifications are migrated once to the new usable-area convention; corrections made afterwards remain editable and persistent. Holes and obstacle exclusions on their respective layers still apply. Text and dimensions do not become storage areas. Uncertain enclosures on other unclassified layers continue to require confirmation. White objects and locked-layer geometry are not discarded.

## Modules and functions changed

| File | Changes |
| --- | --- |
| `webapp/cad-reader.entry.mjs` | `readGeometry`: binary DWG / supported DXF reading; units; LINE, polyline, arc/circle sampling; recursive 2D INSERT transforms and inherited layers; stable hexadecimal CAD handles; unsupported-entity diagnostics |
| `webapp/warehouse-geometry.js` | `prepare`, `loops`, `role`, `analyze`: enclosure reconstruction, normalized layer recognition, project-local aliases/overrides, polygon validation and region/zone calculations |
| `webapp/app.js` | `uploadDrawing` analyzes/caches on upload and opens preview when the planning project is valid; `createPhysicalLayout` uses local geometry and offers a deliberate Windows fallback; DXF files accepted; newly uploaded existing warehouses reset new construction to OFF |
| `webapp/layout-ui.js` | Detection preview, counts and areas, region confirmation, layer/object corrections, line-wall thickness, joining tolerance, pedestrian minimum, door clearance/types and crossing review controls |
| `webapp/layout.js` | Interpreted environment adapter and source-key invalidation; demand/stacking formulas unchanged |
| `webapp/layout-optimizer.js` | Multiple/concave polygon zones, separate movement and storage masks, existing route reuse, region-aware circulation, six area measurements, connectivity status and safety gating |
| `webapp/existing-layout.js` | Recognized infrastructure remains fixed; empty capacity allocated as before; storage restrictions separated from movement restrictions during optional expansion |
| `webapp/viewer-model.js`, `viewer-forklift.js`, `viewer-3d.entry.js` | Classified surfaces, actual region rings/holes, movement masks and crossing permissions transferred to the saved scene; physical obstacles stay impassable |
| `tools/autocad_helper/LayoutJobs.ps1` | DXF import via DXFIN in a disposable empty DWG, retained/selected drawing units and genuine DWG SAVEAS output |
| `tools/autocad_helper/LogEn-AutoCAD-Helper.ps1` | Helper version 7 identifies DXF export support; existing DWG export remains compatible |
| `tools/build_cad_reader.cjs`, `tools/build_offline.py`, vendor bundles | Pinned offline CAD reader, embedded worker and license; updated standalone/Pages app |

`webapp/domain.js` and `webapp/workbook.js` are byte-identical to the previously published version. No inventory, demand, stacking, rack-capacity or footprint formulas were changed. No user project or original drawing was rewritten by this update.

## Recognition and geometry

The parser preserves CAD coordinates, reads drawing units, expands supported nested block transforms, and samples supported curves conservatively. Unknown units require a manual selection. Non-planar/unsupported geometry is reported rather than silently described as understood.

Closed usable-area polygons take precedence. Boundary polygons and unambiguous degree-two LINE/open-polyline loops provide further enclosures. Wall-line loops define interiors while their actual lines remain physical walls, using the thickness entered by the user. Ambiguous branches, incomplete loops and invalid/self-intersecting polygons require correction; the system does not invent a room across missing edges. Multiple disjoint enclosures are supported without a fixed region count. Holes/courtyards have an explicit role and are excluded from both floor and route geometry.

Layer matching ignores capitalization, spaces and separators and recognizes singular/plural conventions, including `PEDESTRIAN_GANGWAYS`, `Pedestrian_gangway` and `WALKWAYS`. Canonical roles include boundary, usable area, courtyard/hole, wall, pillar, door, pedestrian walkway, forklift gangway, restricted zone, crossing, installed racks/ground storage, unclassified obstacle and reference. Aliases and corrections belong to the project/drawing, not a global customer dictionary. Entity overrides take precedence and saved block overrides propagate to expanded children.

Polygon clipping uses the existing bundled Clipper implementation at 0.1 mm coordinate precision. It unions intersecting exclusions before subtraction, preserves disconnected rings/holes and clips zones to the recognized regions. Curve tessellation introduces an additional approximation; polygon precision is not a claim that every CAD curve is exact.

The preview reports gross identified usable area, fixed/no-storage exclusions and net eligibility before new aisles. The candidate comparison also reports new aisle area, placed storage footprint and remaining unoccupied area. These are floor areas, not the multiplied capacity of rack levels.

## Storage and movement rules

Physical walls and pillars block storage and forklift movement. Restricted zones prohibit storage and forklift travel by default. Installed storage stays available to the existing-capacity allocator in Existing Layout mode; its footprint is not free floor for new construction.

Pedestrian polygons prohibit all generated storage at their original width. Their width is not replaced by the warehouse forklift aisle width. A pillar overlapping a pedestrian polygon is valid source geometry: the pillar remains fixed, the walkway remains fixed, and the unobstructed pedestrian polygon/area is calculated by difference. A separately entered pedestrian minimum triggers a conservative passage warning if erosion removes or disconnects the required clear passage. It is not a complete pedestrian egress analysis.

An existing forklift-route or explicitly classified crossing polygon intersecting a pedestrian zone creates a crossing candidate. It requires site safety confirmation, transverse geometry within the configured aisle width, and no physical obstruction. Approval removes only that crossing patch from the pedestrian forklift restriction; it never permits storage there. A longitudinal pedestrian-only route cannot be approved as a crossing. A physical pillar remains blocked even inside an approved patch. Newly generated aisles retain the configured forklift gangway width.

Door types are classified independently: unknown, pedestrian, forklift, loading or emergency. Unknown/pedestrian/emergency openings do not become forklift passage automatically. Door clearance is a separate entered value. Geometry alone does not establish visibility, traffic priority, turning capability or site safety; crossings and unrecognized objects remain review items.

## Greenfield, Existing Layout and 3D

Greenfield uses the same Parts List allocation, rack types/levels, floor stacking settings, wall permissions and bounded horizontal/vertical search. Storage must fit the recognized eligible polygons and its required access faces must remain clear. Shortages retain PN, pallet and area information. Disconnected networks are reported and remain unverified; fitting a rectangle is not treated as proof of safe access.

Existing Layout recognizes fixed installed racks/ground positions and forklift routes. Empty/reserved/allocated occupancy and rack configuration controls remain available. New construction defaults OFF on each upload and stays hidden in Greenfield. Expansion, when explicitly enabled, uses storage masks for new footprints and movement masks for their route connections. Pedestrian/pillar overlaps are not blanket infrastructure-overlap errors.

The viewer receives region rings, holes, PN/quantity/location data, classified zones and movement masks. It renders pedestrian/restricted surfaces separately from physical pillars/walls. The schematic forklift routing graph respects the same restrictions. Its vehicle envelope is a preview model, not an engineering vehicle/turning certification.

## Tests executed

The release run executed **29 browser-code test scripts: 26 passed and 3 pre-existing scripts failed**. All **42 focused recognition checks** passed: 29 geometry/placement checks, 7 CAD parsing checks, 3 upload/cache/preview checks and 3 routing checks.

Coverage includes rectangular, L-shaped and irregular regions; three separate regions; internal/open wall lines; multiple doors; pillars; pillars inside walkways; approved and unapproved crossings; longitudinal pedestrian travel rejection; overlapping restricted zones; existing empty rack allocation; Layer 0; locked/white geometry; layer aliases; reconstructed LINE/open-polyline loops; nested block rotation/scale and inherited layers; units; holes; insufficient capacity; storage exclusion numerical assertions; 3D masks and PN preservation. A provided customer drawing was also checked locally and in the private browser preview; it is not included in the repository.

```powershell
node webapp/warehouse-geometry.test.cjs
node webapp/cad-reader.test.cjs
node webapp/recognition-ui.test.cjs
node webapp/recognition-routing.test.cjs
python tools/check_offline.py
```

The remaining failing legacy scripts are `app.test.cjs` (21 passed / 20 failed), `domain.test.cjs` (10 / 26) and `workbook.test.cjs` (5 / 13). The previously published controller reproduces the identical 20 failing UI test cases. Domain and workbook implementation hashes are unchanged. Those existing calculation/test issues were not hidden by changing formulas or removing assertions. The entire suite is **not** claimed green.

Independent AutoCAD checks executed separately from the browser:

- Native AutoCAD DXF → recognized Parts List layout → genuine AC1032 DWG and PDF: 112 generated entities, millimetres retained; exported DWG reopened with 120 model entities and **0 audit errors / 0 repaired**.
- Existing DWG export repeated twice: original three fixture entities remained unchanged; generated entity count was 58 on each export, with PDF output.
- Offline package verification passed: embedded scripts, styles, logo, Excel library and CAD reader; no runtime asset CDN.

## Usage and limits

Upload a DWG or DXF in Warehouse Designer. Layer 0 closed areas are all selected together automatically. Review the detected regions and colored geometry, confirm any remaining unlabelled candidates on other layers or classify them, enter real wall/passages/door settings and correct roles where needed. Generate from Parts List and review both orientations, connectivity, warnings and unplaced demand. Review existing rack types/bays before allocation in Existing Layout mode.

DWG/PDF export continues through the existing local AutoCAD workflow. DXF export requires the updated version-7 helper from the app. Browser-only DWG writing remains the separate feasibility experiment; it is not silently substituted for the validated export path. No paid cloud service was added. The bundled reader is pinned `@node-projects/acad-ts@3.7.0` under MIT, with its full notice included in `webapp/vendor/CAD-READER-LICENSE.txt` and the bundle.

Physical Android testing has not been executed. Complex/custom/proxy entities, non-planar CAD, external references, ambiguous wall/door conventions and branching line networks may need explicit classification, additional source outlines or the Windows fallback. Reader notices are exposed and incomplete interpretation prevents a fully verified result. Automatic classification is assistance, not proof that arbitrary customer drawings have been understood correctly. The saved original CAD file is retained for export.

## Layer 0 selection correction

The boundary selector now groups Layer 0 areas instead of offering each as a separate warehouse side. A saved single Layer 0 selection and legacy Layer 0 reference/obstacle classifications migrate to the combined usable regions once on opening; generation and saved layouts use the same combined geometry. Regenerate old layouts to include all areas.

Targeted regression coverage in `webapp/layer-zero.test.cjs` verifies four separate squares, saved-boundary migration, overlapping areas counted once, no storage in gaps, pillars/walkways/restricted exclusions, explicit object corrections, text handling, reconstructed Layer 0 line loops, placement in all four areas, the combined selector and saved options. The 29 geometry/placement checks and upload/routing checks were rerun for this correction. Demand and footprint formulas remain unchanged.

Nested closed contours on the same physical-wall layer now use alternating outer/inner faces. Only the wall band blocks storage and movement; its enclosed warehouse is not a solid obstacle. Open wall lines still use the entered thickness. A focused regression checks that Layer 0 storage enclosed by paired wall contours remains available.

## Storage around pillars and independent clearances

Create Layout now saves separate clearances per project: pillars default to 1,000 mm, entrance/door clearance defaults to the configured gangway width, and extra restricted-area/pedestrian clearances default to zero. Each value is measured outward from the source object's edge. Other obstacle/wall clearance remains separate and is not added a second time to the pillar distance. Clearance bands are previewed and are excluded from generated storage. Physical pillar size remains unchanged.

When a long rack run does not fit, the search tries smaller bays and back-to-back pairs across every usable region. It tests actual clipped polygons instead of jumping past the bounding rectangle of a wall or a clearance zone. Ground lanes can resume on the other side of a cleared pillar without reserving an extra full cross-aisle at that pillar break; loading faces remain clear. No pallet or rack footprint is allowed inside the configured buffers. Existing fixed infrastructure remains fixed and is flagged if it conflicts with a clearance.

Storage-region edges are no longer presumed to be physical building walls. An explicit building boundary, or supported outer wall contours containing the usable regions, defines the building. In 3D, usable-region boundaries remain floor geometry. Under the user's drawing convention, the unqualified layer `Gangway` / `Gangways` defaults to pedestrian floor space; explicitly named forklift routes and saved manual classifications still use their selected roles. Approved crossing review remains separate.

Validation for this correction passed the 29 geometry checks, 14 targeted layout/viewer/upload/routing regression scripts and the new `webapp/storage-clearance.test.cjs` checks (independent buffers, UI persistence, lower-region rack recovery, pillar breaks and no pedestrian divider wall). The current customer workspace was checked locally without changing its saved projects or publishing its inventory/drawing. Demand and footprint calculation files remain unchanged. Regenerate an old layout to apply the new geometry rules and clearances.


## Larger browser CAD drawings

The local browser reader supports up to 100,000 interpreted CAD objects and 2,000,000 geometry points, with a 120-second worker timeout. These limits include expanded block contents. Exceeding a limit rejects the entire import; it never silently returns a truncated drawing. Supported DWG and DXF files continue to be read locally without the AutoCAD helper. Detailed curves and blocks can use more memory than plain lines. This increase does not add support for unsupported CAD entity types. Geometry caches from reader version 3 are refreshed on the next import/preview.
