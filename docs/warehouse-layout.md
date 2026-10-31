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
