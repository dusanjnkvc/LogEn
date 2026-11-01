# 3D viewer

Generate and save a warehouse layout in Warehouse Designer, then choose **3D viewer** below Warehouse Designer. Both Greenfield and Existing Layout are supported. This is a read-only view of the structured geometry and allocations used for DWG output; it never changes placements or demand calculations.

Each successful layout save retains an inventory, settings and drawing snapshot. Changes to parts, settings, stacking, DWG, storage policy or drawing setup mark the model outdated until a new layout is generated and saved. Old compatible layouts can use the cached drawing; if the required drawing metadata is unavailable, reopen Create Layout and save the layout.

Orbit: left-drag to rotate, right-drag to pan, wheel/pinch to zoom. Double-click an object to focus. Walk/Fly: select the navigation mode, focus the canvas, use WASD and drag to look; Q/E change elevation in Fly. Movement speed is adjustable; touch movement buttons are available. Escape returns to Orbit. Top, Isometric, Front, Fit, Reset and Full Screen controls are provided.

Click a pallet to inspect its PN, unique position, rack/bay/level or ground row, stack layer and packaging capacity. The current input does not record actual contents of each pallet: the total actual quantity in a location is explicitly shown as **Not recorded**, while parts-per-box × boxes-per-pallet is labelled capacity. Empty/reserved fixed slots and free shelf regions are selectable; free mixed-pallet shelf area is not converted to an invented number of empty pallet positions.

Search finds all matching PN/location objects, highlights matches, dims unrelated storage, and offers individually selectable results. PN labels are attached to front/back faces; labels hide at a distance to reduce clutter. Location labels are optional and their texture atlases load on demand. Controls hide rack structures, ground pallets, walls, empty locations, obstacles/doors and gangways.

Rendering uses meters; source coordinates and calculations stay in mm. Original local frames, reflections, row rotation and allocation x/y/z are transformed to world coordinates. Ground stacks contain exactly the assigned pallet quantity. Existing racks remain visible even when empty. Red flags show detected pallet bounds/height/shelf-fit/overlap issues; they do not modify inventory.

2D CAD normally lacks verified wall, door and obstacle elevations. Their displayed height uses Maximum floor stacking height unless a source height exists; wall profile/door frame appearance is schematic. Rack elevations use configured usable shelf height and structural height allowance. Source rack envelopes and pallet dimensions remain exact; the structural profile is a visualization within the configured envelope. The model notes disclose these assumptions.

## Offline build

The renderer bundles pinned Three.js 0.180.0 and OrbitControls under the MIT license. No CDN, paid API or server is needed to view a saved scene. Modern WebGL2 hardware acceleration is required.

```powershell
npm install --prefix .tooling/viewer-build --no-audit --no-fund three@0.180.0 esbuild@0.25.10
node tools/build_viewer.cjs
python tools/build_offline.py
python tools/build_pages.py
```

The committed renderer bundle supports ordinary app builds without npm. Rebuild it when editing viewer-3d.entry.js. Viewer-model tests exercise exact quantities, both layout orientations, stacking, existing empty racks, unique selection IDs and read-only source behavior.

## Shelf inspection and forklift preview

Click an orange shelf beam or shelf surface for usable length/depth, slot height, elevation, bay, level and allocated count. Click an upright for that rack type's usable/overall dimensions, levels, structural allowances, gaps and storage options. Empty regions also show their parent shelf dimensions.

Placement warnings have a hover/focus explanation plus an expandable panel for touch screens. Each message gives the measured value and an adjustment path (e.g. Warehouse settings → Floor storage & gangways → Maximum floor stacking height for the current building-height limit).

Mouse-wheel zoom, orbit/pan and Walk/Fly look sensitivity default to 2× and can be adjusted. Full screen is available in the toolbar and directly over the canvas.

The schematic forklift is 1.2 × 2.8 × 2.15 m. It follows a continuous route inside the saved gangways, avoiding rack footprints, ground pallets, walls and obstacles with a conservative circular turning envelope. It uses the largest connected section, drives out and back, and can be paused, reset, focused, followed and speed-adjusted. Animation is paused initially for reduced-motion preferences. If no route fits, it reports the reason and does not drive through storage. This visualization does not perform traffic/capacity analysis or change warehouse calculations.

Ground position outlines retain their dedicated row dimensions even when rows move together in a back-to-back pair. Ground locations are unique across the combined block. The inspector distinguishes back-to-back pairs from single wall rows.

Continuous ground lanes display the same center line as the CAD export. Selecting a ground position shows its full continuous row dimensions and pallet/PN totals, with the per-pallet half clearance and maximum depth from the back line; the selected position retains its own quantity and PN.
