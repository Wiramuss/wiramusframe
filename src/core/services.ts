// Uygulama servisi: Electron'dan bağımsız iş mantığı. main.ts ekran yakalama, overlay,
// bildirim ve şifreleme fonksiyonlarını enjekte eder; IPC kanalları `handlers` üzerinden açılır.
import fs from 'node:fs';
import path from 'node:path';
import type { GameData, Inventory, Refinement, ScanResult, Settings, SniperRule, Status } from '../shared/types';
import { EELogWatcher } from './eelog';
import { Domain, loadGameData } from './gamedata';
import { parseInventory } from './inventory';
import { mergeSeen } from './screeninv';
import { findGamePid, readSession, type Session } from './memory';
import * as net from './net';
import { PNG } from 'pngjs';
import { decodePng, RewardScanner, type RawImage } from './rewards';
import { Store } from './store';

export interface Host {
  resourcesDir: string;
  userDir: string;
  capture(): Promise<RawImage>;
  showOverlay(scan: ScanResult, seconds: number): void;
  hideOverlay(): void;
  notify(title: string, body: string): void;
  encrypt(s: string): string;
  decrypt(s: string): string;
  emit(event: string, data: unknown): void;
}

export class AppService {
  gd: GameData;
  store: Store;
  scanner: RewardScanner;
  watcher: EELogWatcher;
  private session: Session | null = null;
  private memState: Status['memoryReader'] = 'off';
  private memError: string | undefined;
  private gameRunning = false;
  private lastScan: ScanResult | null = null;
  private timers: NodeJS.Timeout[] = [];
  private scanning = false;
  private rewardOpen = false;
  /** EE.log'da son yüklenen (açılmak üzere seçilen) relic; ödül ekranı gelince envanterden düşülür. */
  private pendingRelic: string | null = null;

  constructor(private host: Host) {
    this.store = new Store(host.userDir);
    const userData = path.join(host.userDir, 'gamedata.json');
    const bundled = path.join(host.resourcesDir, 'gamedata.json');
    this.gd = loadGameData(fs.existsSync(userData) && fs.statSync(userData).mtimeMs > fs.statSync(bundled).mtimeMs ? userData : bundled);
    const cache = path.join(host.userDir, 'tess-cache');
    fs.mkdirSync(cache, { recursive: true });
    this.scanner = new RewardScanner(this.gd, path.join(host.resourcesDir, 'tessdata'), cache);
    this.watcher = new EELogWatcher(this.settings.eeLogPath);
    this.lastScan = this.store.scans().at(-1) ?? null;
  }

  get settings(): Settings { return this.store.settings(); }
  domain(): Domain { return new Domain(this.gd, this.store.prices(), this.store.inventory()); }

  start() {
    this.watcher.on('relic', (ref: string) => { this.pendingRelic = ref; this.debug(`relic seçildi: ${ref}`); });
    this.watcher.on('reward', (line: string) => { this.rewardOpen = true; this.consumeRelic(); void this.autoScan(line); });
    this.watcher.on('close', () => { this.rewardOpen = false; this.host.hideOverlay(); });
    this.watcher.start();
    void this.refreshPricesIfStale();
    this.timers.push(setInterval(() => void this.refreshPricesIfStale(), 15 * 60_000));
    this.timers.push(setInterval(() => void this.tickGame(), 30_000));
    this.timers.push(setInterval(() => void this.runSniper(), 5 * 60_000));
    void this.tickGame();
  }

  async stop() {
    this.timers.forEach(clearInterval);
    this.watcher.stop();
    await this.scanner.dispose();
  }

  // ---------- ödül taraması ----------
  /** EE.log tetiklediğinde: ekran tam açılmamış olabilir, tanınana kadar birkaç kez dene. */
  private async autoScan(line: string) {
    this.debug(`tetik: ${line.trim().slice(0, 240)}`);
    for (const wait of [1200, 1500, 2000, 2500]) {
      await new Promise((res) => setTimeout(res, wait));
      if (!this.rewardOpen) return; // ekran kapandı
      const res = await this.scanNow('log');
      const ok = res?.slots.filter((x) => x.uniqueName).length ?? 0;
      this.debug(`tarama: ${ok}/${res?.slots.length ?? 0} tanındı, ${res?.ms ?? 0} ms, dil=${res?.lang ?? '-'} | ${res?.slots.map((x) => x.text).join(' | ') ?? ''}`);
      if (ok >= 2 || (res && ok >= 1 && ok === res.slots.length)) return;
    }
  }

