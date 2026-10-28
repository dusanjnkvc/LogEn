"""Prepare the existing self-contained calculator for GitHub Pages."""
from pathlib import Path
import hashlib
import shutil

root = Path(__file__).resolve().parent.parent
source = root / "LogEn.html"
destination = root / "docs"
destination.mkdir(exist_ok=True)
shutil.copyfile(source, destination / "index.html")
(destination / ".nojekyll").write_text("", encoding="utf-8")
assert source.read_bytes() == (destination / "index.html").read_bytes()
print(f"GitHub Pages package ready: {source.stat().st_size:,} bytes")
print(f"SHA-256: {hashlib.sha256(source.read_bytes()).hexdigest()}")
