"""Build a single, self-contained Chrome file. No runtime server is required."""
from pathlib import Path
import base64
import re

ROOT = Path(__file__).resolve().parent.parent
source = ROOT / 'webapp'
logo = 'data:image/png;base64,' + base64.b64encode((ROOT / 'assets/logen_logo.png').read_bytes()).decode('ascii')
scripts = []
for path in [source / 'vendor/exceljs.min.js', source / 'domain.js', source / 'workbook.js', source / 'editors.js', source / 'app.js']:
    script = path.read_text(encoding='utf-8')
    script = re.sub(r'(?m)^//# sourceMappingURL=.*$', '', script)
    scripts.append(script.replace('</script', '<\\/script'))
html = (source / 'index.html').read_text(encoding='utf-8')
html = html.replace('__STYLES__', (source / 'styles.css').read_text(encoding='utf-8'))
html = html.replace('__LOGO__', logo).replace('__SCRIPTS__', '\n;\n'.join(scripts))
license_text = (source / 'vendor/LICENSE').read_text(encoding='utf-8')
html += '\n<!-- Bundled ExcelJS 4.4.0 — MIT License\n' + license_text.replace('--', '—') + '\n-->\n'
destination = ROOT / 'LogEn.html'
destination.write_text(html, encoding='utf-8')
print(f'Built {destination} ({destination.stat().st_size:,} bytes)')
