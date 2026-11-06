// Uygulama kabuğu: kenar menü, üst durum çubuğu (S02), sayfa yönlendirme, dil bağlamı.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Boxes, Crosshair, Gem, Hammer, LayoutDashboard, LineChart as LineIcon, ScanLine, Settings as Cog, ShoppingCart, Sparkles, Trophy } from 'lucide-react';
import type { Settings, Status } from '../shared/types';
import { call } from './api';
import { fmtAgo, I18nCtx, makeT, type Key } from './i18n';
import {
  AnalyticsPage, FoundryPage, InventoryPage, ItemDrawer, MarketPage, MasteryPage, Onboarding, Overview, TermsGate, OverlayPage,
  RelicsPage, RivensPage, SetsPage, SettingsPage, StatsPage,
} from './pages';
import { ToastHost } from './ui';

const NAV: { id: string; key: Key; icon: typeof Boxes }[] = [
  { id: 'overview', key: 'nav.overview', icon: LayoutDashboard },
  { id: 'overlay', key: 'nav.overlay', icon: ScanLine },
  { id: 'inventory', key: 'nav.inventory', icon: Boxes },
  { id: 'relics', key: 'nav.relics', icon: Gem },
  { id: 'sets', key: 'nav.sets', icon: Sparkles },
  { id: 'foundry', key: 'nav.foundry', icon: Hammer },
  { id: 'mastery', key: 'nav.mastery', icon: Trophy },
  { id: 'rivens', key: 'nav.rivens', icon: Crosshair },
  { id: 'market', key: 'nav.market', icon: ShoppingCart },
  { id: 'stats', key: 'nav.stats', icon: LineIcon },
  { id: 'analytics', key: 'nav.analytics', icon: BarChart3 },
  { id: 'settings', key: 'nav.settings', icon: Cog },
];

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [page, setPage] = useState(() => location.hash.slice(1) || 'overview');
  const [item, setItem] = useState<string | null>(null);

  const refreshStatus = useCallback(() => { void call<Status>('status').then(setStatus).catch(() => undefined); }, []);
  useEffect(() => { void call<Settings>('settings:get').then(setSettings); refreshStatus(); const id = setInterval(refreshStatus, 5000); return () => clearInterval(id); }, [refreshStatus]);
  useEffect(() => window.wiramus.on(() => refreshStatus()), [refreshStatus]);
  useEffect(() => { location.hash = page; }, [page]);

  const lang = settings?.uiLang ?? 'tr';
  const ctx = useMemo(() => ({ lang, t: makeT(lang), n: (x: { en: string; tr?: string } | null | undefined) => (x ? (lang === 'tr' ? x.tr || x.en : x.en) : '') }), [lang]);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const { t } = ctx;

  if (!settings) return null;
  if (!settings.onboarded) return <I18nCtx.Provider value={ctx}><Onboarding settings={settings} onDone={setSettings} /></I18nCtx.Provider>;
  if (!settings.termsAcceptedAt) return <I18nCtx.Provider value={ctx}><TermsGate onDone={setSettings} /></I18nCtx.Provider>;

  const mem = status?.memoryReader ?? 'off';
  const memBadge = mem === 'connected' ? 'success' : mem === 'waiting' ? 'warning' : mem === 'error' ? 'danger' : 'muted';
  return (
    <I18nCtx.Provider value={ctx}>
      <ToastHost>
        <div className="shell">
          <nav className="side" aria-label="Menu">
            <div className="brand">WIRAMUS<b>FRAME</b><small>companion // v0.2.0</small></div>
            <div className="nav">{NAV.map((n) => (
              <a key={n.id} href={`#${n.id}`} aria-current={page === n.id ? 'page' : undefined} onClick={(e) => { e.preventDefault(); setPage(n.id); }}>
                <n.icon size={18} aria-hidden />{t(n.key)}</a>))}</div>
          </nav>
          <header className="top">
            <button className={`badge ${memBadge}`} style={{ background: 'none', cursor: 'pointer' }} onClick={() => setPage('settings')} title={status?.memoryError ?? ''}>
              <span className="dot" />{t(`status.${mem}` as Key)}</button>
            <span className={`badge ${status?.gameRunning ? 'success' : 'muted'}`}><span className="dot" />{status?.gameRunning ? t('status.game') : t('status.nogame')}</span>
            <span className={`badge ${status?.eeLogFound ? 'success' : 'warning'}`}><span className="dot" />{status?.eeLogFound ? t('status.log') : t('status.nolog')}</span>
            <span className="spacer" />
            <span className="muted small">{t('set.prices')}: {fmtAgo(status?.pricesFetchedAt, lang)}</span>
          </header>
          <main className="main">
            {page === 'overview' && <Overview status={status} openItem={setItem} />}
            {page === 'overlay' && <OverlayPage />}
            {page === 'inventory' && <InventoryPage status={status} openItem={setItem} />}
            {page === 'relics' && <RelicsPage openItem={setItem} />}
            {page === 'sets' && <SetsPage openItem={setItem} />}
            {page === 'foundry' && <FoundryPage openItem={setItem} />}
            {page === 'mastery' && <MasteryPage openItem={setItem} />}
            {page === 'rivens' && <RivensPage />}
            {page === 'market' && <MarketPage status={status} onChange={refreshStatus} />}
            {page === 'stats' && <StatsPage />}
            {page === 'analytics' && <AnalyticsPage />}
            {page === 'settings' && <SettingsPage settings={settings} status={status} onChange={setSettings} />}
          </main>
        </div>
        <ItemDrawer id={item} onClose={() => setItem(null)} />
      </ToastHost>
    </I18nCtx.Provider>
  );
}
