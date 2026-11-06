// DE envanter JSON'unu (inventory.php yanıtı) uygulamanın Inventory modeline çevirir,
// rivenleri ayrıştırıp notlar.
import type { GameData, Inventory, Riven, RivenStat } from '../shared/types';

type AnyObj = Record<string, any>;

const EQUIP_KEYS = ['Suits', 'LongGuns', 'Pistols', 'Melee', 'SpaceSuits', 'SpaceGuns', 'SpaceMelee',
  'Sentinels', 'SentinelWeapons', 'KubrowPets', 'MechSuits', 'OperatorAmps', 'MoaPets', 'Hoverboards'];
const COUNT_KEYS = ['MiscItems', 'Recipes', 'RawUpgrades', 'FusionTreasures', 'LevelKeys'];

const MAX_ROLL = 0x3fffffff;

// kabaca istenen özellikler (topluluk tercihleri; kendi ağırlıklarımız)
const GOOD = new Set(['WeaponCritChanceMod', 'WeaponCritDamageMod', 'WeaponDamageAmountMod', 'WeaponFireIterationsMod',
  'WeaponMeleeDamageMod', 'WeaponToxinDamageMod', 'WeaponElectricityDamageMod', 'WeaponFreezeDamageMod',
  'WeaponFireDamageMod', 'WeaponFireRateMod', 'WeaponMeleeComboInitialBonusMod', 'WeaponMeleeRangeIncMod',
  'WeaponSlashDamageMod', 'ComboDurationMod', 'WeaponMeleeFinisherDamageMod']);
const HARMLESS_CURSE = new Set(['WeaponZoomFovMod', 'WeaponPunctureDepthMod', 'WeaponImpactDamageMod',
  'WeaponArmorPiercingDamageMod', 'WeaponFactionDamageCorpus', 'WeaponFactionDamageGrineer', 'WeaponFactionDamageInfested',
  'WeaponRecoilReductionMod', 'WeaponProcTimeMod', 'WeaponMeleeFactionDamageCorpus', 'WeaponMeleeFactionDamageGrineer',
  'WeaponMeleeFactionDamageInfested', 'WeaponAmmoMaxMod', 'WeaponFinisherDamageMod']);

function oid(x: any): string { return x?.$oid ?? x?.oid ?? String(x ?? ''); }
function dateOf(x: any): string {
  const ms = Number(x?.$date?.$numberLong ?? x?.$date ?? x);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date().toISOString();
}

export function parseInventory(raw: AnyObj, gd: GameData, source: Inventory['source']): Inventory {
  const counts: Record<string, number> = {};
  const add = (k: string, n: number) => { if (k) counts[k] = (counts[k] ?? 0) + n; };
  for (const key of COUNT_KEYS) for (const it of raw[key] ?? []) add(it.ItemType, Number(it.ItemCount ?? 1));

  const xp: Record<string, number> = {};
  for (const it of raw.XPInfo ?? []) xp[it.ItemType] = Math.max(xp[it.ItemType] ?? 0, Number(it.XP ?? 0));
  for (const key of EQUIP_KEYS) for (const it of raw[key] ?? []) {
    add(it.ItemType, 1);
    xp[it.ItemType] = Math.max(xp[it.ItemType] ?? 0, Number(it.XP ?? 0));
  }

  const foundry = (raw.PendingRecipes ?? []).map((p: AnyObj) => ({ item: p.ItemType, readyAt: dateOf(p.CompletionDate) }));

  const rivens: Riven[] = [];
  for (const u of raw.Upgrades ?? []) {
    if (!/Randomized/i.test(u.ItemType ?? '')) continue;
    const r = parseRiven(u, gd);
    if (r) rivens.push(r);
  }

  return {
    syncedAt: new Date().toISOString(), source,
    mr: Number(raw.PlayerLevel ?? 0),
    platinum: Number(raw.PremiumCredits ?? 0),
    credits: Number(raw.RegularCredits ?? 0),
    ducats: Number(raw.PrimeTokens ?? 0),
    endo: Number(raw.FusionPoints ?? 0),
    counts, xp, foundry, rivens,
  };
}

export function parseRiven(u: AnyObj, gd: GameData): Riven | null {
  let fp: AnyObj;
  try { fp = typeof u.UpgradeFingerprint === 'string' ? JSON.parse(u.UpgradeFingerprint) : u.UpgradeFingerprint; } catch { return null; }
  if (!fp?.compat || !Array.isArray(fp.buffs)) return null; // örtülü (veiled) riven
  const weap = gd.rivenWeapons[fp.compat];
  const statOf = (b: AnyObj, curse: boolean): RivenStat => {
    const a = gd.rivenAttrs[b.Tag];
    return { tag: b.Tag, name: a?.name ?? { en: b.Tag }, roll: Math.min(1, Number(b.Value ?? 0) / MAX_ROLL), curse };
  };
  const stats = [...fp.buffs.map((b: AnyObj) => statOf(b, false)), ...(fp.curses ?? []).map((b: AnyObj) => statOf(b, true))];
  const { grade, score } = gradeRiven(stats);
  return {
    id: oid(u.ItemId), weapon: fp.compat, weaponName: weap?.name ?? fp.compat.split('/').pop(),
    weaponSlug: weap?.slug ?? null, mastery: Number(fp.lvlReq ?? 8), rerolls: Number(fp.rerolls ?? 0),
    polarity: String(fp.pol ?? ''), stats, grade, score,
  };
}

/** Kendi notlama formülümüz: özelliğin istenirliği + zar kalitesi + negatifin zararsızlığı. */
export function gradeRiven(stats: RivenStat[]): { grade: Riven['grade']; score: number } {
  const pos = stats.filter((s) => !s.curse);
  const neg = stats.filter((s) => s.curse);
  if (!pos.length) return { grade: 'F', score: 0 };
  const desirability = pos.filter((s) => GOOD.has(s.tag)).length / Math.max(2, pos.length);
  const rollAvg = pos.reduce((a, s) => a + s.roll, 0) / pos.length;
  const curseScore = neg.length === 0 ? 0.6 : neg.every((s) => HARMLESS_CURSE.has(s.tag)) ? 1 : 0.2;
  const countBonus = pos.length >= 3 ? 1 : 0.6;
  const score = Math.round(45 * desirability + 25 * rollAvg + 15 * curseScore + 15 * countBonus);
  const grade = score >= 82 ? 'S' : score >= 68 ? 'A' : score >= 52 ? 'B' : score >= 38 ? 'C' : 'F';
  return { grade, score };
}
