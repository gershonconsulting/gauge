# Draws the Gauge mark (white gauge on #FE1B04 rounded square, same as extension/icons) at 1024 px
# and writes the site's browser-tab icons. Run: python3 tools/make-site-icons.py  (needs Pillow)
import math, os
from PIL import Image, ImageDraw
S = 1024
RED = (254, 27, 4, 255)
root = os.path.join(os.path.dirname(__file__), '..', 'site')
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=RED)
cx, cy, r, w = S / 2, S * 0.60, S * 0.32, int(S * 0.115)
d.arc([cx - r, cy - r, cx + r, cy + r], 180, 360, fill='white', width=w)
for a in (180, 360):  # round caps
    x, y = cx + (r - w / 2) * math.cos(math.radians(a)), cy + (r - w / 2) * math.sin(math.radians(a))
    d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill='white')
ang = math.radians(-55)
nx, ny = cx + r * 0.62 * math.cos(ang), cy + r * 0.62 * math.sin(ang)
d.line([cx, cy, nx, ny], fill='white', width=int(S * 0.07))
n = S * 0.035
d.ellipse([nx - n, ny - n, nx + n, ny + n], fill='white')
h = S * 0.075
d.ellipse([cx - h, cy - h, cx + h, cy + h], fill='white')
big = lambda s: img.resize((s, s), Image.LANCZOS)
big(32).save(os.path.join(root, 'favicon-32.png'))
big(180).save(os.path.join(root, 'apple-touch-icon.png'))
big(192).save(os.path.join(root, 'icon-192.png'))
big(512).save(os.path.join(root, 'icon-512.png'))
big(256).save(os.path.join(root, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)])
print('site icons written')
