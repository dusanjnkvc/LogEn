"""Resize the unchanged supplied logo into platform icon resources."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
with Image.open(root / 'assets/logen_logo.png') as logo:
    for density, size in [('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)]:
        target = root / f'android/app/src/main/res/mipmap-{density}/ic_launcher.png'
        logo.resize((size, size), Image.Resampling.LANCZOS).save(target)
    for filename, size in [('favicon.png', 48), ('icons/Icon-192.png', 192), ('icons/Icon-512.png', 512), ('icons/Icon-maskable-192.png', 192), ('icons/Icon-maskable-512.png', 512)]:
        logo.resize((size, size), Image.Resampling.LANCZOS).save(root / 'web' / filename)
