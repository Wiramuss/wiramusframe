// Electron ana süreç: pencereler, overlay, ekran yakalama, IPC köprüsü.
import { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, ipcMain, Notification, safeStorage, screen, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { AppService } from '../core/services';
import { bgraToRgba } from '../core/rewards';
import type { ScanResult } from '../shared/types';

const DEV = process.argv.includes('--dev');
const argOf = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
// geliştirme: ayrı profil klasörü ve otomatik ekran görüntüleri (replica/clone-screens)
const PROFILE = argOf('profile');
const SHOTS = argOf('shots');
if (PROFILE) app.setPath('userData', path.resolve(PROFILE));
else migrateOldProfile();

/** Eski adla (tenno-tr) kaydedilmiş ayar/envanter varsa yeni klasöre bir kez kopyala. */
function migrateOldProfile() {
  try {
    const now = app.getPath('userData');
    const old = path.join(app.getPath('appData'), 'tenno-tr');
    if (fs.existsSync(old) && !fs.existsSync(path.join(now, 'settings.json'))) {
      fs.mkdirSync(now, { recursive: true });
      for (const f of ['settings.json', 'inventory.json', 'gamedata.json']) {
        const src = path.join(old, f);
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(now, f));
      }
    }
  } catch { /* taşıma başarısızsa temiz profille başla */ }
}
const ROOT = path.join(__dirname, '..');
const resourcesDir = app.isPackaged ? path.join(process.resourcesPath, 'app-res') : path.join(ROOT, 'resources');
const rendererDir = path.join(ROOT, 'dist');

let mainWin: BrowserWindow | null = null;
let overlayWin: BrowserWindow | null = null;
let overlayTimer: NodeJS.Timeout | null = null;
let service: AppService;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); } });

function createMain() {
  mainWin = new BrowserWindow({
    width: 1320, height: 840, minWidth: 980, minHeight: 620, backgroundColor: '#0d1117', title: 'WiramusFrame',
    icon: path.join(resourcesDir, 'icon.png'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  void mainWin.loadFile(path.join(rendererDir, 'index.html'));
  mainWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
  if (DEV) mainWin.webContents.openDevTools({ mode: 'detach' });
  mainWin.on('closed', () => { mainWin = null; app.quit(); });
}

function createOverlay() {
  const d = screen.getPrimaryDisplay();
  overlayWin = new BrowserWindow({
    x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
    transparent: true, frame: false, resizable: false, movable: false, focusable: false, skipTaskbar: true,
    hasShadow: false, show: false, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setIgnoreMouseEvents(true);
  overlayWin.setVisibleOnAllWorkspaces(true);
  void overlayWin.loadFile(path.join(rendererDir, 'overlay.html'));
}

async function capture() {
  const d = screen.getPrimaryDisplay();
  const w = Math.round(d.size.width * d.scaleFactor), h = Math.round(d.size.height * d.scaleFactor);
  if (overlayWin?.isVisible()) overlayWin.hide();
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: w, height: h } });
  const src = sources.find((s) => s.display_id === String(d.id)) ?? sources[0];
  if (!src) throw new Error('Ekran yakalanamadı');
  const img = src.thumbnail;
  const size = img.getSize();
  return { data: bgraToRgba(img.toBitmap()), width: size.width, height: size.height };
}

function showOverlay(scan: ScanResult, seconds: number) {
  if (!overlayWin) return;
  const d = screen.getPrimaryDisplay();
  // yakalanan görüntü fiziksel piksel; overlay DIP kullanır
  const k = d.size.width / scan.screen.width;
  overlayWin.webContents.send('overlay:show', { ...scan, k });
  overlayWin.showInactive();
  if (overlayTimer) clearTimeout(overlayTimer);
  overlayTimer = setTimeout(() => overlayWin?.hide(), seconds * 1000);
}

app.whenReady().then(() => {
  service = new AppService({
    resourcesDir,
    userDir: app.getPath('userData'),
    capture,
    showOverlay,
    hideOverlay: () => { if (overlayTimer) clearTimeout(overlayTimer); overlayWin?.hide(); },
    notify: (title, body) => { if (Notification.isSupported()) new Notification({ title, body }).show(); },
    encrypt: (s) => safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(s).toString('base64') : Buffer.from(s).toString('base64'),
    decrypt: (s) => safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(s, 'base64')) : Buffer.from(s, 'base64').toString(),
    emit: (event, data) => { mainWin?.webContents.send('event', { event, data }); },
  });

  for (const [channel, fn] of Object.entries(service.handlers())) {
    ipcMain.handle(channel, async (_e, arg) => {
      try { return { ok: true, data: await fn(arg) }; } catch (err) { return { ok: false, error: (err as Error).message }; }
    });
  }
  ipcMain.handle('dialog:open', async (_e, filters: { name: string; extensions: string[] }[]) => {
    const r = await dialog.showOpenDialog(mainWin!, { properties: ['openFile'], filters });
    return { ok: true, data: r.canceled ? null : r.filePaths[0] };
  });
  ipcMain.handle('open:external', async (_e, url: string) => {
    if (/^https:\/\/(warframe\.market|wiki\.warframe\.com|riven\.market)\//.test(url)) await shell.openExternal(url);
    return { ok: true, data: true };
  });

  createMain();
  createOverlay();
  service.start();
  globalShortcut.register('CommandOrControl+Shift+R', () => { void service.scanNow('hotkey'); });
  // envanter ekranı taraması: oyunda Envanter/Dökümhane açıkken
  globalShortcut.register('CommandOrControl+Shift+I', () => {
    void service.scanInventoryScreen()
      .then((r) => new Notification({ title: 'WiramusFrame', body: r.items.length ? `${r.items.length} eşya okundu ve envantere eklendi.` : 'Ekranda eşya bulunamadı. Envanter sayfası açık mı?' }).show())
      .catch((e: Error) => new Notification({ title: 'WiramusFrame', body: e.message }).show());
  });
  if (SHOTS) void takeShots(SHOTS);
});

async function takeShots(dir: string) {
  const fs = await import('node:fs');
  fs.mkdirSync(dir, { recursive: true });
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  await wait(4000);
  const pages = ['overview', 'overlay', 'inventory', 'relics', 'sets', 'foundry', 'mastery', 'rivens', 'market', 'stats', 'analytics', 'settings'];
  for (const p of pages) {
    await mainWin!.webContents.executeJavaScript(`document.querySelector('a[href="#${p}"]')?.click()`);
    await wait(1500);
    const img = await mainWin!.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${p}.png`), img.toPNG());
  }
  // overlay: örnek bir ödül ekranını tara ve overlay penceresini yakala
  const sample = argOf('sample');
  if (sample && overlayWin) {
    const { decodePng } = await import('../core/rewards');
    await service.scanNow('log', decodePng(fs.readFileSync(sample)));
    await wait(1200);
    fs.writeFileSync(path.join(dir, 'O1-overlay.png'), (await overlayWin.webContents.capturePage()).toPNG());
    await mainWin!.webContents.executeJavaScript(`document.querySelector('a[href="#overlay"]')?.click()`);
    await wait(1200);
    fs.writeFileSync(path.join(dir, 'overlay-history.png'), (await mainWin!.webContents.capturePage()).toPNG());
  }
  app.quit();
}

app.on('will-quit', () => { globalShortcut.unregisterAll(); void service?.stop(); });
app.on('window-all-closed', () => app.quit());
