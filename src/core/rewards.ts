// Relic ödül ekranı OCR boru hattı.
// ekran RGBA -> ödül bandı kırp -> gri (max kanal) + Otsu -> ters (koyu yazı/beyaz zemin) -> büyüt
// -> Tesseract (tur+eng, kelime kutuları) -> slot modeli (N=1..4, ölçek) -> bulanık eşleştirme.
import path from 'node:path';
import { PNG } from 'pngjs';
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import { FuzzyIndex } from '../shared/text';
import type { GameData, Lang, ScanResult, SlotResult } from '../shared/types';
import type { Domain } from './gamedata';

import { buildItemIndex, parseInventoryWords, parseOwnedBadges, type SeenItem } from './screeninv';

export interface RawImage { data: Buffer | Uint8Array; width: number; height: number } // RGBA

// 1920x1080 ve %100 arayüz ölçeğinde bir ödül slotunun genişliği (px)
const SLOT_1080 = 242;
// ödül adlarının aranacağı dikey bant (ekran yüksekliğine oran)
const BAND_TOP = 0.36;
const BAND_BOTTOM = 0.53;
const MIN_SCORE = 0.6;

export interface Word { text: string; x0: number; y0: number; x1: number; y1: number; conf: number }

// ---------- görüntü işlemleri ----------
export function crop(img: RawImage, x: number, y: number, w: number, h: number): RawImage {
  x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
  w = Math.min(img.width - x, Math.floor(w)); h = Math.min(img.height - y, Math.floor(h));
  const out = Buffer.alloc(w * h * 4);
  for (let r = 0; r < h; r++) {
    const src = ((y + r) * img.width + x) * 4;
    out.set(img.data.subarray(src, src + w * 4), r * w * 4);
  }
  return { data: out, width: w, height: h };
}

/**
 * İkili haritada (1 = yazı adayı) yazı yüksekliğinin çok üstündeki yatay/dikey
 * koşuları siler. İkonlar ve paneller büyük dolu bloklardır; harf darbeleri kısadır.
 */
export function removeBlobs(bin: Uint8Array, w: number, h: number, maxRun: number) {
  const kill = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!bin[y * w + x]) { x++; continue; }
      let e = x; while (e < w && bin[y * w + e]) e++;
      if (e - x > maxRun) for (let k = x; k < e; k++) kill[y * w + k] = 1;
      x = e;
    }
  }
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (!bin[y * w + x]) { y++; continue; }
      let e = y; while (e < h && bin[e * w + x]) e++;
      if (e - y > maxRun) for (let k = y; k < e; k++) kill[k * w + x] = 1;
      y = e;
    }
  }
  // silinen bölgeye bitişik ince kenar artıklarını da temizle (1 px genişlet)
  for (let i = 0; i < w * h; i++) {
    if (kill[i]) { bin[i] = 0; continue; }
    const x = i % w;
    if ((x > 0 && kill[i - 1]) || (x < w - 1 && kill[i + 1]) || (i >= w && kill[i - w]) || (i + w < w * h && kill[i + w])) bin[i] = 0;
  }
}

/** Gri (max kanal) + Otsu eşik + blob temizliği + ters + ölçek; PNG tamponu döner. */
export function binarize(img: RawImage, scale: number, textPx = 20): Buffer {
  const { width: w, height: h, data } = img;
  const gray = new Uint8Array(w * h);
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < w * h; i++) {
    const v = Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    gray[i] = v; hist[v]++;
  }
  const t = otsu(hist, w * h);
  const bin = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) bin[i] = gray[i] > t ? 1 : 0;
  removeBlobs(bin, w, h, Math.max(8, Math.round(textPx * 1.6)));
  for (let i = 0; i < w * h; i++) gray[i] = bin[i] ? 255 : 0;
  const W = Math.round(w * scale), H = Math.round(h * scale);
  const png = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = Math.min(w - 1.001, x / scale), sy = Math.min(h - 1.001, y / scale);
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      const a = gray[y0 * w + x0], b = gray[y0 * w + x0 + 1], c = gray[(y0 + 1) * w + x0], d = gray[(y0 + 1) * w + x0 + 1];
      const v = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
      const o = v > 127 ? 0 : 255;
      const k = (y * W + x) * 4;
      png.data[k] = png.data[k + 1] = png.data[k + 2] = o; png.data[k + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

function otsu(hist: number[], total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; t = i; }
  }
  return Math.min(250, t + 8);
}

