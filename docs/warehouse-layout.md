# Warehouse Designer drawing output

Create Layout uses the current Warehouse Designer Parts List and its existing rack/ground assignments. It does not introduce a separate demand formula.

1. Select Greenfeild and the wall-storage permission, then upload the warehouse DWG.
2. Click Create Layout. AutoCAD must be installed and the latest local LogEn helper running. A contextual download is offered if the helper is unavailable; it is also available under CAD connection inside the editor.
3. Select the actual closed straight 2D warehouse outline and drawing units. Classify layers or individual objects as reference, blocked area, or door/exit. Review unreadable geometry in AutoCAD; add missing reserved areas in the editor.
4. Generate from Parts List. Rack footprints include the selected rack type’s structural allowances; allocations remain attached internally to each bay. Ground rectangles contain PN, original L × W × H, the pallet quantity assigned to that position, and stacking.
5. Inspect required, generated and unplaced positions. Partial arrangements identify affected PNs. Move a row/run by dragging or editing coordinates; save edits locally. Zoom to position makes individual labels readable.
6. Download Output data creates one ZIP containing an editable DWG and an Excel workbook for the same saved layout. The workbook includes the Parts List, ground positions, rack bays, explicit rack allocations, validation and settings. A partial export is clearly named and requires acknowledgement. Inventory, settings or drawing changes require regeneration before output can be downloaded.

The former Local AutoCAD conversion block is replaced by Download Output data in Warehouse Designer. Original drawing/PDF downloads remain separate. The layout PDF can be downloaded from the editor after CAD export.

Floor pallets rotate 90° automatically when their length plus floor clearance cannot fit a positive maximum row depth but their width plus clearance can. For 2300 × 900 mm, a 2000 mm row depth and 100 mm clearance, the adjusted depth is 1000 mm and frontage is 2400 mm. If neither orientation fits, floor validation reports an error. Depth 0 remains unrestricted. Rack orientation rules are unchanged.

Physical aisles use the full configured gangway width. Unchecked wall storage reserves a perimeter aisle; checked wall storage removes that automatic perimeter reservation. This conservative placement algorithm may leave unused space. It reports incomplete placement and access conflicts rather than claiming an optimized or certified building layout.

AutoCAD works on a temporary copy and adds editable LINE/LWPOLYLINE/TEXT entities on separate LOGEN layers. Original entities are preserved. Generated entities carry stable LOGEN_LAYOUT XData IDs, so re-export removes only previously generated tagged entities. PDFs plot model-space extents to A3 landscape. The browser preview simplifies geometry; unreadable objects and unresolved external references require review. The reader supports straight closed polylines as boundaries, not arbitrary CAD topology.

The helper, drawing and layout remain local to the PC/browser. Export copies before clearing browser data or changing PCs. Project JSON backups do not contain DWG, PDF or generated-layout attachments.

## Orientation optimizer

Warehouse Designer now saves Warehouse Orientation (Automatic by default), Rack back-to-back separation (0 mm by default), and Wall clearance (0 mm by default) per project. Existing physical gangway and obstacle-clearance values remain authoritative. The drawing editor lets the user approve individual wall edges for single wall rows.

The optimizer generates both horizontal and vertical arrangements in a consistent building frame derived from the dominant straight boundary direction. For each orientation it searches four starting corners, two row lengths and two depth offsets. Runs respect each rack type’s maximum run length. Interior rows are paired with configured separation and outward-facing access; singles are tried when complete pairs cannot fit. Shared aisles and perimeter routes are merged geometrically rather than counted for each row. Both candidates remain available for preview, save and DWG/PDF export, including partial candidates that pass geometry checks.

Ranking rejects geometry/access violations, then compares accommodated required pallets, full coverage, unusable area, circulation area and block count. Area calculations use offline Clipper polygon boolean operations and offsets at 0.1 mm precision, including concave boundaries, clipped obstacles and holes. Unused components are classified using a bounded search for configured footprint fits. Narrow tails within an otherwise usable component may remain classified as potentially usable. This is a bounded heuristic, not proof of a global optimum.

The comparison reports warehouse/available/storage/gangway/clearance/free areas, pallet quantities, bay counts, utilization, complete placement and separate geometry/access and safety statuses. Fire and safety information not present in the drawing is unverified. The user must confirm required constraints; unreadable drawing entities retain an unverified status. Blocks and unsupported geometry use conservative bounds or require review. Automatic door, wall and fire-equipment semantics are not inferred.

The version 4 local helper writes editable rotated polygons on LOGEN_RACKS, LOGEN_GROUND_STORAGE, LOGEN_GANGWAYS, LOGEN_CLEARANCES and LOGEN_LAYOUT_LABELS, preserving the original drawing and replacing only tagged generated entities. Output Excel includes the selected scenario and comparison metrics. Inventory, demand, stacking and rack shelf-allocation formulas are unchanged.

Focused verification: `node webapp/layout-optimizer.test.cjs` covers paired racks, allocation identities, non-overlapping area partitions, rotated buildings, approved wall rows, shortages and a concave boundary. AutoCAD export is also checked with a synthetic warehouse drawing.
