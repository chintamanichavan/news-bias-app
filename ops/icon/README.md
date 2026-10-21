# App icon

The Artha icon is a raised white अ (first letter of अर्थ) on an Apple News
red tile, rendered in Blender by `render_icon.py`.

The font is Noto Sans Devanagari ExtraBold (SIL Open Font License). It is not
kept in the repo; download it from
<https://github.com/notofonts/notofonts.github.io/tree/main/fonts/NotoSansDevanagari/hinted/ttf>.

To redraw every size, from this directory:

    F=NotoSansDevanagari-ExtraBold.ttf
    W=../../frontend
    r() { blender -b --factory-startup -P render_icon.py -- --font $F "$@"; }
    r --out $W/app/icon1.png --size 32 --glyph 0.6 --depth 0.09
    r --out $W/app/icon2.png --size 192
    r --out $W/app/apple-icon.png --size 180 --shape bleed
    r --out $W/public/icon-maskable-512.png --size 512 --shape bleed --glyph 0.42

Then `systemctl --user restart news-bias-web` to rebuild and serve them.

## Loading animation

`render_loader.py` renders the same tile flipping over, as one strip of 24
frames. The app plays it with the `.artha-loader` rule in `globals.css`.

    r() { blender -b --factory-startup -P render_loader.py -- --font $F "$@"; }
    r --out $W/public/artha-loader.png

If the frame count changes, change `steps(24)` and the `* -24` in that rule.
