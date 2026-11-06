// Türkçe/İngilizce metin normalizasyonu ve bulanık eşleştirme.
// OCR çoğu zaman ı/İ, ş, ğ gibi harfleri karıştırır; bu yüzden karşılaştırma
// "katlanmış" anahtarlar üzerinde yapılır.

const FOLD: Record<string, string> = {
  İ: 'i', I: 'i', ı: 'i', i: 'i', Ş: 's', ş: 's', Ğ: 'g', ğ: 'g', Ü: 'u', ü: 'u',
  Ö: 'o', ö: 'o', Ç: 'c', ç: 'c', Â: 'a', â: 'a', Î: 'i', î: 'i', Û: 'u', û: 'u',
};

/** Küçük harf, Türkçe aksanları ASCII'ye katlar, harf/rakam dışını boşluk yapar. */
export function fold(s: string): string {
  let out = '';
  for (const ch of s) {
    const f = FOLD[ch];
    out += f ?? ch.toLowerCase();
  }
  return out
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Levenshtein mesafesi (iki satırlık DP). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** 0..1 benzerlik (1 = aynı). Boşluklar yok sayılır: OCR kelime aralarını kaçırabilir. */
export function similarity(a: string, b: string): number {
  const x = a.replace(/ /g, '');
  const y = b.replace(/ /g, '');
  const m = Math.max(x.length, y.length);
  if (!m) return 0;
  return 1 - levenshtein(x, y) / m;
}

export interface MatchResult<T> { value: T; lang: string; score: number; key: string }

/** Basit bulanık sözlük. Aday sayısı birkaç bin; doğrusal tarama yeterince hızlı. */
export class FuzzyIndex<T> {
  private entries: { key: string; lang: string; value: T }[] = [];
  private seen = new Set<string>();

  add(name: string, lang: string, value: T) {
    const key = fold(name);
    const id = key + '\u0000' + String(value);
    if (key && !this.seen.has(id)) {
      this.seen.add(id);
      this.entries.push({ key, lang, value });
    }
  }

  get size() { return this.entries.length; }

  best(text: string, filter?: (v: T) => boolean): MatchResult<T> | null {
    const q = fold(text);
    if (q.length < 3) return null;
    let best: MatchResult<T> | null = null;
    for (const e of this.entries) {
      if (filter && !filter(e.value)) continue;
      const s = similarity(q, e.key);
      if (!best || s > best.score) best = { value: e.value, lang: e.lang, score: s, key: e.key };
    }
    return best;
  }
}
