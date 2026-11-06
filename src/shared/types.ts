// Main, core ve renderer arasında paylaşılan tipler.

export type Lang = 'tr' | 'en';
export type I18nName = { en: string; tr?: string };
export type Rarity = 'common' | 'uncommon' | 'rare';
export type Refinement = 'intact' | 'exceptional' | 'flawless' | 'radiant';

export interface GameItem {
  uniqueName: string;
  slug?: string;
  name: I18nName;
  alt?: Partial<I18nName>;
  tags: string[];
  ducats?: number | null;
  vaulted?: boolean;
  tradable: boolean;
  setSlug?: string | null;
  parts?: { item: string; count: number }[];
  icon?: string;
}

export interface Relic {
  uniqueName: string;
  tier: string;
  code: string;
  name: I18nName;
  vaulted: boolean;
  slug?: string | null;
  rewards: { item: string; rarity: Rarity }[];
  icon?: string;
}

export interface Masterable {
  uniqueName: string;
  name: I18nName;
  kind: string;
  maxRank: number;
  masteryReq: number;
  prime: boolean;
  icon?: string;
}

export interface Recipe {
  blueprint: string;
  buildTime: number;
  buildPrice: number;
  ingredients: { item: string; count: number }[];
}

export interface GameData {
  version: number;
  builtAt: string;
  items: Record<string, GameItem>;
  relics: Record<string, Relic>;
  masterables: Masterable[];
  recipes: Record<string, Recipe>;
  names: Record<string, I18nName>;
  rivenAttrs: Record<string, { slug: string; unit?: string; name: I18nName }>;
  rivenWeapons: Record<string, { slug: string; name: string; disposition?: number; group?: string }>;
  rewardRefs: string[];
  icons?: Record<string, string>;
}

export interface PriceEntry { plat: number; vol: number }
export interface Prices { fetchedAt: string | null; bySlug: Record<string, PriceEntry> }

export interface RivenStat { tag: string; name: I18nName; roll: number; curse: boolean }
export interface Riven {
  id: string;
  weapon: string;
  weaponName: string;
  weaponSlug: string | null;
  mastery: number;
  rerolls: number;
  polarity: string;
  stats: RivenStat[];
  grade: 'S' | 'A' | 'B' | 'C' | 'F';
  score: number;
}

export interface Inventory {
  syncedAt: string;
  source: 'memory' | 'import' | 'screen';
  mr: number;
  platinum: number;
  credits: number;
  ducats: number;
  endo: number;
  counts: Record<string, number>;
  xp: Record<string, number>;
  foundry: { item: string; readyAt: string }[];
  rivens: Riven[];
}

export interface Settings {
  uiLang: Lang;
  gameLang: 'auto' | Lang;
  uiScale: number;
  onboarded: boolean;
  /** Kullanım Şartları kabul zamanı (ISO). null = henüz kabul edilmedi. */
  termsAcceptedAt?: string | null;
  overlay: { enabled: boolean; seconds: number };
  memoryReader: { enabled: boolean; consentAt: string | null };
  eeLogPath: string;
  wfm: { user: string | null; tokenEnc: string | null };
}

export interface StatPoint { ts: string; platinum: number; credits: number; ducats: number; endo: number }

export interface SlotResult {
  text: string;
  uniqueName: string | null;
  name: I18nName | null;
  score: number;
  plat: number | null;
  ducats: number | null;
  owned: number;
  vaulted: boolean;
  set?: SlotSetInfo | null;
  x: number; y: number; width: number;
  /** Oyunun ödül ekranında gösterdiği "N Mevcut" adedi (okunabildiyse). */
  seenOwned?: number | null;
}

export interface ScanResult {
  ts: string;
  lang: Lang | null;
  ms: number;
  screen: { width: number; height: number };
  slots: SlotResult[];
  bestIndex: number;
}

export interface Status {
  gameRunning: boolean;
  eeLogFound: boolean;
  memoryReader: 'off' | 'connected' | 'waiting' | 'error';
  memoryError?: string;
  inventorySyncedAt: string | null;
  dataBuiltAt: string;
  pricesFetchedAt: string | null;
  wfmUser: string | null;
  lastScan: ScanResult | null;
}

export interface InventoryRow {
  uniqueName: string;
  name: I18nName;
  count: number;
  plat: number | null;
  ducats: number | null;
  vaulted: boolean;
  category: string;
  slug?: string;
}

export interface RelicReward {
  item: string; name: I18nName; rarity: Rarity; chance: number; plat: number | null; ducats: number | null;
}

export interface RelicPlanRow {
  uniqueName: string;
  name: I18nName;
  tier: string;
  vaulted: boolean;
  owned: number;
  evSolo: number;
  evSquad: number;
  evDucats: number;
  rewards: RelicReward[];
}

export interface SetRow {
  uniqueName: string;
  name: I18nName;
  slug?: string;
  plat: number | null;
  partsPlat: number;
  have: number;
  need: number;
  complete: boolean;
  parts: { item: string; name: I18nName; need: number; have: number; plat: number | null }[];
}

export interface FoundryRow {
  uniqueName: string;
  name: I18nName;
  kind: string;
  prime: boolean;
  owned: boolean;
  rank: number;
  maxRank: number;
  mastered: boolean;
  masteryReq: number;
  building: string | null;
}

export interface ItemDetail {
  uniqueName: string;
  name: I18nName;
  ducats: number | null;
  plat: number | null;
  vaulted: boolean;
  owned: number;
  relics: { uniqueName: string; name: I18nName; rarity: Rarity; vaulted: boolean }[];
  recipe: { buildTime: number; buildPrice: number; ingredients: { item: string; name: I18nName; count: number; have: number }[] } | null;
  parts: { item: string; name: I18nName; count: number; have: number }[];
}

export interface Auction {
  id: string;
  weapon: string;
  name: string;
  price: number;
  seller: string;
  status: string;
  attrs: { slug: string; value: number; positive: boolean }[];
  rerolls: number;
  mr: number;
}

export interface SniperRule { id: string; weapon: string; positives: string[]; maxPrice: number; seen: string[] }

export interface MasterySummary {
  mr: number;
  totalXp: number;
  mastered: number;
  total: number;
  missing: FoundryRow[];
}

export type MasteryHow = 'level' | 'build' | 'buy' | 'farm';
export interface MasteryPlanItem {
  uniqueName: string; name: I18nName; kind: string; rank: number; maxRank: number;
  xp: number; how: MasteryHow; locked: boolean; masteryReq: number;
  plat: number | null; credits: number | null; buildTime: number | null; missingParts: number;
}
export interface MasterySession { group: 'ground' | 'air' | 'mech'; items: { uniqueName: string; name: I18nName; kind: string; xp: number }[]; xp: number; minutes: number }
export interface MasteryPlan {
  mr: number; totalXp: number; nextAt: number; gap: number;
  /** sonraki MR için seçilen oturumlar (bir görevde birlikte seviye atlatılacak eşyalar) */
  sessions: MasterySession[]; sessionsXp: number; minutes: number;
  items: MasteryPlanItem[];
  counts: Record<MasteryHow, number>; available: Record<MasteryHow, number>;
}

/** Ödül parçasının set durumu: "bunu alırsam ne olur" */
export interface SlotSetInfo {
  name: I18nName; plat: number | null;
  have: number; need: number;          // setteki toplam parça (sahip/gerekli), bu parça hariç
  partHave: number; partNeed: number;  // bu parçadan
  outcome: 'completes' | 'needed' | 'extra';
  mastered: boolean | null;            // setin ürünü ustalanmış mı
}