export function decodePng(buf: Buffer): RawImage {
  const p = PNG.sync.read(buf);
  return { data: p.data, width: p.width, height: p.height };
}

/** Electron NativeImage.toBitmap() BGRA verir; RGBA'ya çevir. */
export function bgraToRgba(buf: Buffer): Buffer {
  const out = Buffer.from(buf);
  for (let i = 0; i < out.length; i += 4) { const b = out[i]; out[i] = out[i + 2]; out[i + 2] = b; }
  return out;
}

// ---------- eşleştirme ----------
export function buildRewardIndex(gd: GameData): FuzzyIndex<string> {
  const idx = new FuzzyIndex<string>();
  for (const ref of gd.rewardRefs) {
    const it = gd.items[ref];
    if (!it) continue;
    for (const lang of ['en', 'tr'] as const) {
      const n = it.name[lang]; if (n) idx.add(n, lang, ref);
      const a = it.alt?.[lang]; if (a) idx.add(a, lang, ref);
    }
  }
  return idx;
}

export interface SlotPick { text: string; ref: string | null; lang: string | null; score: number; x: number; width: number; y: number | null }

/**
 * Kelimeleri (ekran koordinatında) N slota dağıt, en iyi yapılandırmayı seç.
 * Gerçek oyun ekranında adların üstünde/altında başka yazılar (oyuncu adları, bonuslar) olur;
 * bu yüzden her slotta satırlar ayrı ayrı (ve iki satıra bölünmüş adlar için ardışık ikililer) denenir.
 */
export function assignSlots(words: Word[], screenW: number, screenH: number, index: FuzzyIndex<string>, uiScaleHint = 1): SlotPick[] {
  const useful = words.filter((w) => /[A-Za-zÇĞİÖŞÜçğıöşü]{2,}/.test(w.text));
  if (!useful.length) return [];
  const base = screenH / 1080;
  const scales = [...new Set([uiScaleHint, 0.8, 0.9, 1.0, 1.1, 1.2].map((s) => Math.round(s * 100) / 100))];
  let best: { total: number; picks: SlotPick[] } | null = null;
  const cx = screenW / 2;
  const cache = new Map<string, { value: string; score: number; lang: string } | null>();
  const match = (t: string) => {
    if (!cache.has(t)) cache.set(t, index.best(t) as { value: string; score: number; lang: string } | null);
    return cache.get(t)!;
  };
  for (const s of scales) {
    const W = SLOT_1080 * base * s;
    for (let n = 1; n <= 4; n++) {
      const picks: SlotPick[] = [];
      let total = 0;
      for (let k = 0; k < n; k++) {
        const x0 = cx + (k - n / 2) * W;
        const inSlot = useful.filter((w) => { const m = (w.x0 + w.x1) / 2; return m >= x0 && m < x0 + W; });
        const lines = toLines(inSlot);
        let pick: SlotPick = { text: '', ref: null, lang: null, score: 0, x: x0, width: W, y: null };
        const cands: { text: string; y: number }[] = [];
        lines.forEach((l, i) => {
          cands.push({ text: lineText(l), y: lineTop(l) });
          const nx = lines[i + 1];
          // iki satırlık ad: alt satır üstün hemen altında olmalı
          if (nx && lineTop(nx) - lineBottom(l) < (lineBottom(l) - lineTop(l)) * 1.2) cands.push({ text: `${lineText(l)} ${lineText(nx)}`, y: lineTop(l) });
        });
        for (const c of cands) {
          const m = match(c.text);
          const score = m?.score ?? 0;
          if (score > pick.score) pick = { text: c.text, ref: m && score >= MIN_SCORE ? m.value : null, lang: m?.lang ?? null, score, x: x0, width: W, y: c.y };
        }
        if (!pick.text && cands.length) pick.text = cands.map((c) => c.text).join(' | ');
        total += pick.score >= MIN_SCORE ? pick.score : pick.score - 0.6;
        picks.push(pick);
      }
      // ortalama: fazladan slot açmak toplamı şişirmesin; eşitlikte daha çok tanınan slot kazansın
      total = total / n + picks.filter((p) => p.ref).length * 0.05;
      // tanınan adlar aynı satırda olmalı (ödül adları hizalıdır)
      const ys = picks.filter((p) => p.ref && p.y != null).map((p) => p.y!);
      if (ys.length > 1 && Math.max(...ys) - Math.min(...ys) > 40 * base) total -= 0.3;
      if (!best || total > best.total + 1e-6) best = { total, picks };
    }
  }
  return best?.picks ?? [];
}

