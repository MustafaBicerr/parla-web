#!/usr/bin/env python3
"""
Font Awesome Free 6.4.0 — yalnızca portalın kullandığı simgelerden oluşan yerel alt küme (UX-48, ALT-18, SEC-27).

Tam paket (172 KB CSS+yazı tipi, 3. taraf CDN, SRI yok) yerine ~15 KB'lık yerel dosya üretir:
  assets/vendor/fontawesome/fa-subset.css
  assets/vendor/fontawesome/fa-solid-subset.woff2

Kullanım (yeni simge eklendiğinde yeniden çalıştırın; tests/unit/fa-subset.test.mjs eksik simgeyi yakalar):
  pip install fonttools brotli
  (cd docs/manuals && npm install)          # @fortawesome/fontawesome-free kaynağı
  python3 assets/vendor/fontawesome/build-subset.py

Lisans: simgeler CC BY 4.0, yazı tipi SIL OFL 1.1, kod MIT — https://fontawesome.com/license/free
"""
import glob, os, re, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
FA = os.environ.get("FA_DIR") or os.path.join(ROOT, "docs/manuals/node_modules/@fortawesome/fontawesome-free")
OUT = os.path.dirname(os.path.abspath(__file__))
SOURCES = [
    os.path.join(ROOT, "assets/js/support-v2/**/*.js"),
    os.path.join(ROOT, "support-v2/**/*.html"),
]
UTILITY = {"fa-spin", "fa-fw", "fa-subset", "fa-solid-subset"}  # animasyon / sabit genişlik; son ikisi dosya adı

css = open(os.path.join(FA, "css/all.css"), encoding="utf8").read()
# `.fa-foo::before, .fa-bar::before { content: "\f0f3"; }` kalıpları
icon_cp = {}
for sel, cp in re.findall(r"((?:\.fa-[a-z0-9-]+::?before\s*,?\s*)+)\{\s*content:\s*\"\\([0-9a-f]+)\"", css):
    for name in re.findall(r"\.(fa-[a-z0-9-]+)::?before", sel):
        icon_cp[name] = cp

used = set()
for pattern in SOURCES:
    for path in glob.glob(pattern, recursive=True):
        text = open(path, encoding="utf8").read()
        used.update(re.findall(r"\b(fa-[a-z0-9-]+)\b", text))
extra = os.environ.get("FA_EXTRA", "")
used.update(x for x in extra.split(",") if x)

icons = sorted(n for n in used if n in icon_cp)
unknown = sorted(n for n in used if n not in icon_cp and n not in UTILITY)
if unknown:
    print("UYARI: FA sürümünde bulunmayan ya da simge olmayan sınıflar (yok sayıldı):", ", ".join(unknown), file=sys.stderr)

codepoints = sorted({icon_cp[n] for n in icons})
font_in = os.path.join(FA, "webfonts/fa-solid-900.woff2")
font_out = os.path.join(OUT, "fa-solid-subset.woff2")
subprocess.check_call([
    "pyftsubset", font_in, "--unicodes=" + ",".join("U+" + c for c in codepoints),
    "--flavor=woff2", "--layout-features=", "--no-hinting", "--output-file=" + font_out,
])

rules = "\n".join(f'.{n}::before{{content:"\\{icon_cp[n]}"}}' for n in icons)
out = f"""/*! Font Awesome Free 6.4.0 (yerel alt küme) — https://fontawesome.com
 * License - https://fontawesome.com/license/free (Icons: CC BY 4.0, Fonts: SIL OFL 1.1, Code: MIT License)
 * Copyright 2023 Fonticons, Inc.
 * Bu dosya build-subset.py ile üretilir; elle düzenlemeyin. {len(icons)} simge. */
@font-face{{font-family:"Font Awesome 6 Free";font-style:normal;font-weight:900;font-display:swap;src:url("fa-solid-subset.woff2") format("woff2")}}
.fa,.fas,.fa-solid{{-moz-osx-font-smoothing:grayscale;-webkit-font-smoothing:antialiased;display:inline-block;font-style:normal;font-variant:normal;line-height:1;text-rendering:auto;font-family:"Font Awesome 6 Free";font-weight:900}}
.fa-fw{{text-align:center;width:1.25em}}
.fa-spin{{animation:fa-spin 2s linear infinite}}
@keyframes fa-spin{{0%{{transform:rotate(0)}}to{{transform:rotate(360deg)}}}}
@media (prefers-reduced-motion:reduce){{.fa-spin{{animation-duration:6s}}}}
{rules}
"""
open(os.path.join(OUT, "fa-subset.css"), "w", encoding="utf8").write(out)
print(f"{len(icons)} simge, yazı tipi {os.path.getsize(font_out)} bayt, css {len(out)} bayt")
