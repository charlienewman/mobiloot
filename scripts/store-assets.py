#!/usr/bin/env python3
"""dApp Store listing art, written to docs/store/: icon-512.png and banner-1200x600.png.
Needs google-chrome and Pillow.   python3 scripts/store-assets.py
"""
import subprocess, tempfile
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs/store"
OUT.mkdir(parents=True, exist_ok=True)

# Icon: the app icon, downscaled. No transparency allowed by the store.
Image.open(ROOT / "app/assets/images/icon.png").convert("RGB").resize((512, 512), Image.LANCZOS).save(OUT / "icon-512.png")

wordmark = (ROOT / "logo/mobiloot-wordmark.svg").read_text()
fonts = (ROOT / "site/assets/fonts").as_uri()
html = f"""<!doctype html><meta charset="utf-8"><style>
@font-face {{ font-family: 'Space Grotesk'; src: url('{fonts}/SpaceGrotesk.woff2') format('woff2'); font-weight: 300 700; }}
html, body {{ margin: 0; }}
body {{ width: 1200px; height: 600px; overflow: hidden; background: #0C0D10; position: relative;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 34px;
  font-family: 'Space Grotesk', sans-serif; color: #F4F1EA; }}
.glow {{ position: absolute; width: 760px; height: 760px; border-radius: 50%; filter: blur(120px); opacity: 0.16; }}
.a {{ background: #D7FF44; left: -260px; top: -380px; }}
.b {{ background: #1FE4D7; right: -300px; bottom: -460px; opacity: 0.13; }}
svg {{ width: 640px; height: auto; position: relative; }}
p {{ margin: 0; font-size: 40px; font-weight: 500; letter-spacing: -0.8px; position: relative; }}
p span {{ color: #D7FF44; }}
</style><div class="glow a"></div><div class="glow b"></div>{wordmark}
<p>Your phone bill, <span>paid by your stake.</span></p>
<script>document.fonts.ready.then(() => document.title = 'ready')</script>"""
with tempfile.TemporaryDirectory() as tmp:
    page = Path(tmp) / "banner.html"
    page.write_text(html)
    subprocess.run(
        ["google-chrome", "--headless=new", "--no-sandbox", "--hide-scrollbars", "--force-device-scale-factor=1",
         "--virtual-time-budget=3000", "--window-size=1200,600", f"--screenshot={OUT / 'banner-1200x600.png'}", page.as_uri()],
        check=True, capture_output=True,
    )
Image.open(OUT / "banner-1200x600.png").convert("RGB").save(OUT / "banner-1200x600.png")
for f in ("icon-512.png", "banner-1200x600.png"):
    im = Image.open(OUT / f)
    print(f, im.size, im.mode)
