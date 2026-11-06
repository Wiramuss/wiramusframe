"""Sentetik relic ödül ekranları üretir (OCR testleri için). Oyun kurulu olmadan
boru hattını sınamak içindir; gerçek ekran görüntüleri tests/fixtures/real/ altına konabilir.

python scripts/gen_fixtures.py [adet=40] [tohum=7]
Çıktı: tests/fixtures/generated/*.png + truth.json
"""
import json, os, random, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "fixtures", "generated")
N = int(sys.argv[1]) if len(sys.argv) > 1 else 40
rnd = random.Random(int(sys.argv[2]) if len(sys.argv) > 2 else 7)
os.makedirs(OUT, exist_ok=True)

g = json.load(open(os.path.join(ROOT, "resources", "gamedata.json"), encoding="utf-8"))
rewards = [g["items"][r] for r in g["rewardRefs"] if r in g["items"]]
prime = [r for r in rewards if "Prime" in r["name"]["en"] or "Forma" in r["name"]["en"]]

FONTS = ["C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/bahnschrift.ttf"]
THEMES = [(235, 235, 235), (230, 196, 120), (190, 220, 255), (255, 210, 160), (200, 255, 220)]
RES = [(1920, 1080), (2560, 1440), (1280, 720), (3440, 1440), (1920, 1080), (1920, 1080)]


def wrap(draw, text, font, maxw):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=font) <= maxw or not cur:
            cur = t
        else:
            lines.append(cur)
            cur = w
    lines.append(cur)
    return lines


def background(w, h):
    img = Image.new("RGB", (w, h), (rnd.randint(5, 30), rnd.randint(8, 30), rnd.randint(12, 40)))
    d = ImageDraw.Draw(img)
    for _ in range(25):  # oyun sahnesi gibi bulanık lekeler
        x, y, r = rnd.randint(0, w), rnd.randint(0, h), rnd.randint(40, 300)
        c = tuple(rnd.randint(20, 120) for _ in range(3))
        d.ellipse([x - r, y - r, x + r, y + r], fill=c)
    img = img.filter(ImageFilter.GaussianBlur(25))
    dark = Image.new("RGB", (w, h), (0, 0, 0))
    return Image.blend(img, dark, 0.45)


def tr_upper(s):
    return s.replace("i", "İ").replace("ı", "I").upper()


def make(i):
    w, h = rnd.choice(RES)
    ui = rnd.choice([1.0, 1.0, 0.9, 1.1, 0.8])
    s = h / 1080 * ui
    lang = rnd.choice(["tr", "tr", "en"])
    upper = rnd.random() < 0.15
    count = rnd.choice([4, 4, 4, 3, 2, 1])
    picks = rnd.sample(prime, count)
    font = ImageFont.truetype(rnd.choice(FONTS), max(10, int(19 * s)))
    color = rnd.choice(THEMES)
    img = background(w, h)
    d = ImageDraw.Draw(img)
    slot = 242 * s
    cx = w / 2
    y_icon = h * 0.30 + rnd.uniform(-0.01, 0.01) * h
    y_text = h * 0.415 + rnd.uniform(-0.012, 0.012) * h
    for k, it in enumerate(picks):
        x0 = cx + (k - count / 2) * slot
        ic = tuple(rnd.randint(90, 230) for _ in range(3))
        d.rounded_rectangle([x0 + slot * 0.25, y_icon, x0 + slot * 0.75, y_icon + slot * 0.42],
                            radius=int(10 * s), fill=ic)
        name = it["name"][lang]
        if upper:
            name = name.upper() if lang == "en" else tr_upper(name)
        lines = wrap(d, name, font, slot * 0.92)
        lh = int(23 * s)
        for j, line in enumerate(lines):
            tw = d.textlength(line, font=font)
            d.text((x0 + (slot - tw) / 2, y_text + j * lh), line, font=font, fill=color)
    if rnd.random() < 0.5:
        img = img.filter(ImageFilter.GaussianBlur(rnd.uniform(0.2, 0.6)))
    fname = f"reward_{i:03d}.png"
    img.save(os.path.join(OUT, fname))
    return {"file": fname, "lang": lang, "w": w, "h": h, "uiScale": ui, "upper": upper,
            "names": [p["uniqueName"] for p in picks]}


truth = [make(i) for i in range(N)]
json.dump(truth, open(os.path.join(OUT, "truth.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"{N} görüntü -> {OUT}")
