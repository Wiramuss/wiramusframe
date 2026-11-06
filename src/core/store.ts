// Yerel JSON depolama (%APPDATA%/WiramusFrame). Atomik yazma: önce .tmp, sonra rename.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Inventory, Prices, ScanResult, Settings, SniperRule, StatPoint } from '../shared/types';

export const DEFAULT_SETTINGS: Settings = {
  uiLang: 'tr',
  gameLang: 'auto',
  uiScale: 1,
  onboarded: false,
  termsAcceptedAt: null,
  overlay: { enabled: true, seconds: 12 },
  memoryReader: { enabled: false, consentAt: null },
  eeLogPath: path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Warframe', 'EE.log'),
  wfm: { user: null, tokenEnc: null },
};

export class Store {
  constructor(public dir: string) { fs.mkdirSync(dir, { recursive: true }); }

  private p(name: string) { return path.join(this.dir, name); }

  read<T>(name: string, fallback: T): T {
    try { return JSON.parse(fs.readFileSync(this.p(name), 'utf8')) as T; } catch { return fallback; }
  }

  write(name: string, data: unknown) {
    const tmp = this.p(name + '.tmp');
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, this.p(name));
  }

  append(name: string, line: unknown, keep = 0) {
    fs.appendFileSync(this.p(name), JSON.stringify(line) + '\n');
    if (keep) {
      const lines = this.lines<unknown>(name);
      if (lines.length > keep * 1.5) fs.writeFileSync(this.p(name), lines.slice(-keep).map((l) => JSON.stringify(l)).join('\n') + '\n');
    }
  }

  lines<T>(name: string): T[] {
    try {
      return fs.readFileSync(this.p(name), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);
    } catch { return []; }
  }

  settings(): Settings {
    const s = this.read<Partial<Settings>>('settings.json', {});
    return { ...DEFAULT_SETTINGS, ...s, overlay: { ...DEFAULT_SETTINGS.overlay, ...s.overlay },
      memoryReader: { ...DEFAULT_SETTINGS.memoryReader, ...s.memoryReader }, wfm: { ...DEFAULT_SETTINGS.wfm, ...s.wfm } };
  }
  saveSettings(s: Settings) { this.write('settings.json', s); }

  inventory(): Inventory | null { return this.read<Inventory | null>('inventory.json', null); }
  saveInventory(inv: Inventory) {
    this.write('inventory.json', inv);
    const last = this.lines<StatPoint>('stats.jsonl').at(-1);
    if (!last || Date.parse(inv.syncedAt) - Date.parse(last.ts) > 3600_000) {
      this.append('stats.jsonl', { ts: inv.syncedAt, platinum: inv.platinum, credits: inv.credits, ducats: inv.ducats, endo: inv.endo });
    }
  }

  prices(): Prices { return this.read<Prices>('prices.json', { fetchedAt: null, bySlug: {} }); }
  savePrices(p: Prices) { this.write('prices.json', p); }

  stats(): StatPoint[] { return this.lines<StatPoint>('stats.jsonl'); }
  scans(): ScanResult[] { return this.lines<ScanResult>('scans.jsonl'); }
  addScan(s: ScanResult) { this.append('scans.jsonl', s, 200); }

  sniper(): SniperRule[] { return this.read<SniperRule[]>('sniper.json', []); }
  saveSniper(r: SniperRule[]) { this.write('sniper.json', r); }
}
