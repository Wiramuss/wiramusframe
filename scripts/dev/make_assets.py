"""Geliştirme varlıkları: uygulama ikonu (özgün) + sentetik örnek envanter (DE formatında).
python scripts/dev/make_assets.py
"""
import json, os, random, time
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
rnd = random.Random(42)

# ---- ikon: koyu zemin üstünde altın, kesik köşeli kristal ----
S = 512
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle([16, 16, S - 16, S - 16], radius=96, fill=(13, 17, 23, 255), outline=(39, 49, 66, 255), width=8)
d.polygon([(256, 84), (392, 220), (256, 428), (120, 220)], fill=(227, 176, 75, 255))
d.polygon([(256, 84), (392, 220), (256, 250)], fill=(244, 206, 120, 255))
d.polygon([(120, 220), (256, 250), (256, 428)], fill=(176, 128, 40, 255))
d.line([(120, 220), (256, 250), (392, 220)], fill=(26, 19, 6, 255), width=6)
img.save(os.path.join(ROOT, "resources", "icon.png"))

# ---- örnek envanter ----
g = json.load(open(os.path.join(ROOT, "resources", "gamedata.json"), encoding="utf-8"))
items = g["items"]
rewards = [r for r in g["rewardRefs"] if items.get(r, {}).get("tradable")]
relics = [u for u, r in g["relics"].items() if r["tier"] != "Requiem"]
misc = [{"ItemType": r, "ItemCount": rnd.randint(1, 4)} for r in rnd.sample(rewards, 120)]
misc += [{"ItemType": u + rnd.choice(["Bronze", "Bronze", "Silver", "Gold", "Platinum"]), "ItemCount": rnd.randint(1, 8)}
         for u in rnd.sample(relics, 40)]
m = g["masterables"]


def equip(kind, n, xp_unit):
    pool = [x for x in m if x["kind"] == kind]
    return [{"ItemType": x["uniqueName"], "XP": rnd.choice([0, xp_unit * 100, xp_unit * 900, xp_unit * 900]),
             "ItemId": {"$oid": "%024x" % rnd.getrandbits(96)}} for x in rnd.sample(pool, min(n, len(pool)))]


suits = equip("warframe", 25, 1000)
longg, pist, mel = equip("primary", 30, 500), equip("secondary", 25, 500), equip("melee", 30, 500)
xpinfo = [{"ItemType": x["ItemType"], "XP": max(x["XP"], 450000 if x in suits else 225000)}
          for x in rnd.sample(suits + longg + pist + mel, 60)]
recipes = list(g["recipes"].items())
pending = [{"ItemType": r["blueprint"], "CompletionDate": {"$date": {"$numberLong": str(int((time.time() + rnd.randint(-3600, 72 * 3600)) * 1000))}}}
           for _, r in rnd.sample(recipes, 4)]
attrs = list(g["rivenAttrs"].keys())
weap = list(g["rivenWeapons"].keys())
ups = []
for _ in range(5):
    tags = rnd.sample(attrs, 4)
    fp = {"compat": rnd.choice(weap), "lim": 0, "lvlReq": rnd.randint(8, 16), "lvl": 0, "rerolls": rnd.randint(0, 20), "pol": "AP_ATTACK",
          "buffs": [{"Tag": t, "Value": rnd.randint(0, 0x3FFFFFFF)} for t in tags[:3]],
          "curses": [{"Tag": tags[3], "Value": rnd.randint(0, 0x3FFFFFFF)}] if rnd.random() < 0.6 else []}
    ups.append({"ItemType": "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare", "UpgradeFingerprint": json.dumps(fp),
                "ItemId": {"$oid": "%024x" % rnd.getrandbits(96)}})
inv = {"PlayerLevel": 18, "PremiumCredits": 742, "RegularCredits": 18_450_210, "PrimeTokens": 3150, "FusionPoints": 412_300,
       "MiscItems": misc, "Recipes": [], "Suits": suits, "LongGuns": longg, "Pistols": pist, "Melee": mel,
       "XPInfo": xpinfo, "PendingRecipes": pending, "Upgrades": ups}
os.makedirs(os.path.join(ROOT, "tests", "fixtures"), exist_ok=True)
json.dump(inv, open(os.path.join(ROOT, "tests", "fixtures", "inventory.sample.json"), "w"), indent=0)
print("ok: icon.png, inventory.sample.json")
