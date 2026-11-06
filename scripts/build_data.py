"""Oyun verisini derler: DE Public Export (EN+TR) + warframe.market v2 -> resources/gamedata.json

Kullanım:  python scripts/build_data.py            (önbellek: .cache/, 24 saat)
           python scripts/build_data.py --fresh    (önbelleği yok say)
"""
import json, lzma, os, re, struct, sys, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache")
OUT = os.path.join(ROOT, "resources", "gamedata.json")
FRESH = "--fresh" in sys.argv
UA = {"User-Agent": "wiramusframe-databuild/0.1"}
LANGS = ("en", "tr")
EXPORTS = ("ExportRelicArcane", "ExportRecipes", "ExportWarframes", "ExportWeapons",
           "ExportSentinels", "ExportResources")
os.makedirs(CACHE, exist_ok=True)
os.makedirs(os.path.dirname(OUT), exist_ok=True)


def fetch(url, name, headers=None):
    path = os.path.join(CACHE, name)
    if not FRESH and os.path.exists(path) and time.time() - os.path.getmtime(path) < 86400:
        return open(path, "rb").read()
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    for attempt in range(3):
        try:
            data = urllib.request.urlopen(req, timeout=60).read()
            open(path, "wb").write(data)
            return data
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                raise RuntimeError(f"indirilemedi: {url}: {e}")
            time.sleep(2)


def lzma_raw(b):
    """DE'nin LZMA dosyalarında boyut alanı hatalı; ham LZMA1 olarak çöz."""
    props = b[0]
    dict_size = struct.unpack("<I", b[1:5])[0]
    lc, rest = props % 9, props // 9
    lp, pb = rest % 5, rest // 5
    d = lzma.LZMADecompressor(format=lzma.FORMAT_RAW, filters=[
        {"id": lzma.FILTER_LZMA1, "dict_size": dict_size, "lc": lc, "lp": lp, "pb": pb}])
    return d.decompress(b[13:])


def clean(s):
    # DE adlarında <ARCHWING> gibi etiketler olabilir
    return re.sub(r"<[^>]+>\s*", "", s).strip()


def load_exports(lang):
    idx = lzma_raw(fetch(f"https://origin.warframe.com/PublicExport/index_{lang}.txt.lzma",
                         f"index_{lang}.lzma")).decode("utf-8", "replace")
    out = {}
    for line in idx.splitlines():
        line = line.strip()
        if "!" not in line:
            continue
        fname = line.split("!")[0]
        base = fname.split("_")[0]
        if base not in EXPORTS:
            continue
        url = "https://content.warframe.com/PublicExport/Manifest/" + urllib.parse.quote(line, safe="!")
        raw = fetch(url, fname).decode("utf-8")
        out[base] = json.loads(raw, strict=False)[base]
    missing = [e for e in EXPORTS if e not in out]
    if missing:
        raise RuntimeError(f"{lang} export eksik: {missing}")
    return out


WFM_ASSETS = "https://warframe.market/static/assets/"
DE_ASSETS = "https://content.warframe.com/PublicExport"


def load_manifest():
    """uniqueName -> DE ikon URL'si (ExportManifest)."""
    idx = lzma_raw(fetch("https://origin.warframe.com/PublicExport/index_en.txt.lzma",
                         "index_en.lzma")).decode("utf-8", "replace")
    line = next(l.strip() for l in idx.splitlines() if l.startswith("ExportManifest"))
    raw = fetch("https://content.warframe.com/PublicExport/Manifest/" + urllib.parse.quote(line, safe="!"),
                "ExportManifest.json").decode("utf-8")
    return {e["uniqueName"]: DE_ASSETS + e["textureLocation"]
            for e in json.loads(raw, strict=False)["Manifest"] if e.get("textureLocation")}


