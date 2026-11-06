// Bellek okumadan envanter: oyun ekranından (OCR) ve EE.log'dan.
// - Envanter/Dökümhane ekranı: kutucuk adlarını eşya listesiyle eşleştir, yanındaki sayıyı adet say.
// - Ödül ekranı: parçaların üstündeki "N Mevcut / N Owned" rozeti = o parçadan kaç tane var.
// - EE.log: açılan relic (ResourceLoader satırı) ödül ekranı gelince envanterden 1 düşer.
import type { GameData, Inventory } from '../shared/types';
import { FuzzyIndex } from '../shared/text';
import { lineBottom, lineText, lineTop, toLines, type Word } from './rewards';

/** Envanter ekranında aranacak tüm eşyalar (prime parçalar, kalıplar, relicler, modlar...). */
export function buildItemIndex(gd: GameData): FuzzyIndex<string> {
  const idx = new FuzzyIndex<string>();
  for (const [ref, it] of Object.entries(gd.items)) {
    for (const lang of ['en', 'tr'] as const) {
      const n = it.name[lang]; if (n) idx.add(n, lang, ref);
      const a = it.alt?.[lang]; if (a) idx.add(a, lang, ref);
    }
  }
  for (const [ref, r] of Object.entries(gd.relics)) {
    for (const lang of ['en', 'tr'] as const) { const n = r.name[lang]; if (n) idx.add(n, lang, ref); }
  }
  return idx;
}

export interface SeenItem { ref: string; count: number; text: string; score: number; x: number; y: number }

const COUNT_RE = /^[x×]?(\d{1,5})[x×]?$/i;
const MIN_INV_SCORE = 0.78; // envanter ekranında yanlış eşleşme pahalı: ödül ekranından daha sıkı

/**
 * OCR kelimelerinden envanter kutucuklarını çıkar.
 * Ad bir ya da iki satır olabilir; adet, adın üstünde veya solunda duran tek başına bir sayıdır.
 */
export function parseInventoryWords(words: Word[], index: FuzzyIndex<string>, screenH: number): SeenItem[] {
  const base = screenH / 1080;
  const nums = words.filter((w) => COUNT_RE.test(w.text.trim()));
  const texty = words.filter((w) => /[A-Za-zÇĞİÖŞÜçğıöşü]{2,}/.test(w.text));
  // kutucuklar sütun sütun durur: önce yatayda kümele, sonra her sütunda satırlara ayır
  const cols: Word[][] = [];
  for (const w of [...texty].sort((a, b) => a.x0 - b.x0)) {
    const cx = (w.x0 + w.x1) / 2;
    const col = cols.find((c) => c.some((o) => Math.abs((o.x0 + o.x1) / 2 - cx) < 110 * base));
    if (col) col.push(w); else cols.push([w]);
  }
  const seen = new Map<string, SeenItem>();
  for (const col of cols) {
    const lines = toLines(col);
    const used = new Set<number>();
    lines.forEach((l, i) => {
      if (used.has(i)) return;
      const cands: { text: string; lines: number[] }[] = [{ text: lineText(l), lines: [i] }];
      const nx = lines[i + 1];
      if (nx && lineTop(nx) - lineBottom(l) < (lineBottom(l) - lineTop(l)) * 1.2) cands.push({ text: `${lineText(l)} ${lineText(nx)}`, lines: [i, i + 1] });
      let best: { ref: string; score: number; text: string; lines: number[] } | null = null;
      for (const c of cands) {
        const m = index.best(c.text) as { value: string; score: number } | null;
        if (m && m.score >= MIN_INV_SCORE && (!best || m.score > best.score)) best = { ref: m.value, score: m.score, text: c.text, lines: c.lines };
      }
      if (!best) return;
      best.lines.forEach((k) => used.add(k));
      const top = lineTop(l), left = Math.min(...l.map((w) => w.x0)), right = Math.max(...l.map((w) => w.x1));
      // adet: adın üstünde (kutucuğun içinde, ~2 kutucuk yüksekliği yukarıya kadar) ve yatayda üst üste binen en yakın sayı
      let count = 1, bestD = Infinity;
      for (const n of nums) {
        const dy = top - n.y1;
        const overlapX = n.x1 > left - 60 * base && n.x0 < right + 60 * base;
        if (dy >= -4 * base && dy < 170 * base && overlapX && dy < bestD) { bestD = dy; count = Number(COUNT_RE.exec(n.text.trim())![1]); }
      }
      const prev = seen.get(best.ref);
      // aynı eşya iki kez görünürse (kaydırma) büyük adedi tut
      if (!prev || count > prev.count) seen.set(best.ref, { ref: best.ref, count, text: best.text, score: Math.round(best.score * 100) / 100, x: left, y: top });
    });
  }
  return [...seen.values()];
}

const OWNED_RE = /(\d{1,4})\s*(mevcut|owned)/i;
/** Ödül ekranındaki "2 Mevcut" rozetlerini slot x aralıklarına dağıt. */
export function parseOwnedBadges(words: Word[], slots: { x: number; width: number }[]): (number | null)[] {
  const out: (number | null)[] = slots.map(() => null);
  for (const l of toLines(words)) {
    for (let i = 0; i < l.length; i++) {
      const pair = `${l[i].text} ${l[i + 1]?.text ?? ''}`;
      const m = OWNED_RE.exec(pair) ?? OWNED_RE.exec(l[i].text);
      if (!m) continue;
      const cx = (l[i].x0 + (l[i + 1]?.x1 ?? l[i].x1)) / 2;
      const k = slots.findIndex((s) => cx >= s.x && cx < s.x + s.width);
      if (k >= 0) out[k] = Number(m[1]);
    }
  }
  return out;
}

const RELIC_LOAD_RE = /ResourceLoader\s+0x[0-9A-F]+\s+\((\/Lotus\/Types\/Game\/Projections\/T\dVoidProjection\w+?(?:Bronze|Silver|Gold|Platinum))\)/i;
/** EE.log satırı açılmak üzere seçilen relici yüklüyorsa relicin envanter anahtarını döndür. */
export function relicFromLogLine(line: string): string | null {
  return RELIC_LOAD_RE.exec(line)?.[1] ?? null;
}

/** Görülen adetleri envantere yaz. Envanter yoksa ekrandan başlayan boş bir envanter açılır. */
export function mergeSeen(inv: Inventory | null, seen: { ref: string; count: number }[]): Inventory {
  const base: Inventory = inv ? { ...inv, counts: { ...inv.counts } } : {
    syncedAt: new Date().toISOString(), source: 'screen', mr: 0, platinum: 0, credits: 0, ducats: 0, endo: 0,
    counts: {}, xp: {}, foundry: [], rivens: [],
  };
  for (const s of seen) base.counts[s.ref] = s.count;
  base.syncedAt = new Date().toISOString();
  return base;
}
