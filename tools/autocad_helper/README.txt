LogEn local AutoCAD helper — drawing layouts and PDF (version 4)

1. Extract ALL files from this ZIP to one folder on your Windows PC.
2. Install and activate licensed AutoCAD. Core Console and DWG To PDF.pc3 are required.
3. Double-click Start LogEn AutoCAD Helper.vbs. It runs in the background for this session.
4. In LogEn > Warehouse Designer, upload your warehouse DWG.
5. If Chrome asks, allow local network access for LogEn.

UPDATING: Stop the old LogEn helper process first, replace the complete extracted folder,
then start the new helper. LayoutJobs.ps1 and LayoutGeometry.lsp must remain beside the main script.
Do not close unrelated PowerShell processes. The helper is not installed at sign-in.

CREATE LAYOUT (GREENFIELD)
Select Greenfeild and the wall-storage permission, then click Create Layout.
Choose the actual closed straight 2D warehouse outline and confirm drawing units.
Classify drawing layers or individual objects as reference, blocked area, or door / exit.
Add reserved rectangles in mm for blocked areas that the reader cannot interpret.
Review all doors, exits, boundaries and obstacles before generating the layout.
Curved outlines are not usable boundaries in this version; add a straight closed outline in AutoCAD.
Blocks are conservatively reserved by their bounding rectangles; unreadable entities are reported.
Frozen/off layers and model-space geometry are read, but external reference contents are not resolved.
The preview is a simplified top view, not a complete rendering of every DWG entity.

LogEn uses the current Warehouse Designer Parts List and existing settings/results.
Racks have clean editable outlines and structural divisions, with internal PN position assignments.
Ground positions have PN, Size, QTY and Stacking labels. QTY is specific to that ground position.
Physical access aisles use the FULL configured gangway width. Unchecked wall storage reserves
that width around the whole boundary; checked wall storage removes the automatic perimeter aisle.
Move rows/runs by dragging or entering coordinates. Save edits on this device.
Partial placement is identified, with unplaced quantities and affected PNs; it is never marked complete.
This is a conservative arrangement, not a certified access plan or proof of an optimal warehouse layout.

Export layout DWG + PDF runs on a temporary COPY of the original DWG. Original uploaded geometry
is preserved. New editable LWPOLYLINE/LINE/TEXT entities use LOGEN_RACKS, LOGEN_GROUND_STORAGE,
LOGEN_LAYOUT_LABELS, LOGEN_CLEARANCES and LOGEN_GANGWAYS layers. Stable object IDs are attached as LOGEN_LAYOUT
XData. Re-exporting replaces only entities with that generated tag. Racks have no visible PN labels.
The resulting DWG downloads separately; use Download layout PDF for the plotted result.
Original DWG/PDF downloads remain separate from the generated layout.

CREATE PDF FROM DWG
This plots the original drawing, without adding storage geometry.
PDF settings: MODEL space, World/top view, extents, fit to A3 landscape, default plot style.
Missing external references/fonts, frozen layers and incompatible DWG versions can affect output.
Paper-space layouts are not plotted by this version.

The helper listens ONLY on 127.0.0.1:8765. It accepts the LogEn GitHub Pages origin,
local offline files and development localhost:8000. No cloud converter, Python or administrator
account is required. Windows PowerShell 5.1 is used. Company policies may disable scripts or
Core Console. Unblock extracted files in Properties if Windows blocks downloaded scripts.
Drawings are processed in temporary folders, removed after processing; the original is not modified.
DWG input limit: 100 MB. Layout export: up to 10,000 storage objects and 10,000 aisle strips.
One CAD job runs at a time, with a three-minute timeout.
Health status: http://127.0.0.1:8765/health (version must be 4 or later for layouts).

Custom AutoCAD installation:
powershell.exe -NoProfile -File .\LogEn-AutoCAD-Helper.ps1 -AutoCAD "C:\Your AutoCAD\accoreconsole.exe"

Drawings, generated layouts and PDFs stay in this browser on this device. JSON backups include
project settings, not these attachments. On another PC, start this helper there and upload the DWG again.
Save exported DWG/PDF copies before clearing browser data or moving PCs.

OPTIMIZER (VERSION 4)
Warehouse Designer offers Horizontal, Vertical or Automatic orientation, plus back-to-back
separation and wall clearance. The optimizer compares 32 bounded arrangements internally;
AutoCAD is invoked only to read the drawing or export the selected candidate.
Axes follow the dominant straight building edges, with an orthogonal vertical candidate.
Interior racks use paired rows; isolated rows are tried when a whole pair cannot fit.
Wall rows require approval of specific boundary edges in Create Layout.
Both candidates can be previewed, saved and exported individually as DWG or PDF.
Areas use polygon clipping at 0.1 mm precision. Remaining components use bounded footprint-fit
probes to distinguish potentially usable space from unusable space; these are planning estimates.
Safety constraints without sufficient drawing information remain UNVERIFIED. User confirmation
is recorded separately from geometry and access checks. This is not building-code certification.
New DWGs support arbitrary-angle closed polylines and oriented ground text. Racks remain unlabeled.
Old version 3 helpers cannot export optimized geometry. Replace all helper files and restart.
