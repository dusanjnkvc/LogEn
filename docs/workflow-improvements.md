# Layout workflow improvements

The browser editions remain local-only and use the existing inventory calculations unchanged.

- A dedicated offline Blob worker runs the same bounded layout search; UI controls remain responsive. Cancel terminates the worker and preserves the previous layout. Use best so far accepts the best completed candidate, clearly showing when both axes were not fully compared.
- Physical totals above the drawing show required, placed and unplaced pallets, storage m², storage-eligible utilization and storage plus actual aisles. These are separate from the Overview planning allocations.
- Click blank drawing space to inspect obstacle/clearance, circulation, outside-boundary or unused-area classifications. Unused space is not claimed to be impossible to fill.
- Existing snap, Undo/Redo and live validation remain. Shift-select movable rows or bays and use Align selection to align edges or centres; fixed infrastructure cannot be aligned.
- Projects offers a complete ZIP backup and an inventory-only JSON export. ZIP archives include original drawings, structured editable layouts, saved binary exports and generated Excel reports when available. Restore checks every manifest SHA-256, then adds copies with new IDs; existing projects are preserved. Missing native DWG/PDF exports require the existing CAD export workflow to generate them. Browser backup itself does not require AutoCAD.
- The six-step workflow bar links import, settings, assignments, generation, review and export. It wraps on mobile. Advanced drawing setup remains expandable.
- Forklift previews use connected aisle geometry, right-side travel targets and centre merging before turns. Envelope checks prevent crossing aisle boundaries and overlapping other vehicles; vehicles yield when blocked. Movement is illustrative and does not establish traffic capacity or travel-time results.

## Verification

Focused browser checks cover event-loop responsiveness, real Generate and Cancel controls, accepting an early candidate, physical summaries, complete archive download and copy restore, binary types, corrupt-file rejection, account isolation, and 390/768/1440 px layouts. Manual editing, large ground layouts (400 PNs / 2,400 pallets), existing infrastructure, Overview assignment sync, CAD upload recovery, 3D quantities, forklift driving and two-way passing also pass.

Historical domain/workbook suites have 39 failures against older rounding, template and area expectations. Both source files and both test files are byte-identical to the preceding published commit b52e3cf; these expectations were not altered in this UI/workflow release. The current demand formulas are preserved.
