"""Build the authenticated online edition for GitHub Pages."""
from pathlib import Path
import subprocess
root = Path(__file__).resolve().parent.parent
subprocess.run(["node", str(root / "tools/build_cloud.cjs")], cwd=root, check=True)
(root / "docs/.nojekyll").write_text("", encoding="utf-8")
