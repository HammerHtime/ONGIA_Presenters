# French versions of the two certificate designs: the English wording lifted off and the French set in Lato,
# in the same colours, sizes and places. Usage: python3 -I make.py <certs dir> <out dir> <fonts dir>
import sys
from PIL import Image, ImageDraw, ImageFont

SRC, OUT, FONTS = sys.argv[1], sys.argv[2], sys.argv[3]
F = lambda w, s: ImageFont.truetype(f"{FONTS}/lato-{w}.ttf", s)
M = lambda w, s: ImageFont.truetype(f"{FONTS}/mont-{w}.ttf", s)


def tracked(d, xy, text, font, fill, track=0):
    """Text with letter-spacing (track, in px), left-aligned at xy, top of capitals at xy[1]."""
    x, y = xy
    top = font.getbbox("H")[1]
    for ch in text:
        d.text((x, y - top), ch, font=font, fill=fill)
        x += font.getlength(ch) + track
    return x


def cap_size(weight, cap_px, face=None):
    """The font size whose capital H is cap_px tall."""
    f = (face or F)(weight, 100)
    b = f.getbbox("H")
    return round(100 * cap_px / (b[3] - b[1]))


def line(d, xy, text, font, fill):
    """Plain text with the top of its capitals at xy[1]."""
    d.text((xy[0], xy[1] - font.getbbox("H")[1]), text, font=font, fill=fill)


def wipe(d, box, fill=(255, 255, 255)):
    d.rectangle(box, fill=fill)


# ---- generic -------------------------------------------------------------------------------------------------
im = Image.open(f"{SRC}/ongia-generic.jpg").convert("RGB")
d = ImageDraw.Draw(im)
NAVY, NAVY2, GOLD, GREY = (16, 40, 76), (33, 44, 74), (203, 160, 50), (52, 52, 52)
wipe(d, (2075, 470, 2275, 720))                         # CERTIFICATE -> CERTIFICAT: the last E goes
wipe(d, (160, 750, 1420, 895))                          # OF COMPLETION
tracked(d, (183, 770), "DE RÉUSSITE", F(700, cap_size(700, 104)), NAVY2, 2)
wipe(d, (160, 1140, 1100, 1225))                        # PROUDLY PRESENTED TO
tracked(d, (182, 1159), "DÉCERNÉ À", F(700, cap_size(700, 49)), GOLD, 3)
wipe(d, (160, 1870, 1400, 1965))                        # For their successful completion of the
f = F(700, 66)
d.text((183, 1886 - f.getbbox("F")[1]), "Pour avoir réussi la formation", font=f, fill=GREY)
wipe(d, (160, 2645, 640, 2725))                         # Date Issued
line(d, (178, 2662), "Date de délivrance", F(400, cap_size(400, 41)), GREY)
wipe(d, (160, 2990, 820, 3130))                         # Andrew Hammond, / ONGIA President: both reset in one face
line(d, (178, 3002), "Andrew Hammond,", F(400, cap_size(400, 41)), GREY)
line(d, (178, 3066), "président d’ONGIA", F(400, cap_size(400, 41)), GREY)
im.save(f"{OUT}/ongia-generic-fr.jpg", quality=92)

# ---- National Gang Summit (the banner is the event's name and stays as designed) ----------------------------------
im = Image.open(f"{SRC}/national-gang-summit.jpg").convert("RGB")
d = ImageDraw.Draw(im)
HEAD, BLACK, TEXT = (36, 60, 88), (8, 10, 11), (53, 53, 53)
wipe(d, (140, 1990, 2120, 2105))                        # CERTIFICATE OF COMPLETION
tracked(d, (157, 2006), "CERTIFICAT DE RÉUSSITE", M(700, cap_size(700, 89, M)), HEAD, 2)
wipe(d, (140, 2140, 950, 2210))                         # PROUDLY PRESENTED TO
tracked(d, (154, 2153), "DÉCERNÉ À", M(700, cap_size(700, 46, M)), BLACK, 1)
wipe(d, (140, 2610, 1600, 2760))                        # For their successful completion ... (two lines)
f = F(400, 62)
asc = f.getbbox("F")[1]
d.text((152, 2625 - asc), "Pour avoir réussi une formation spécialisée dans le", font=f, fill=TEXT)
d.text((152, 2696 - asc), "domaine du crime organisé et des gangs de rue.", font=f, fill=TEXT)
wipe(d, (140, 3015, 560, 3085))                         # Date Issued
line(d, (150, 3029), "Date de délivrance", F(400, cap_size(400, 40)), (56, 57, 57))
wipe(d, (690, 3015, 1300, 3155))                        # Andrew Hammond, / ONGIA President: both reset in one face
line(d, (703, 3030), "Andrew Hammond,", F(400, cap_size(400, 40)), (56, 57, 57))
line(d, (703, 3097), "président d’ONGIA", F(400, cap_size(400, 40)), (56, 57, 57))
im.save(f"{OUT}/national-gang-summit-fr.jpg", quality=92)
print("ok")