export function toLines(ws: Word[]): Word[][] {
  const sorted = [...ws].sort((a, b) => a.y0 - b.y0);
  const lines: Word[][] = [];
  for (const w of sorted) {
    const h = w.y1 - w.y0;
    const line = lines.find((l) => Math.abs((l[0].y0 + l[0].y1) / 2 - (w.y0 + w.y1) / 2) < h * 0.6);
    if (line) line.push(w); else lines.push([w]);
  }
  return lines.map((l) => l.sort((a, b) => a.x0 - b.x0)).sort((a, b) => lineTop(a) - lineTop(b));
}
export const lineText = (l: Word[]) => l.map((w) => w.text).join(' ');
export const lineTop = (l: Word[]) => Math.min(...l.map((w) => w.y0));
export const lineBottom = (l: Word[]) => Math.max(...l.map((w) => w.y1));

// ---------- tarayıcı ----------
export class RewardScanner {
  private worker: Promise<Worker> | null = null;
  private index: FuzzyIndex<string>;
  private itemIndex: FuzzyIndex<string> | null = null;

  constructor(private gd: GameData, private tessdataDir: string, private cacheDir: string) {
    this.index = buildRewardIndex(gd);
  }

  private getWorker(): Promise<Worker> {
    if (!this.worker) {
      this.worker = (async () => {
        const w = await createWorker(['tur', 'eng'], OEM.LSTM_ONLY, {
          langPath: this.tessdataDir, cachePath: this.cacheDir, gzip: false, cacheMethod: 'none',
        });
        await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '1' });
        return w;
      })();
    }
    return this.worker;
  }

  async ocrWords(img: RawImage): Promise<Word[]> {
    const { width: W, height: H } = img;
    const base = H / 1080;
    const bandW = Math.min(W, SLOT_1080 * base * 1.25 * 4 + 40);
    // yazı yüksekliği tahmini: 1080p %100'de ~19px; en büyük UI ölçeği için pay bırak
    return this.ocrRegion(img, (W - bandW) / 2, H * BAND_TOP, bandW, H * (BAND_BOTTOM - BAND_TOP), 19 * base * 1.25, Math.max(1, Math.min(3, 2.2 / base)));
  }

  /** Ekranın bir bölgesini OCR'la; kelime kutuları ekran koordinatında döner. */
  async ocrRegion(img: RawImage, bx: number, by: number, bw: number, bh: number, textPx: number, up: number): Promise<Word[]> {
    bx = Math.max(0, Math.round(bx)); by = Math.max(0, Math.round(by));
    const band = crop(img, bx, by, Math.min(bw, img.width - bx), Math.min(bh, img.height - by));
    const png = binarize(band, up, textPx);
    const worker = await this.getWorker();
    const { data } = await worker.recognize(png, {}, { blocks: true, text: false });
    const words: Word[] = [];
    for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) for (const w of l.words) {
      words.push({
        text: w.text, conf: w.confidence,
        x0: bx + w.bbox.x0 / up, x1: bx + w.bbox.x1 / up, y0: by + w.bbox.y0 / up, y1: by + w.bbox.y1 / up,
      });
    }
    return words;
  }

  async scan(img: RawImage, domain: Domain, uiScaleHint = 1): Promise<ScanResult> {
    const t0 = Date.now();
    const words = await this.ocrWords(img);
    const picks = assignSlots(words, img.width, img.height, this.index, uiScaleHint);
    const langVotes: Record<string, number> = {};
    const slots: SlotResult[] = picks.map((p) => {
      if (p.ref && p.lang) langVotes[p.lang] = (langVotes[p.lang] ?? 0) + 1;
      const it = p.ref ? this.gd.items[p.ref] : null;
      return {
        text: p.text, uniqueName: p.ref, name: it?.name ?? null, score: Math.round(p.score * 100) / 100,
        plat: p.ref ? domain.plat(p.ref) : null, ducats: p.ref ? domain.ducats(p.ref) : null,
        owned: p.ref ? domain.count(p.ref) : 0, vaulted: !!it?.vaulted, set: p.ref ? domain.setInfo(p.ref) : null,
        x: p.x, y: p.y ?? img.height * BAND_TOP, width: p.width, seenOwned: null,
      };
    });
    // parçaların üstündeki "N Mevcut / N Owned" rozetleri: oyunun kendi söylediği adet
    if (slots.some((x) => x.uniqueName)) {
      try {
        const H = img.height, base = H / 1080;
        const x0 = Math.min(...slots.map((x) => x.x)), x1 = Math.max(...slots.map((x) => x.x + x.width));
        const badge = await this.ocrRegion(img, x0, H * 0.17, x1 - x0, H * 0.1, 14 * base * 1.25, Math.max(1, Math.min(3, 2.6 / base)));
        parseOwnedBadges(badge, slots).forEach((n, i) => { if (n != null && slots[i].uniqueName) slots[i].seenOwned = n; });
      } catch { /* rozet okunamazsa kart yine çıkar */ }
    }
    let bestIndex = -1, bestVal = -1;
    slots.forEach((s, i) => {
      const v = s.plat ?? (s.ducats != null ? s.ducats / 10 : -1);
      if (s.uniqueName && v > bestVal) { bestVal = v; bestIndex = i; }
    });
    const lang = (Object.entries(langVotes).sort((a, b) => b[1] - a[1])[0]?.[0] as Lang | undefined) ?? null;
    return {
      ts: new Date().toISOString(), lang, ms: Date.now() - t0,
      screen: { width: img.width, height: img.height }, slots, bestIndex,
    };
  }

  /** Oyundaki Envanter/Dökümhane ekranından görünen eşyaları ve adetlerini oku. */
  async scanInventory(img: RawImage): Promise<{ items: SeenItem[]; ms: number }> {
    const t0 = Date.now();
    const H = img.height, base = H / 1080;
    // üst menü ve alt ipucu çubuğu hariç tüm ekran
    const words = await this.ocrRegion(img, 0, H * 0.08, img.width, H * 0.86, 16 * base * 1.25, Math.max(1, Math.min(2.5, 2 / base)));
    if (!this.itemIndex) this.itemIndex = buildItemIndex(this.gd);
    return { items: parseInventoryWords(words, this.itemIndex, H), ms: Date.now() - t0 };
  }

  async dispose() {
    if (this.worker) { const w = await this.worker; await w.terminate(); this.worker = null; }
  }
}

export function defaultTessdataDir(resourcesDir: string) { return path.join(resourcesDir, 'tessdata'); }
