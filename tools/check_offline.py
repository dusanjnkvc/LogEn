"""Verify that the deliverable has no external asset dependencies."""
from html.parser import HTMLParser
from pathlib import Path
import re

root = Path(__file__).resolve().parent.parent
html = (root / 'LogEn.html').read_text(encoding='utf-8')

class OfflineCheck(HTMLParser):
    def __init__(self):
        super().__init__()
        self.scripts = 0
        self.images = 0
        self.csp = ''

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'script':
            self.scripts += 1
            assert 'src' not in attrs, 'External script dependency'
        if tag == 'img':
            self.images += 1
            assert attrs.get('src', '').startswith('data:image/'), 'External image dependency'
        if tag == 'link':
            assert attrs.get('href', '').startswith('data:'), 'External linked dependency'
        if tag == 'use':
            assert attrs.get('href', '').startswith('#'), 'External SVG dependency'
        if tag == 'meta' and attrs.get('http-equiv', '').lower() == 'content-security-policy':
            self.csp = attrs.get('content', '')

check = OfflineCheck()
check.feed(html)
assert check.scripts == 1 and check.images == 1
assert "connect-src 'none'" in check.csp
assert not re.search(r'__(LOGO|STYLES|SCRIPTS)__', html)
style = re.search(r'<style>(.*?)</style>', html, re.S).group(1)
assert not re.search(r'@import|url\(\s*[\'"]?https?:', style, re.I)
print('Offline package verified: inline code, styles, Excel library and logo; no external asset dependency; network connections blocked by CSP.')
