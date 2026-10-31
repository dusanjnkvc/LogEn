"""Build a single, self-contained Chrome file. No runtime server is required."""
from pathlib import Path
import base64
import re
import io
import zipfile

ROOT = Path(__file__).resolve().parent.parent
source = ROOT / 'webapp'
logo = 'data:image/png;base64,' + base64.b64encode((ROOT / 'assets/logen_logo.png').read_bytes()).decode('ascii')
scripts = []
for path in [source / 'vendor/exceljs.min.js', source / 'vendor/clipper.js', source / 'domain.js', source / 'workbook.js', source / 'editors.js', source / 'layout.js', source / 'layout-optimizer.js', source / 'layout-ui.js', source / 'output-zip.js', source / 'app.js']:
    script = path.read_text(encoding='utf-8')
    script = re.sub(r'(?m)^//# sourceMappingURL=.*$', '', script)
    scripts.append(script.replace('</script', '<\\/script'))
html = (source / 'index.html').read_text(encoding='utf-8')
html = html.replace('__STYLES__', (source / 'styles.css').read_text(encoding='utf-8'))
html = html.replace('__LOGO__', logo).replace('__SCRIPTS__', '\n;\n'.join(scripts))
helper_buffer = io.BytesIO()
with zipfile.ZipFile(helper_buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
    for helper in sorted((ROOT / 'tools/autocad_helper').iterdir()):
        if helper.is_file():
            entry=zipfile.ZipInfo(helper.name, (2026, 10, 30, 0, 0, 0))
            entry.compress_type=zipfile.ZIP_DEFLATED
            archive.writestr(entry, helper.read_bytes())
html=html.replace('__AUTOCAD_HELPER__',base64.b64encode(helper_buffer.getvalue()).decode('ascii'))
license_text = (source / 'vendor/LICENSE').read_text(encoding='utf-8')
html += '\n<!-- Bundled ExcelJS 4.4.0 — MIT License\n' + license_text.replace('--', '—') + '\n-->\n'
destination = ROOT / 'LogEn.html'
destination.write_text(html, encoding='utf-8')

with destination.open('a',encoding='utf-8') as output:
    output.write('\n<!-- Clipper license\n'+(source/'vendor/CLIPPER-LICENSE.txt').read_text(encoding='utf-8')+'\n'+(source/'vendor/JSBN-LICENSE.txt').read_text(encoding='utf-8')+'\n-->')

print(f'Built {destination} ({destination.stat().st_size:,} bytes)')
