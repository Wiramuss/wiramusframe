// Oyun verisi + üstündeki alan mantığı (relic beklenen değeri, setler, dökümhane, ustalık).
import fs from 'node:fs';
import type {
  FoundryRow, GameData, I18nName, Inventory, InventoryRow, ItemDetail, Lang, MasteryHow, MasteryPlan, MasteryPlanItem, MasterySession, MasterySummary,
  Prices, Refinement, RelicPlanRow, RelicReward, SetRow, SlotSetInfo,
} from '../shared/types';

export const CHANCES: Record<Refinement, Record<'common' | 'uncommon' | 'rare', number>> = {
  intact: { common: 0.2533, uncommon: 0.11, rare: 0.02 },
  exceptional: { common: 0.2333, uncommon: 0.13, rare: 0.04 },
  flawless: { common: 0.2, uncommon: 0.17, rare: 0.06 },
  radiant: { common: 0.1667, uncommon: 0.2, rare: 0.1 },
};

const FRAME_KINDS = new Set(['warframe', 'archwing', 'necramech', 'companion']);

export function loadGameData(file: string): GameData {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as GameData;
}

export function nameOf(n: I18nName | null | undefined, lang: Lang): string {
  if (!n) return '';
  return (lang === 'tr' ? n.tr : n.en) || n.en;
}

/** Bir dağılımdan bağımsız k çekilişin en yükseğinin beklenen değeri. */
export function expectedMax(values: { p: number; v: number }[], k: number): number {
  const sorted = [...values].sort((a, b) => a.v - b.v);
  let cum = 0;
  let ev = 0;
  for (const { p, v } of sorted) {
    const before = Math.pow(cum, k);
    cum = Math.min(1, cum + p);
    ev += (Math.pow(cum, k) - before) * v;
  }
  return ev;
}

export class Domain {
  constructor(public gd: GameData, public prices: Prices, public inv: Inventory | null) {}

  plat(uniqueName: string): number | null {
    const it = this.gd.items[uniqueName];
    if (!it?.slug) return null;
    return this.prices.bySlug[it.slug]?.plat ?? null;
  }

  ducats(uniqueName: string): number | null {
    return this.gd.items[uniqueName]?.ducats ?? null;
  }

  count(uniqueName: string): number {
    return this.inv?.counts[uniqueName] ?? 0;
  }

  itemName(uniqueName: string): I18nName {
    return this.gd.items[uniqueName]?.name ?? this.gd.names[uniqueName]
      ?? this.gd.masterables.find((m) => m.uniqueName === uniqueName)?.name
      ?? { en: uniqueName.split('/').pop() ?? uniqueName };
  }

  /** uniqueName -> görsel URL'si (eşya, relic, ustalık eşyası, malzeme). */
  icons(): Record<string, string> {
    const out: Record<string, string> = { ...(this.gd.icons ?? {}) };
    for (const m of this.gd.masterables) if (m.icon) out[m.uniqueName] = m.icon;
    for (const r of Object.values(this.gd.relics)) if (r.icon) out[r.uniqueName] = r.icon;
    for (const it of Object.values(this.gd.items)) {
      if (!it.icon) continue;
      out[it.uniqueName] = it.icon;
      if (it.slug) out[`slug:${it.slug}`] = it.icon;
    }
    return out;
  }

  // ---- Relic planlayıcı ----
  relicPlan(ref: Refinement, onlyOwned = false): RelicPlanRow[] {
    const rows: RelicPlanRow[] = [];
    for (const r of Object.values(this.gd.relics)) {
      if (r.tier === 'Requiem') continue;
      const owned = this.count(r.uniqueName) + this.countRefined(r.uniqueName);
      if (onlyOwned && owned === 0) continue;
      const rewards: RelicReward[] = r.rewards.map((w) => ({
        item: w.item, name: this.itemName(w.item), rarity: w.rarity,
        chance: CHANCES[ref][w.rarity], plat: this.plat(w.item), ducats: this.ducats(w.item),
      }));
      const dist = rewards.map((w) => ({ p: w.chance, v: w.plat ?? 0 }));
      rows.push({
        uniqueName: r.uniqueName, name: r.name, tier: r.tier, vaulted: r.vaulted, owned,
        evSolo: round1(expectedMax(dist, 1)), evSquad: round1(expectedMax(dist, 4)),
        evDucats: round1(rewards.reduce((s, w) => s + w.chance * (w.ducats ?? 0), 0)),
        rewards,
      });
    }
    return rows.sort((a, b) => b.evSolo - a.evSolo);
  }

