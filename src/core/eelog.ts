// EE.log takibi: dosyanın sonuna eklenen satırları okur, relic ödül ekranı açıldığında olay üretir.
import fs from 'node:fs';
import { EventEmitter } from 'node:events';

// Ödül ekranı satırları (gerçek EE.log'dan doğrulandı, 2026-11-06):
//   VoidProjections: OpenVoidProjectionRewardScreen      -> ekran açıldı (adlar ~1-3 sn içinde görünür)
//   ProjectionRewardChoice.lua: Got rewards              -> tüm oyuncuların ödülleri geldi
//   ProjectionRewardChoice.lua: Relic reward screen shut down / CloseVoidProjectionRewardScreen -> kapandı
// Not: "Created .../ProjectionRewardChoice.swf" ve "Relic rewards initialized" relic SEÇİM anında yazılır, ödül değil.
import { relicFromLogLine } from './screeninv';

export const REWARD_PATTERNS = [
  /OpenVoidProjectionRewardScreen/i,
  /ProjectionRewardChoice\.lua: Got rewards/i,
];
export const CLOSE_PATTERNS = [
  /Relic reward screen shut down/i,
  /CloseVoidProjectionRewardScreen/i,
];

export function isRewardLine(line: string): boolean {
  return REWARD_PATTERNS.some((r) => r.test(line));
}
export function isCloseLine(line: string): boolean {
  return CLOSE_PATTERNS.some((r) => r.test(line));
}

export class EELogWatcher extends EventEmitter {
  private pos = 0;
  private timer: NodeJS.Timeout | null = null;
  private lastFire = 0;
  private partial = '';

  constructor(private file: string, private debounceMs = 8000) { super(); }

  get exists() { return fs.existsSync(this.file); }

  start() {
    try { this.pos = fs.statSync(this.file).size; } catch { this.pos = 0; }
    this.timer = setInterval(() => this.poll(), 500);
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  setFile(file: string) { this.stop(); this.file = file; this.start(); }

  poll() {
    let size: number;
    try { size = fs.statSync(this.file).size; } catch { return; }
    if (size < this.pos) this.pos = 0; // oyun yeniden başladı, log sıfırlandı
    if (size === this.pos) return;
    const len = Math.min(size - this.pos, 4 * 1024 * 1024);
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(this.file, 'r');
    try { fs.readSync(fd, buf, 0, len, this.pos); } finally { fs.closeSync(fd); }
    this.pos += len;
    const lines = (this.partial + buf.toString('utf8')).split(/\r?\n/);
    this.partial = lines.pop() ?? '';
    for (const line of lines) {
      if (isCloseLine(line)) { this.emit('close', line); continue; }
      const relic = relicFromLogLine(line);
      if (relic) { this.emit('relic', relic); continue; }
      if (isRewardLine(line) && Date.now() - this.lastFire > this.debounceMs) {
        this.lastFire = Date.now();
        this.emit('reward', line);
      }
    }
  }
}
