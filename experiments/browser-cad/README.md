# LogEn browser CAD — Phase A feasibility report

Recorded 2 November 2026.

**Result: genuine helper-free DWG read/write is feasible for the included sample on Windows Chrome. The complete acceptance gate is still open: physical Android Chrome and representative warehouse DWGs need validation before production integration.**

The isolated [test page](https://dusanjnkvc.github.io/LogEn/cad-proof.html) reads a synthetic warehouse DWG, adds two rack outlines and one ground-storage outline, and downloads a binary DWG. AutoCAD independently opened the Chrome download, found zero audit errors, edited a generated entity, saved the file, and reopened the edit. No production LogEn functionality was changed in this phase.

The browser experiment uses no AutoCAD, local helper, paid API or processing server. AutoCAD was used separately as a validation instrument after downloading the file. CAD processing also succeeded after stopping the local web server that initially served the page.

## Existing architecture reviewed

| Component | Current responsibility | Reuse during a future integration |
| --- | --- | --- |
| `webapp/domain.js` | Stock demand, stacking, floor/rack calculations and shared rack packing | Keep formulas and quantities unchanged |
| `webapp/layout.js` | Project layout data, source keys, CAD objects and labels | Reuse as the CAD adapter input |
| `webapp/layout-optimizer.js` | Local Greenfield placement, boundaries, obstacles, aisles, horizontal/vertical candidates | Reuse; no replacement optimizer required |
| `webapp/existing-layout.js` | Existing storage capacities, obstacles and explicit new-construction permission | Preserve defaults and allocation rules |
| `webapp/layout-ui.js` | Editable 2D layout and drawing-role selection | Reuse normalized geometry |
| `webapp/viewer-model.js`, `viewer-3d.entry.js` | Local 3D model, labels, selection and navigation | Keep saved-layout transfer intact |
| `webapp/workbook.js`, `output-zip.js` | Excel results and project-file packaging | Retain; later accept a browser-produced DWG |
| `webapp/app.js` | Project persistence and CAD request orchestration | Add a browser adapter only after the validation gate |

Currently, `app.js` communicates with the optional-to-be Windows helper using HTTP on `127.0.0.1:8765`. `/geometry` and `/geometry-existing` decode DWG drawings; `/layout` writes edited DWG/PDF output; `/convert` handles legacy plotting. The helper's PowerShell and AutoLISP use AutoCAD Core Console. The calculations, layout placement, Excel output and 3D rendering already run locally in the browser. The necessary replacement is the CAD file adapter, not the warehouse engine.

The existing production helper dependency has **not** been removed yet. The separate proof page does not read or change project storage, existing drawings, inventory or settings.

## Library evaluation and distribution implications

| Candidate | Capability evaluated | License / decision |
| --- | --- | --- |
| [acad-ts](https://github.com/node-projects/acad-ts), npm `@node-projects/acad-ts@3.7.0` | Pure TypeScript DWG reader and writer; ArrayBuffer input and binary output; actual browser proof completed | **Selected for this proof.** [MIT license](https://github.com/node-projects/acad-ts/blob/master/LICENSE) permits commercial distribution with its copyright and permission notice retained. The full notice is included in the standalone page and `THIRD-PARTY-LICENSE.txt`. No recurring CAD license/API fee is introduced. |
| [acadrust](https://github.com/hakanaktt/acadrust), inspected revision `e973e4f764f2f57bdbe89ba58a66781423b457df` | Rust reader/writer with browser/WASM build support | MPL-2.0. A potential alternative, not compiled or included here. Distribution of covered files requires notice/source compliance; see [Mozilla's MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/). It must not be described as obligation-free. |
| [dwgdxf](https://github.com/ducflair/dwgdxf/), npm `2.0.1` | Downloaded package's WASM exposes DWG-to-DXF conversion | The wrapper advertises MIT, but its shipped interface has no DWG writer. It cannot satisfy final DWG export by itself. Underlying dependency notices also require review. |
| [LibreDWG](https://www.gnu.org/software/libredwg/) and [libredwg-web bindings](https://github.com/mlightcad/libredwg-web/blob/master/bindings/javascript/README.md) | Free DWG tools and browser bindings; writing requires an appropriate build | GPLv3+. Not incorporated. Browser/worker separation is not treated as removing GPL obligations for a future closed-source distribution. |
| [ODA Drawings inWEB](https://www.opendesign.com/files/2025-07/ODA%20Complete%20Interoperability%202025.pdf) | Commercial DWG web technology | Membership/licensing does not meet the requested zero ongoing CAD cost constraint. Not added. |

The chosen package and build tool are pinned in `package-lock.json`. The proof adds no runtime CDN or external library requests. A future dependency upgrade requires another license and compatibility check.

## Independent validation evidence

The synthetic source is an AC1032 DWG with millimetre units (`INSUNITS=4`). Its warehouse boundary spans `(1000, 2000)` to `(41000, 62000)`, so the test detects accidental recentering or unit changes. It includes two closed polylines, a door line, a circle, TEXT, MTEXT, a named block INSERT and an aligned DIMENSION measuring 40,000 mm.

| Check | Observed result |
| --- | --- |
| Browser execution | Windows Chrome 156, dedicated local JavaScript worker |
| Source model-space entities | 8 |
| Downloaded DWG model-space entities | 11: original 8 plus 3 closed polylines |
| Added rack 1 | `(4000, 6000)`, size `2850 × 1400 mm`, layer `POC_RACKS` |
| Added rack 2 | `(4000, 11900)`, size `2850 × 1400 mm`, layer `POC_RACKS` |
| Added ground location | `(12000, 6000)`, size `1300 × 1100 mm`, layer `POC_GROUND` |
| Original geometry | Model-space coordinates, text, block reference, circle radius and dimension measurement matched the independent source report |
| Units and binary format | Preserved millimetres; genuine `AC1032` output, 13,355 bytes |
| Independent reader | Installed AutoCAD 2021 Core Console, separate from the browser writer |
| Drawing audit | 0 errors found, 0 fixed |
| Editability | Ground outline changed to `POC_GROUND_EDITED`, saved, and the changed layer verified after a fresh AutoCAD reopen |
| Processing without server | Succeeded with the page server stopped; browser reports 186 ms for this small sample |
| Phone-size UI | Checked at 390 × 844 CSS pixels in desktop Chrome; controls adapt to two-column metrics and full-width downloads |
| Physical Android Chrome | **Not tested.** Desktop viewport testing is not an Android device test |

This small-file CAD benchmark does not measure the production warehouse optimizer or predict performance for large warehouse drawings.

The evidence checker compares AutoCAD's measurements, not a second read by the same library. Files in `evidence/` include the untouched Chrome download, browser report, source/exported/reopened AutoCAD geometry and audit summary. `check-evidence.cjs` reproduces the recorded comparisons. The validation script always opens disposable copies to protect its inputs.

## Known limits and remaining acceptance work

The sample generated eight reader notifications concerning unsupported `ACDBDETAILVIEWSTYLE` / `ACDBSECTIONVIEWSTYLE` objects and missing related dictionary entries. Full fidelity of those metadata objects is **not** established. The dimension's DXF group-70 flags changed from 33 to 1; its geometry and 40,000 mm measurement remained correct. This difference is explicitly recorded by the evidence checker.

The library's [documentation](https://github.com/node-projects/acad-ts/blob/master/docs/README.md) describes broader version support and its [TODO list](https://github.com/node-projects/acad-ts/blob/master/todos.md) records remaining gaps. The only version independently validated here is **AC1032**. Dynamic blocks, external references, proxy/custom entities, Civil/Architecture objects, meshes/solids, custom dimensions/styles, complex XData/dictionaries and paper-space plotting are not production-validated by this sample. The preview only draws supported line, circle and polyline geometry. Other/unspecified units are rejected by this proof rather than silently rescaled. PDF generation is outside this DWG feasibility test.

This is a fixed three-outline CAD test, not an integrated Parts List layout generator or 3D viewer. The existing Greenfield/Existing Layout, Excel, calculations and 3D modules were not modified; their integration regressions must be tested during Phase B/D. No claim is made that the full requested mobile application update is complete.

The bundled-file import and downloads were executed in real Windows Chrome. File-picker automation encountered a ChatGPT extension permission restriction, so manual file selection remains part of the device acceptance checklist. That testing restriction is separate from ordinary app use, which needs no ChatGPT extension. The automation tool's instruction was: “To enable file upload, open chrome://extensions, click Details under the ChatGPT browser extension, and enable \"Allow access to file URLs.\" See [here](https://developers.openai.com/codex/app/chrome-extension#upload-files) for details.” No extension setting was changed.

Before replacing production CAD requests:

1. On an actual Android phone/tablet, open the test page, run the sample, download the DWG/report, then import a copy of a test DWG through the native file picker. Repeat with no Windows PC/helper running.
2. Independently inspect those downloads in AutoCAD, including coordinates, text, dimensions, blocks and editability.
3. Test representative real warehouse drawings and required entities/versions, with explicit unsupported-object handling before any export can lose original data.
4. Integrate behind a browser CAD adapter with the existing Windows helper available as a deliberate fallback. Preserve drawing units, original entities, generated layer tags and repeated-export behavior. Retain all existing placement/calculation rules.
5. Exercise Greenfield and Existing Layout, new-construction permissions, quantities, Excel/project downloads and 2D-to-3D transfer, plus Android memory/interaction limits.

## Run or rebuild the isolated proof

Open [the published proof](https://dusanjnkvc.github.io/LogEn/cad-proof.html), then **Run sample DWG** and **Download edited DWG**. The page contains the library and sample, so processing requires no runtime network connection after loading. It never uploads the chosen drawing. A CSP blocks connections; the worker also disables fetch, XMLHttpRequest, WebSocket and importScripts. File processing is capped at 20 MB / 20,000 model-space entities with a 30-second worker deadline.

For a reproducible local build, use Node 18 or later:

```powershell
cd experiments/browser-cad
npm ci --ignore-scripts --no-audit --no-fund
npm run build
node check-evidence.cjs
```

The build writes only `docs/cad-proof.html` and the copied MIT notice. AutoCAD is not a build or runtime dependency. `validate-autocad.ps1` is an optional Windows **test instrument**, not an app helper. Its `ConsolePath` parameter can point to an installed Core Console for independent validation. Full app integration is intentionally pending the remaining Phase A checks.