  private countRefined(base: string): number {
    if (!this.inv) return 0;
    return ['Silver', 'Gold', 'Platinum'].reduce((s, suf) => s + (this.inv!.counts[base + suf] ?? 0), 0);
  }

  // ---- Envanter (satılabilir) ----
  inventoryRows(): InventoryRow[] {
    if (!this.inv) return [];
    const out: InventoryRow[] = [];
    for (const [un, count] of Object.entries(this.inv.counts)) {
      if (count <= 0) continue;
      const base = un.replace(/(Bronze|Silver|Gold|Platinum)$/, '');
      const it = this.gd.items[un] ?? this.gd.items[base];
      if (!it?.tradable || !it.slug) continue;
      const tags = it.tags ?? [];
      const category = tags.includes('relic') ? 'relic' : tags.includes('set') ? 'set'
        : tags.includes('prime') ? 'prime' : tags.includes('mod') ? 'mod' : tags.includes('arcane_enhancement') ? 'arcane' : 'other';
      out.push({
        uniqueName: it.uniqueName, name: it.name, count, plat: this.plat(it.uniqueName),
        ducats: it.ducats ?? null, vaulted: !!it.vaulted, category, slug: it.slug,
      });
    }
    return out.sort((a, b) => (b.plat ?? 0) * b.count - (a.plat ?? 0) * a.count);
  }

  // ---- Setler ----
  sets(): SetRow[] {
    const rows: SetRow[] = [];
    for (const it of Object.values(this.gd.items)) {
      if (!it.tags?.includes('set') || !it.tags.includes('prime') || !it.parts?.length) continue;
      const parts = it.parts.map((p) => ({
        item: p.item, name: this.itemName(p.item), need: p.count, have: this.count(p.item), plat: this.plat(p.item),
      }));
      const need = parts.reduce((s, p) => s + p.need, 0);
      const have = parts.reduce((s, p) => s + Math.min(p.have, p.need), 0);
      rows.push({
        uniqueName: it.uniqueName, name: it.name, slug: it.slug, plat: this.plat(it.uniqueName),
        partsPlat: parts.reduce((s, p) => s + (p.plat ?? 0) * p.need, 0),
        have, need, complete: have >= need, parts,
      });
    }
    return rows.sort((a, b) => b.have / b.need - a.have / a.need || (b.plat ?? 0) - (a.plat ?? 0));
  }

  private partToSet: Map<string, string> | null = null;
  /** Bir ödül parçası için set durumu ve "alırsam ne olur". */
  setInfo(ref: string): SlotSetInfo | null {
    if (!this.partToSet) {
      this.partToSet = new Map();
      for (const it of Object.values(this.gd.items)) {
        if (!it.tags?.includes('set') || !it.parts?.length) continue;
        for (const p of it.parts) this.partToSet.set(p.item, it.uniqueName);
      }
    }
    const setRef = this.partToSet.get(ref);
    const set = setRef ? this.gd.items[setRef] : null;
    if (!set?.parts) return null;
    let have = 0, need = 0, partHave = 0, partNeed = 0;
    for (const p of set.parts) {
      const c = this.count(p.item);
      need += p.count; have += Math.min(c, p.count);
      if (p.item === ref) { partHave = c; partNeed = p.count; }
    }
    const outcome = partHave >= partNeed ? 'extra' : have + 1 >= need ? 'completes' : 'needed';
    const m = this.gd.masterables.find((x) => `${x.name.en} Set` === set.name.en);
    const mastered = m && this.inv ? this.rank(m.uniqueName, m.kind) >= Math.min(30, m.maxRank) : null;
    return { name: set.name, plat: this.plat(setRef!), have, need, partHave, partNeed, outcome, mastered };
  }