  /** Ödül ekranı açıldı: seçilen relic harcandı, envanterden bir tane düş (bellek okumadan takip). */
  private consumeRelic() {
    const ref = this.pendingRelic; this.pendingRelic = null;
    const inv = this.store.inventory();
    if (!ref || !inv || !(inv.counts[ref] > 0)) return;
    inv.counts = { ...inv.counts, [ref]: inv.counts[ref] - 1 };
    this.store.saveInventory(inv);
    this.host.emit('inventory', inv.syncedAt);
    this.debug(`relic düşüldü: ${ref} -> ${inv.counts[ref]}`);
  }

  /** Oyunda açık Envanter/Dökümhane ekranını oku ve görülen adetleri envantere yaz. */
  async scanInventoryScreen(img?: RawImage): Promise<{ items: { ref: string; count: number; name: unknown }[]; ms: number }> {
    if (this.scanning) throw new Error('Başka bir tarama sürüyor.');
    this.scanning = true;
    try {
      const shot = img ?? await this.host.capture();
      if (!img) this.keepCapture(shot);
      const { items, ms } = await this.scanner.scanInventory(shot);
      if (items.length) {
        const inv = mergeSeen(this.store.inventory(), items);
        this.store.saveInventory(inv);
        this.host.emit('inventory', inv.syncedAt);
      }
      this.debug(`envanter taraması: ${items.length} eşya, ${ms} ms`);
      const named = items.map((x) => ({ ref: x.ref, count: x.count, name: this.gd.items[x.ref]?.name ?? this.gd.relics[x.ref]?.name ?? null }));
      this.host.emit('invscan', named);
      return { items: named, ms };
    } finally { this.scanning = false; }
  }

  /** Gerçek oyunda doğrulama için: tetik satırları ve tarama sonuçları userData/scan-debug.log */
  private debug(msg: string) {
    try { fs.appendFileSync(path.join(this.host.userDir, 'scan-debug.log'), `${new Date().toISOString()} ${msg}
`); } catch { /* yoksay */ }
  }

