import sys
# The CFAOC certificate design: the CFAOC artwork (the one Andrew sent on 4 Nov 2026) across the top of the National
# Gang Summit page, in English and French. Run: python3 scripts/make-cfaoc-cert.py <artwork> public/assets/certs public/assets/certs
from PIL import Image
src, certs, out = sys.argv[1], sys.argv[2], sys.argv[3]
BAND = 1792
art = Image.open(src).convert("RGB")
W = 2550
h = round(art.height * W / art.width)
art = art.resize((W, h), Image.LANCZOS)
band = Image.new("RGB", (W, BAND))
top = (BAND - h) // 2
# Extend the artwork's own background: its first row upward, its last row downward.
band.paste(art.crop((0, 0, W, 1)).resize((W, top)), (0, 0))
band.paste(art.crop((0, h - 1, W, h)).resize((W, BAND - top - h)), (0, top + h))
band.paste(art, (0, top))
# The sentence ends at "Organized Crime" (Andrew 4 Nov 2026: 'take out "and Street Gangs"'): the rest of its second line
# is whited out and the line's own full stop moved up after "Crime" ("organisé" in French). Pixels on the 2550 x 3300 page.
LINE = (2680, 2760)
CUT = {  # first pixel to white out, the full stop's columns, where the full stop goes
    "cfaoc.jpg": (930, (1386, 1398), 935),          # "…Organized Crime| and Street Gangs."
    "cfaoc-fr.jpg": (875, (1403, 1415), 879),       # "…crime organisé| et des gangs de rue."
}
for name, base in (("cfaoc.jpg", "national-gang-summit.jpg"), ("cfaoc-fr.jpg", "national-gang-summit-fr.jpg")):
    page = Image.open(f"{certs}/{base}").convert("RGB")
    page.paste(band, (0, 0))
    start, (p0, p1), at = CUT[name]
    stop = page.crop((p0, LINE[0], p1, LINE[1]))
    page.paste((255, 255, 255), (start, LINE[0], 1500, LINE[1]))
    page.paste(stop, (at, LINE[0]))
    page.save(f"{out}/{name}", quality=88, optimize=True, dpi=(300, 300))
    print(name, page.size)