  // ---- Dökümhane / ustalık ----
  rank(uniqueName: string, kind: string): number {
    const xp = this.inv?.xp[uniqueName] ?? 0;
    return rankFromXp(xp, kind);
  }

  foundry(): FoundryRow[] {
    const byBlueprint = new Map<string, string>();
    for (const [res, r] of Object.entries(this.gd.recipes)) byBlueprint.set(r.blueprint, res);
    const building = new Map<string, string>();
    for (const f of this.inv?.foundry ?? []) building.set(byBlueprint.get(f.item) ?? f.item, f.readyAt);
    return this.gd.masterables.map((m) => {
      const rank = this.rank(m.uniqueName, m.kind);
      const owned = this.count(m.uniqueName) > 0;
      return {
        uniqueName: m.uniqueName, name: m.name, kind: m.kind, prime: m.prime, owned,
        rank, maxRank: m.maxRank, mastered: rank >= Math.min(30, m.maxRank),
        masteryReq: m.masteryReq, building: building.get(m.uniqueName) ?? null,
      };
    });
  }

  mastery(): MasterySummary {
    const rows = this.foundry();
    let totalXp = 0;
    for (const r of rows) totalXp += masteryPoints(r.rank, r.kind);
    return {
      mr: this.inv?.mr ?? 0, totalXp,
      mastered: rows.filter((r) => r.mastered).length, total: rows.length,
      missing: rows.filter((r) => !r.mastered).sort((a, b) => a.masteryReq - b.masteryReq),
    };
  }

  // ---- Hızlı ustalık planı ----
  masteryPlan(): MasteryPlan {
    const mr = this.inv?.mr ?? 0;
    const rows = this.foundry();
    let totalXp = 0;
    for (const r of rows) totalXp += masteryPoints(r.rank, r.kind);
    const nextAt = mrThreshold(mr + 1);
    // Envanterdeki eşya puanları yıldız haritası/intrinsic puanlarını içermez; MR'ın alt sınırı daha doğru
    const base = Math.max(totalXp, mrThreshold(mr));
    const gap = Math.max(0, nextAt - base);

    const setSlug = new Map<string, string>();
    for (const it of Object.values(this.gd.items)) if (it.tags.includes('set') && it.slug) setSlug.set(it.name.en, it.slug);

    const items: MasteryPlanItem[] = [];
    for (const r of rows) {
      if (r.rank >= r.maxRank) continue;
      const xp = masteryPoints(r.maxRank, r.kind) - masteryPoints(r.rank, r.kind);
      const rc = this.gd.recipes[r.uniqueName];
      let how: MasteryHow = 'farm', plat: number | null = null, missingParts = 0;
      if (r.owned) how = 'level';
      else if (rc && this.count(rc.blueprint) > 0) {
        missingParts = rc.ingredients.filter((x) => this.count(x.item) < x.count).length;
        how = missingParts === 0 ? 'build' : 'farm';
      }
      if (how === 'farm' && r.prime) {
        const slug = setSlug.get(`${r.name.en} Set`);
        plat = slug ? this.prices.bySlug[slug]?.plat ?? null : null;
        if (plat != null) how = 'buy';
      }
      items.push({
        uniqueName: r.uniqueName, name: r.name, kind: r.kind, rank: r.rank, maxRank: r.maxRank, xp, how,
        locked: r.masteryReq > mr, masteryReq: r.masteryReq, plat,
        credits: rc?.buildPrice ?? null, buildTime: rc?.buildTime ?? null, missingParts,
      });
    }
    const ORDER: Record<MasteryHow, number> = { level: 0, build: 1, buy: 2, farm: 3 };
    items.sort((a, b) => Number(a.locked) - Number(b.locked) || ORDER[a.how] - ORDER[b.how]
      || (a.plat ?? 0) - (b.plat ?? 0) || b.xp - a.xp);

    // Oturumlar: bir görevde aynı anda bir warframe + birincil + ikincil + yakın + yoldaş + yoldaş silahı
    const GROUP: Record<string, MasterySession['group']> = {
      warframe: 'ground', primary: 'ground', secondary: 'ground', melee: 'ground', companion: 'ground', companion_weapon: 'ground',
      archwing: 'air', archgun: 'air', archmelee: 'air', necramech: 'mech',
    };
    const MIN = { ground: 20, air: 15, mech: 25 };
    const ready = items.filter((i) => !i.locked && i.how !== 'farm');
    const sessions: MasterySession[] = [];
    let got = 0;
    const used = new Set<string>();
    while (got < gap && used.size < ready.length) {
      const first = ready.find((i) => !used.has(i.uniqueName));
      if (!first) break;
      const group = GROUP[first.kind] ?? 'ground';
      const ses: MasterySession = { group, items: [], xp: 0, minutes: MIN[group] };
      const kinds = new Set<string>();
      for (const i of ready) {
        if (used.has(i.uniqueName) || (GROUP[i.kind] ?? 'ground') !== group || kinds.has(i.kind)) continue;
        kinds.add(i.kind); used.add(i.uniqueName);
        ses.items.push({ uniqueName: i.uniqueName, name: i.name, kind: i.kind, xp: i.xp }); ses.xp += i.xp;
        if (i.maxRank > 30) ses.minutes = MIN[group] + 15;
      }
      sessions.push(ses); got += ses.xp;
    }
    const zero = (): Record<MasteryHow, number> => ({ level: 0, build: 0, buy: 0, farm: 0 });
    const counts = zero(), available = zero();
    for (const i of items) { counts[i.how]++; if (!i.locked) available[i.how] += i.xp; }
    return {
      mr, totalXp, nextAt, gap, sessions, sessionsXp: got, minutes: sessions.reduce((a, x) => a + x.minutes, 0),
      items: items.slice(0, 500), counts, available,
    };
  }