  /** Son 10 gerçek ekran görüntüsünü saklar (OCR ayarı için). */
  private keepCapture(img: RawImage) {
    try {
      const dir = path.join(this.host.userDir, 'captures');
      fs.mkdirSync(dir, { recursive: true });
      const png = new PNG({ width: img.width, height: img.height });
      Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength).copy(png.data);
      fs.writeFileSync(path.join(dir, `${Date.now()}.png`), PNG.sync.write(png));
      const files = fs.readdirSync(dir).sort();
      for (const f of files.slice(0, Math.max(0, files.length - 30))) fs.unlinkSync(path.join(dir, f));
    } catch { /* yoksay */ }
  }

  async scanNow(trigger: 'log' | 'hotkey' | 'test', img?: RawImage): Promise<ScanResult | null> {
    if (this.scanning) return null;
    this.scanning = true;
    try {
      const shot = img ?? await this.host.capture();
      if (!img) this.keepCapture(shot);
      const s = this.settings;
      const res = await this.scanner.scan(shot, this.domain(), s.uiScale);
      // toplu listede fiyatı olmayan ama satılabilir eşyalar için anlık fiyat
      await Promise.all(res.slots.map(async (slot) => {
        const slug = slot.uniqueName ? this.gd.items[slot.uniqueName]?.slug : null;
        if (slot.plat == null && slug) slot.plat = await net.fetchItemPrice(slug).catch(() => null);
      }));
      const recognised = res.slots.some((x) => x.uniqueName);
      // oyunun gösterdiği "N Mevcut" adetlerini envantere yaz
      const seen = res.slots.filter((x) => x.uniqueName && x.seenOwned != null).map((x) => ({ ref: x.uniqueName!, count: x.seenOwned! }));
      if (seen.length) {
        const inv = mergeSeen(this.store.inventory(), seen);
        this.store.saveInventory(inv);
        this.host.emit('inventory', inv.syncedAt);
        for (const x of res.slots) if (x.seenOwned != null) x.owned = x.seenOwned;
      }
      // başarısız otomatik denemeler geçmişi doldurmasın
      if (recognised || trigger !== 'log') { this.lastScan = res; this.store.addScan(res); }
      // log tetiklemesinde hiçbir şey tanınmadıysa oyunun üstüne boş kart koyma
      if (s.overlay.enabled && trigger !== 'test' && (recognised || trigger === 'hotkey')) this.host.showOverlay(res, trigger === 'log' ? Math.max(40, s.overlay.seconds) : s.overlay.seconds);
      this.host.emit('scan', res);
      return res;
    } finally {
      this.scanning = false;
    }
  }

  // ---------- oyun / envanter ----------
  private async tickGame() {
    const pid = await findGamePid();
    this.gameRunning = pid != null;
    if (!this.settings.memoryReader.enabled) { this.memState = 'off'; return; }
    if (!pid) { this.memState = 'waiting'; return; }
    const inv = this.store.inventory();
    if (!inv || Date.now() - Date.parse(inv.syncedAt) > 90_000) await this.syncInventory().catch(() => undefined);
  }

  async syncInventory(): Promise<Inventory> {
    const s = this.settings;
    if (!s.memoryReader.enabled || !s.memoryReader.consentAt) throw new Error('Otomatik envanter kapalı. Ayarlardan onay verip açın.');
    const pid = await findGamePid();
    if (!pid) { this.memState = 'waiting'; throw new Error('Warframe çalışmıyor.'); }
    try {
      let raw: unknown;
      try {
        if (!this.session) throw new Error('no session');
        raw = await net.fetchInventory(this.session.accountId, this.session.nonce);
      } catch {
        this.session = await readSession(pid);
        if (!this.session) throw new Error('Oturum bilgisi bulunamadı. Oyunda giriş yaptıktan sonra bir relay veya dojo\'ya gidip tekrar deneyin.');
        raw = await net.fetchInventory(this.session.accountId, this.session.nonce);
      }
      const inv = parseInventory(raw as Record<string, unknown>, this.gd, 'memory');
      this.store.saveInventory(inv);
      this.memState = 'connected'; this.memError = undefined;
      this.host.emit('inventory', inv.syncedAt);
      return inv;
    } catch (e) {
      this.memState = 'error'; this.memError = (e as Error).message;
      throw e;
    }
  }

  importInventory(file: string): Inventory {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const inv = parseInventory(raw, this.gd, 'import');
    this.store.saveInventory(inv);
    this.host.emit('inventory', inv.syncedAt);
    return inv;
  }

  // ---------- fiyat / veri ----------
  async refreshPricesIfStale(force = false) {
    const p = this.store.prices();
    if (!force && p.fetchedAt && Date.now() - Date.parse(p.fetchedAt) < 3600_000) return p;
    try {
      const fresh = await net.fetchPrices(this.gd);
      this.store.savePrices(fresh);
      this.host.emit('prices', fresh.fetchedAt);
      return fresh;
    } catch { return p; }
  }

  // ---------- sniper ----------
  async runSniper() {
    const rules = this.store.sniper();
    let changed = false;
    for (const r of rules) {
      const list = await net.searchRivens(r.weapon, r.positives).catch(() => []);
      for (const a of list) {
        if (a.price <= r.maxPrice && !r.seen.includes(a.id)) {
          r.seen.push(a.id); changed = true;
          this.host.notify('Riven bulundu', `${a.weapon} ${a.name} — ${a.price} platin (${a.seller})`);
        }
      }
      r.seen = r.seen.slice(-300);
    }
    if (changed) this.store.saveSniper(rules);
  }

  status(): Status {
    const inv = this.store.inventory();
    return {
      gameRunning: this.gameRunning, eeLogFound: this.watcher.exists, memoryReader: this.memState, memoryError: this.memError,
      inventorySyncedAt: inv?.syncedAt ?? null, dataBuiltAt: this.gd.builtAt, pricesFetchedAt: this.store.prices().fetchedAt,
      wfmUser: this.settings.wfm.user, lastScan: this.lastScan,
    };
  }

  private wfmToken(): string {
    const enc = this.settings.wfm.tokenEnc;
    if (!enc) throw new Error('warframe.market hesabı bağlı değil.');
    return this.host.decrypt(enc);
  }

  /** IPC kanalları. Girdi her zaman tek bir nesne/değer. */
  handlers(): Record<string, (arg: any) => unknown> {
    return {
      'status': () => this.status(),
      'settings:get': () => this.settings,
      'settings:set': (patch: Partial<Settings>) => {
        const cur = this.settings;
        const next: Settings = { ...cur, ...patch, overlay: { ...cur.overlay, ...patch.overlay },
          memoryReader: { ...cur.memoryReader, ...patch.memoryReader }, wfm: cur.wfm };
        if (patch.memoryReader?.enabled && !cur.memoryReader.consentAt) next.memoryReader.consentAt = new Date().toISOString();
        if (patch.eeLogPath && patch.eeLogPath !== cur.eeLogPath) this.watcher.setFile(patch.eeLogPath);
        this.store.saveSettings(next);
        return next;
      },
      'data:refresh': () => this.refreshPricesIfStale(true),
      'inventory:sync': () => this.syncInventory(),
      'inventory:import': (file: string) => this.importInventory(file),
      'inventory:screenScan': () => this.scanInventoryScreen(),
      'inventory:summary': () => {
        const inv = this.store.inventory();
        if (!inv) return null;
        const d = this.domain();
        const byBp = new Map(Object.entries(this.gd.recipes).map(([res, r]) => [r.blueprint, res]));
        return { syncedAt: inv.syncedAt, source: inv.source, mr: inv.mr, platinum: inv.platinum, credits: inv.credits,
          ducats: inv.ducats, endo: inv.endo, rivens: inv.rivens.length,
          foundry: inv.foundry.map((f) => ({ ...f, name: d.itemName(byBp.get(f.item) ?? f.item) })) };
      },
      'data:icons': () => this.domain().icons(),
      'inventory:rows': () => this.domain().inventoryRows(),
      'foundry:rows': () => this.domain().foundry(),
      'item:detail': (un: string) => this.domain().detail(un),
      'relics:plan': (a: { refinement: Refinement; owned: boolean }) => this.domain().relicPlan(a.refinement, a.owned),
      'sets:rows': () => this.domain().sets(),
      'mastery:summary': () => {
        const m = this.domain().mastery();
        return { ...m, missing: m.missing.slice(0, 400) };
      },
      'mastery:plan': () => this.domain().masteryPlan(),
      'rivens:rows': () => this.store.inventory()?.rivens ?? [],
      'rivens:weapons': () => Object.values(this.gd.rivenWeapons).sort((a, b) => a.name.localeCompare(b.name)),
      'rivens:attrs': () => Object.values(this.gd.rivenAttrs),
      'rivens:search': (a: { weapon: string; positives: string[]; negative?: string }) => net.searchRivens(a.weapon, a.positives, a.negative),
      'sniper:list': () => this.store.sniper(),
      'sniper:add': (r: Omit<SniperRule, 'id' | 'seen'>) => {
        const list = this.store.sniper();
        list.push({ ...r, id: Math.random().toString(36).slice(2), seen: [] });
        this.store.saveSniper(list);
        void this.runSniper();
        return list;
      },
      'sniper:remove': (id: string) => { const l = this.store.sniper().filter((r) => r.id !== id); this.store.saveSniper(l); return l; },
      'stats:series': () => this.store.stats(),
      'scans:list': () => this.store.scans().slice(-50).reverse(),
      'scan:test': async (file?: string) => this.scanNow('test', file ? decodePng(fs.readFileSync(file)) : undefined),
      'scan:now': () => this.scanNow('hotkey'),
      'wfm:login': async (a: { email: string; password: string }) => {
        const { token, user } = await net.wfmLogin(a.email, a.password);
        const s = this.settings;
        s.wfm = { user, tokenEnc: this.host.encrypt(token) };
        this.store.saveSettings(s);
        return user;
      },
      'wfm:logout': () => { const s = this.settings; s.wfm = { user: null, tokenEnc: null }; this.store.saveSettings(s); return true; },
      'wfm:orders': () => net.wfmMyOrders(this.wfmToken()),
      'wfm:create': async (a: { slug: string; platinum: number; quantity: number }) => {
        const id = await net.wfmItemId(a.slug);
        return net.wfmCreateOrder(this.wfmToken(), id, a.platinum, a.quantity);
      },
      'wfm:remove': (orderId: string) => net.wfmDeleteOrder(this.wfmToken(), orderId),
      'price:item': (slug: string) => net.fetchItemPrice(slug),
      'analytics:top': () => {
        const p = this.store.prices();
        const bySlug = new Map(Object.values(this.gd.items).filter((i) => i.slug).map((i) => [i.slug!, i]));
        return Object.entries(p.bySlug).map(([slug, v]) => ({
          slug, name: bySlug.get(slug)?.name ?? { en: slug }, plat: v.plat, vol: v.vol, value: v.plat * v.vol,
        })).sort((a, b) => b.value - a.value).slice(0, 100);
      },
    };
  }
}