def main():
    ex = {lang: load_exports(lang) for lang in LANGS}
    manifest = load_manifest()

    # uniqueName -> {en, tr}
    names = {}
    for lang in LANGS:
        for arr in ex[lang].values():
            for e in arr:
                if isinstance(e, dict) and e.get("name"):
                    names.setdefault(e["uniqueName"], {})[lang] = clean(e["name"])

    recipes_en = ex["en"]["ExportRecipes"]
    BP = {"en": "Blueprint", "tr": "Kalıp"}
    # taslak adları: "<sonuç adı> Blueprint" / "<sonuç adı> Kalıp"
    for r in recipes_en:
        res = names.get(r["resultType"])
        if res and r["uniqueName"] not in names:
            names[r["uniqueName"]] = {l: f"{res[l]} {BP[l]}" for l in res}

    # warframe.market eşyaları (gameRef = uniqueName)
    wfm = json.loads(fetch("https://api.warframe.market/v2/items", "wfm_items_tr.json",
                           {"Language": "tr"}))["data"]
    items = {}
    by_id = {i["id"]: i for i in wfm}
    for i in wfm:
        ref = i.get("gameRef")
        if not ref:
            continue
        en = i["i18n"]["en"]["name"]
        n = {"en": en, "tr": i["i18n"].get("tr", {}).get("name") or en}
        set_slug = None
        for pid in i.get("setParts") or []:
            p = by_id.get(pid)
            if p and "set" in p.get("tags", []):
                set_slug = p["slug"]
        items[ref] = {
            "uniqueName": ref, "slug": i["slug"], "name": n, "tags": i.get("tags", []),
            "ducats": i.get("ducats"), "vaulted": bool(i.get("vaulted")), "tradable": True,
            "setSlug": set_slug,
            "icon": (WFM_ASSETS + i["i18n"]["en"]["thumb"]) if i["i18n"]["en"].get("thumb") else manifest.get(ref),
        }
        # export adı WFM'den farklıysa (oyunun gösterdiği ad olabilir) yedek tut
        exn = names.get(ref)
        if exn:
            alt = {l: exn[l] for l in exn if exn[l] != n.get(l)}
            if alt:
                items[ref]["alt"] = alt

    # set -> parçalar (liste uç noktası setParts vermiyor; /item/{slug}/set kullan, önbellekli)
    os.makedirs(os.path.join(CACHE, "sets"), exist_ok=True)
    set_items = [i for i in wfm if "set" in i.get("tags", []) and "prime" in i.get("tags", []) and i.get("gameRef") in items]
    for i in set_items:
        name = os.path.join("sets", i["slug"] + ".json")
        cached = os.path.exists(os.path.join(CACHE, name))
        data = json.loads(fetch(f"https://api.warframe.market/v2/item/{i['slug']}/set", name))["data"]["items"]
        if not cached:
            time.sleep(0.34)  # WFM hız sınırı
        items[i["gameRef"]]["parts"] = [{"item": p["gameRef"], "count": p.get("quantityInSet") or 1}
                                       for p in data if p.get("gameRef") and p["slug"] != i["slug"]]
        for p in data:
            if p.get("gameRef") in items and p["slug"] != i["slug"]:
                items[p["gameRef"]]["setSlug"] = i["slug"]
    print(f"setler: {len(set_items)}")

    # relikler
    relics = {}
    reward_refs = set()
    for r in ex["en"]["ExportRelicArcane"]:
        if "relicRewards" not in r:
            continue
        un = r["uniqueName"]
        # Intact = ...Bronze; diğer rafine seviyeleri aynı ödülleri taşır, atla
        if re.search(r"(Silver|Gold|Platinum)$", un):
            continue
        if un.endswith("Bronze"):
            un = un[: -len("Bronze")]
        m = re.match(r"^(Lith|Meso|Neo|Axi|Requiem|Vanguard)\s+(\S+)", r["name"])
        if not m:
            continue
        rewards = []
        for w in r["relicRewards"]:
            ref = w["rewardName"].replace("/StoreItems", "")
            reward_refs.add(ref)
            rewards.append({"item": ref, "rarity": w["rarity"].lower()})
        wi = items.get(un, {})
        relics[un] = {
            "uniqueName": un, "tier": m.group(1), "code": m.group(2),
            "name": names.get(r["uniqueName"], {"en": r["name"]}), "rewards": rewards,
            "vaulted": wi.get("vaulted", True), "slug": wi.get("slug"),
            "icon": wi.get("icon") or manifest.get(r["uniqueName"]),
        }

    # relic ödülü olup WFM'de olmayanlar (Forma Kalıp vb.)
    for ref in reward_refs:
        if ref not in items:
            n = names.get(ref)
            if not n:
                print("UYARI: adsız ödül", ref)
                continue
            items[ref] = {"uniqueName": ref, "name": n, "tags": [], "tradable": False,
                          "icon": manifest.get(ref)}

    # ustalık eşyaları
    KIND = {"Suits": "warframe", "SpaceSuits": "archwing", "MechSuits": "necramech",
            "LongGuns": "primary", "Pistols": "secondary", "Melee": "melee",
            "SpaceGuns": "archgun", "SpaceMelee": "archmelee", "SentinelWeapons": "companion_weapon",
            "Sentinels": "companion", "KubrowPets": "companion"}
    masterables = []
    seen = set()
    for base in ("ExportWarframes", "ExportWeapons", "ExportSentinels"):
        for e in ex["en"][base]:
            cat = e.get("productCategory")
            un = e["uniqueName"]
            if cat not in KIND or e.get("excludeFromCodex") or un in seen:
                continue
            if "/PvPVariants/" in un or "Doppelganger" in un:
                continue
            seen.add(un)
            masterables.append({
                "uniqueName": un, "name": names.get(un, {"en": e["name"]}),
                "kind": KIND[cat], "maxRank": e.get("maxLevelCap", 30), "masteryReq": e.get("masteryReq", 0),
                "prime": " Prime" in e["name"],
                "icon": items.get(un, {}).get("icon") or manifest.get(un),
            })

    # tarifler (ustalık eşyaları ve alt parçaları)
    recipes = {}
    by_result = {r["resultType"]: r for r in recipes_en}
    queue = [m["uniqueName"] for m in masterables]
    while queue:
        res = queue.pop()
        r = by_result.get(res)
        if not r or res in recipes:
            continue
        ing = [{"item": x["ItemType"], "count": x["ItemCount"]} for x in r.get("ingredients", [])]
        recipes[res] = {"blueprint": r["uniqueName"], "buildTime": r.get("buildTime", 0),
                        "buildPrice": r.get("buildPrice", 0), "ingredients": ing}
        for x in ing:
            if x["item"] in by_result:
                queue.append(x["item"])
    ref_names = {}
    for res, r in recipes.items():
        for k in [res, r["blueprint"]] + [x["item"] for x in r["ingredients"]]:
            if k in names and k not in items:
                ref_names[k] = names[k]

    attrs = json.loads(fetch("https://api.warframe.market/v2/riven/attributes", "wfm_riven_attrs.json",
                             {"Language": "tr"}))["data"]
    riven_attrs = {}
    for a in attrs:
        if a.get("gameRef"):
            riven_attrs[a["gameRef"]] = {
                "slug": a["slug"], "unit": a.get("unit"),
                "name": {"en": a["i18n"]["en"]["name"], "tr": a["i18n"].get("tr", {}).get("name", a["i18n"]["en"]["name"])}}
    rweap = json.loads(fetch("https://api.warframe.market/v2/riven/weapons", "wfm_riven_weapons.json",
                             {"Language": "tr"}))["data"]
    riven_weapons = {}
    for w in rweap:
        if w.get("gameRef"):
            riven_weapons[w["gameRef"]] = {"slug": w["slug"], "name": w["i18n"]["en"]["name"],
                                           "disposition": w.get("disposition"), "group": w.get("group")}

    out = {
        "version": 1, "builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "items": items, "relics": relics, "masterables": masterables, "recipes": recipes,
        "names": ref_names, "rivenAttrs": riven_attrs, "rivenWeapons": riven_weapons,
        "rewardRefs": sorted(reward_refs),
        # tarif malzemeleri ve taslaklar için ikonlar (items'ta olmayanlar)
        "icons": {k: manifest[k] for k in set(ref_names) | {r["blueprint"] for r in recipes.values()}
                  if k in manifest and k not in items},
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"items={len(items)} relics={len(relics)} rewards={len(reward_refs)} masterables={len(masterables)} "
          f"recipes={len(recipes)} rivenAttrs={len(riven_attrs)} rivenWeapons={len(riven_weapons)} "
          f"-> {os.path.getsize(OUT)//1024} KB")


if __name__ == "__main__":
    main()