  // ---- Eşya detayı ----
  detail(uniqueName: string): ItemDetail {
    const it = this.gd.items[uniqueName];
    const relics = Object.values(this.gd.relics)
      .flatMap((r) => r.rewards.filter((w) => w.item === uniqueName)
        .map((w) => ({ uniqueName: r.uniqueName, name: r.name, rarity: w.rarity, vaulted: r.vaulted })))
      .sort((a, b) => Number(a.vaulted) - Number(b.vaulted));
    let target = uniqueName;
    if (!this.gd.recipes[target] && it?.tags?.includes('set')) {
      const m = this.gd.masterables.find((x) => x.name.en + ' Set' === it.name.en);
      if (m) target = m.uniqueName;
    }
    const rc = this.gd.recipes[target];
    return {
      uniqueName, name: this.itemName(uniqueName), ducats: this.ducats(uniqueName), plat: this.plat(uniqueName),
      vaulted: !!it?.vaulted, owned: this.count(uniqueName), relics,
      recipe: rc ? {
        buildTime: rc.buildTime, buildPrice: rc.buildPrice,
        ingredients: rc.ingredients.map((x) => ({ item: x.item, name: this.itemName(x.item), count: x.count, have: this.count(x.item) })),
      } : null,
      parts: (it?.parts ?? []).map((p) => ({ item: p.item, name: this.itemName(p.item), count: p.count, have: this.count(p.item) })),
    };
  }
}

export function rankFromXp(xp: number, kind: string): number {
  const base = FRAME_KINDS.has(kind) ? 1000 : 500;
  return Math.min(40, Math.floor(Math.sqrt(xp / base)));
}

/** MR n için gereken toplam ustalık puanı (30 sonrası Efsanevi seviyeler). */
export function mrThreshold(n: number): number {
  if (n <= 30) return 2500 * n * n;
  return 2_250_000 + 147_500 * (n - 30);
}

export function masteryPoints(rank: number, kind: string): number {
  return Math.min(rank, 40) * (FRAME_KINDS.has(kind) ? 200 : 100);
}

function round1(n: number) { return Math.round(n * 10) / 10; }
