# Icons and share image

The files in `public/` are rendered from these sources. `favicon.svg` is hand-written and lives in `public/` directly.

```bash
# Share image, 1200×630 (needs Chrome and a network connection for the Chivo font)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --hide-scrollbars \
  --window-size=1200,630 --virtual-time-budget=5000 \
  --screenshot=public/og-image.png scripts/og/og-image.html

# Home-screen icon, and favicon.ico for browsers and crawlers that don't take SVG
rsvg-convert -w 180 -h 180 scripts/og/apple-touch-icon.svg -o public/apple-touch-icon.png
rsvg-convert -w 16 public/favicon.svg -o /tmp/fav16.png && rsvg-convert -w 32 public/favicon.svg -o /tmp/fav32.png
magick /tmp/fav16.png /tmp/fav32.png public/favicon.ico
```
