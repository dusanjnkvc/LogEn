LogEn local AutoCAD PDF helper

1. Extract this ZIP to a folder on your Windows PC.
2. Install and activate licensed AutoCAD (Core Console and DWG To PDF.pc3 are required).
3. Double-click Start LogEn AutoCAD Helper.vbs. The helper runs in the background for this session.
4. In LogEn > Implementation, upload DWG and click Create PDF from DWG.
5. If Chrome asks, allow local network access for LogEn. Download PDF after conversion completes.

No Python, cloud converter or Windows administrator account is required. Windows PowerShell 5.1 is used. If Windows blocks downloaded scripts, unblock the extracted files in their Properties first. Company policy can disable scripts or Core Console; contact your administrator in that case.

The helper listens only on 127.0.0.1:8765. It accepts the LogEn GitHub Pages origin, local offline files and development localhost:8000. Drawings are processed in temporary folders and removed after conversion. The original DWG is never modified. This is a session-only service; it does not install or run at sign-in. Close its powershell.exe process in Task Manager to stop it, or restart Windows. Do not close other unrelated PowerShell processes.

Conversion: MODEL space, World/top view, extents, fit to A3 landscape PDF. It preserves the drawing's default plot style. Frozen layers, missing external references/fonts, empty model space and incompatible DWG versions can affect output. This is the original uploaded drawing, not a generated layout containing LogEn racks. Paper-space layouts are not exported by this version.

If AutoCAD is installed in a custom directory, start PowerShell in this folder and run:
powershell.exe -NoProfile -File .\LogEn-AutoCAD-Helper.ps1 -AutoCAD "C:\Your AutoCAD\accoreconsole.exe"

Health status: open http://127.0.0.1:8765/health . Only one conversion runs at a time; the size limit is 100 MB and timeout is 3 minutes. A valid PDF must be returned before LogEn saves it.

On another PC, start this helper there too, and upload the DWG again. Browser project JSON backups do not include DWG or PDF attachments.
