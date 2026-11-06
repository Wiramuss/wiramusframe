// Ekranlar (S01–S16). Her ekran: yükleme, boş, hata ve dolu durumlarını ele alır.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Download, ExternalLink, RefreshCw, ScanLine, Trash2 } from 'lucide-react';
import type {
  Auction, FoundryRow, I18nName, InventoryRow, ItemDetail, MasteryHow, MasteryPlan, Refinement, RelicPlanRow, Riven,
  ScanResult, SetRow, Settings, SniperRule, StatPoint, Status,
} from '../shared/types';
import { call, useData } from './api';
import { fmtAgo, fmtNum, useI18n, type Key } from './i18n';
import { Chips, DataTable, Drawer, Ducat, Empty, ErrorBox, LineChart, Loadable, Modal, Named, Plat, Progress, Skeleton, Switch, Thumb, Tile, useToast, type Col } from './ui';

type FoundryJob = { item: string; readyAt: string; name?: I18nName };
type Summary = { syncedAt: string; source: string; mr: number; platinum: number; credits: number; ducats: number; endo: number; rivens: number; foundry: FoundryJob[] } | null;

const fold = (s: string) => s.toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
function matches(n: I18nName, q: string) { if (!q) return true; const f = fold(q); return fold(n.en).includes(f) || (!!n.tr && fold(n.tr).includes(f)); }

function wfmUrl(slug?: string | null) { return slug ? `https://warframe.market/items/${slug}` : null; }
function openExt(url: string | null) { if (url) void call('open:external', url); }

// ---------------- Kullanım Şartları ----------------
export const TERMS_URL = 'https://github.com/Wiramuss/wiramusframe/blob/main/TERMS.md';
function Agree({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return <label className="row small" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', cursor: 'pointer' }}>
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3, accentColor: 'var(--accent)' }} />
    <span>{children}</span></label>;
}
function TermsBox() {
  const { t } = useI18n();
  return <div className="callout info small" style={{ lineHeight: 1.6 }}>{t('terms.body')}{' '}
    <a href={TERMS_URL} onClick={(e) => { e.preventDefault(); openExt(TERMS_URL); }}>{t('terms.full')}</a></div>;
}
/** Kurulumu daha önce bitirmiş ama şartları henüz kabul etmemiş kullanıcılar için tek ekranlık kapı. */
export function TermsGate({ onDone }: { onDone: (s: Settings) => void }) {
  const { t } = useI18n();
  const [ok, setOk] = useState(false);
  return (<main className="onboard card stack" aria-labelledby="terms-title">
    <h1 id="terms-title">{t('terms.title')}</h1>
    <TermsBox />
    <Agree checked={ok} onChange={setOk}>{t('terms.accept')}</Agree>
    <div><button className="btn primary" disabled={!ok} onClick={async () => onDone(await call<Settings>('settings:set', { termsAcceptedAt: new Date().toISOString() }))}>{t('terms.continue')}</button></div>
  </main>);
}

// ---------------- S01 kurulum ----------------
export function Onboarding({ settings, onDone }: { settings: Settings; onDone: (s: Settings) => void }) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [s, setS] = useState(settings);
  const [terms, setTerms] = useState(!!settings.termsAcceptedAt);
  const [risk, setRisk] = useState(false);
  const patch = async (p: Partial<Settings>) => { const n = await call<Settings>('settings:set', p); setS(n); onDone(n); return n; };
  return (
    <main className="onboard card" aria-labelledby="ob-title">
      <div className="stepper" aria-hidden>{[0, 1, 2].map((i) => <span key={i} className={i <= step ? 'on' : ''} />)}</div>
      <h1 id="ob-title">{t('ob.welcome')}</h1>
      <p className="muted">{t('ob.intro')}</p>
      {step === 0 && <div className="stack">
        <h2>{t('ob.step1')}</h2>
        <Chips value={s.uiLang} options={[{ v: 'tr', label: 'Türkçe' }, { v: 'en', label: 'English' }]} onChange={(v) => void patch({ uiLang: v })} />
        <h2>{t('terms.title')}</h2>
        <TermsBox />
        <Agree checked={terms} onChange={setTerms}>{t('terms.accept')}</Agree>
      </div>}
      {step === 1 && <div className="stack">
        <h2>{t('ob.step2')}</h2>
        <p>{t('ob.gameHint')}</p>
        <div className="callout info">{t('set.borderless')}</div>
        <label className="field">{t('set.eelog')}<input className="input" value={s.eeLogPath} onChange={(e) => setS({ ...s, eeLogPath: e.target.value })} onBlur={() => void patch({ eeLogPath: s.eeLogPath })} /></label>
      </div>}
      {step === 2 && <div className="stack">
        <h2>{t('ob.step3')}</h2>
        <p>{t('ob.memHint')}</p>
        <div className="callout warning">{t('set.risk')}</div>
        <Agree checked={risk} onChange={setRisk}>{t('set.riskAgree')}</Agree>
        <div className="row">
          <button className="btn primary" disabled={!risk} onClick={() => void patch({ memoryReader: { enabled: true, consentAt: null }, onboarded: true })}>{t('set.riskAccept')}</button>
          <button className="btn" onClick={() => void patch({ onboarded: true })}>{t('ob.skip')}</button>
        </div>
      </div>}
      <div className="row" style={{ marginTop: 24, justifyContent: 'space-between' }}>
        <button className="btn ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>{t('ob.back')}</button>
        {step < 2 && <button className="btn primary" disabled={step === 0 && !terms} onClick={async () => {
          if (step === 0 && !s.termsAcceptedAt) setS(await patch({ termsAcceptedAt: new Date().toISOString() }));
          setStep(step + 1);
        }}>{t('ob.next')}</button>}
      </div>
    </main>
  );
}

// ---------------- S06 eşya detayı ----------------
export function ItemDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t, n, lang } = useI18n();
  const q = useData<ItemDetail | null>(id ? 'item:detail' : 'status', id ?? undefined);
  const d = id ? (q.data as ItemDetail | null) : null;
  return (
    <Drawer open={!!id} onClose={onClose} title={d ? n(d.name) : t('common.loading')}>
      {q.error ? <ErrorBox msg={q.error} /> : !d || q.loading ? <Skeleton /> : <div className="stack" style={{ marginTop: 16 }}>
        <div className="drawer-hero"><Thumb id={d.uniqueName} size={128} /></div>
        <div className="row">
          <span className="badge muted">{t('common.owned')}: {d.owned}</span>
          {d.vaulted && <span className="badge warning">{t('common.vaulted')}</span>}
          <Plat v={d.plat} /> <Ducat v={d.ducats} />
        </div>
        {d.parts.length > 0 && <><h2>{t('det.parts')}</h2>
          <table className="dt"><tbody>{d.parts.map((p) => <tr key={p.item}><td><Named id={p.item}>{n(p.name)}</Named></td><td className="num">{p.have}/{p.count}</td></tr>)}</tbody></table></>}
        {d.recipe && <><h2>{t('det.recipe')}</h2>
          <p className="muted small">{t('det.buildTime')}: {Math.round(d.recipe.buildTime / 3600)} h · {fmtNum(d.recipe.buildPrice, lang)} {t('ov.credits')}</p>
          <table className="dt"><tbody>{d.recipe.ingredients.map((x) => <tr key={x.item}><td><Named id={x.item}>{n(x.name)}</Named></td>
            <td className="num" style={{ color: x.have >= x.count ? 'var(--success)' : undefined }}>{t('det.have')} {fmtNum(x.have, lang)} / {fmtNum(x.count, lang)}</td></tr>)}</tbody></table></>}
        <h2>{t('det.relics')}</h2>
        {d.relics.length ? <table className="dt"><tbody>{d.relics.map((r) => <tr key={r.uniqueName}><td><Named id={r.uniqueName}>{n(r.name)}</Named></td>
          <td>{t(`rl.${r.rarity}` as Key)}</td><td>{r.vaulted ? <span className="badge warning">{t('common.vaulted')}</span> : <span className="badge success">✓</span>}</td></tr>)}</tbody></table>
          : <p className="muted">{t('det.noRelic')}</p>}
      </div>}
    </Drawer>
  );
}

// ---------------- S03 özet ----------------
export function Overview({ status, openItem }: { status: Status | null; openItem: (id: string) => void }) {
  const { t, n, lang } = useI18n();
  const toast = useToast();
  const sum = useData<Summary>('inventory:summary');
  const rows = useData<InventoryRow[]>('inventory:rows');
  const relics = useData<RelicPlanRow[]>('relics:plan', { refinement: 'intact', owned: true });
  const stats = useData<StatPoint[]>('stats:series');
  const value = (rows.data ?? []).reduce((s, r) => s + (r.plat ?? 0) * r.count, 0);
  const sync = async () => { try { await call('inventory:sync'); toast(t('common.updated')); } catch (e) { toast((e as Error).message, true); } };
  const imp = async () => {
    const f = await call<string | null>('dialog:open', [{ name: 'JSON', extensions: ['json'] }]);
    if (f) { try { await call('inventory:import', f); toast(t('common.updated')); } catch (e) { toast((e as Error).message, true); } }
  };
  const s = sum.data;
  return (
    <div className="page">
      <h1>{t('ov.title')}</h1>
      {sum.loading && !s ? <Skeleton /> : !s ? (
        <div className="card"><Empty title={t('ov.noInv')} hint={t('ov.noInvHint')} action={<div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn primary" onClick={sync}><RefreshCw size={16} />{t('ov.syncNow')}</button>
          <button className="btn" onClick={imp}><Download size={16} />{t('ov.import')}</button></div>} /></div>
      ) : (<>
        <div className="grid tiles">
          <Tile label={t('ov.mr')} value={s.mr} />
          <Tile label={t('common.plat')} value={fmtNum(s.platinum, lang)} cls="plat"><SparkOf pts={stats.data} k="platinum" /></Tile>
          <Tile label={t('common.ducats')} value={fmtNum(s.ducats, lang)} cls="ducat"><SparkOf pts={stats.data} k="ducats" /></Tile>
          <Tile label={t('ov.credits')} value={fmtNum(s.credits, lang)} />
          <Tile label={t('ov.endo')} value={fmtNum(s.endo, lang)} />
          <Tile label={t('ov.invValue')} value={`${fmtNum(value, lang)} p`} cls="plat" />
        </div>
        <div className="row muted small" style={{ marginTop: 8 }}>{t('common.updated')}: {fmtAgo(s.syncedAt, lang)}
          <button className="btn sm ghost" onClick={sync}><RefreshCw size={14} />{t('ov.syncNow')}</button>
          <button className="btn sm ghost" onClick={imp}><Download size={14} />{t('ov.import')}</button></div>
      </>)}
      <div className="grid two" style={{ marginTop: 16 }}>
        <section className="card"><h2 style={{ marginTop: 0 }}>{t('ov.lastScan')}</h2>
          {status?.lastScan ? <ScanSlots scan={status.lastScan} /> : <p className="muted">{t('ov.noScan')}</p>}</section>
        <section className="card"><h2 style={{ marginTop: 0 }}>{t('ov.topSell')}</h2>
          <Loadable q={rows} empty={(d) => !d.length} emptyView={<p className="muted">{t('common.empty')}</p>}>{(d) =>
            <table className="dt"><tbody>{d.slice(0, 6).map((r) => <tr key={r.uniqueName} className="click" onClick={() => openItem(r.uniqueName)}>
              <td><Named id={r.uniqueName}>{n(r.name)}</Named></td><td className="num">×{r.count}</td><td className="num"><Plat v={r.plat} /></td></tr>)}</tbody></table>}</Loadable></section>
        <section className="card"><h2 style={{ marginTop: 0 }}>{t('ov.bestRelics')}</h2>
          <Loadable q={relics} empty={(d) => !d.length} emptyView={<p className="muted">{t('common.empty')}</p>}>{(d) =>
            <table className="dt"><tbody>{d.slice(0, 6).map((r) => <tr key={r.uniqueName}><td><Named id={r.uniqueName}>{n(r.name)}</Named></td><td className="num">×{r.owned}</td><td className="num"><Plat v={r.evSolo} /></td></tr>)}</tbody></table>}</Loadable></section>
        <section className="card"><h2 style={{ marginTop: 0 }}>{t('ov.foundry')}</h2>
          {s?.foundry.length ? <FoundryList items={s.foundry} /> : <p className="muted">{t('common.empty')}</p>}</section>
      </div>
    </div>
  );
}

function SparkOf({ pts, k }: { pts: StatPoint[] | null; k: keyof Omit<StatPoint, 'ts'> }) {
  if (!pts || pts.length < 2) return null;
  const vals = pts.slice(-30).map((p) => p[k]);
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  return <svg className="spark" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden><polyline points={vals.map((v, i) => `${(i / (vals.length - 1)) * 100},${38 - ((v - min) / span) * 36}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>;
}

function FoundryList({ items }: { items: FoundryJob[] }) {
  const { t, n, lang } = useI18n();
  return <table className="dt"><tbody>{items.map((f, i) => {
    const ready = Date.parse(f.readyAt) <= Date.now();
    return <tr key={i}><td><Named id={f.item}>{f.name ? n(f.name) : f.item.split('/').pop()}</Named></td>
      <td className="num">{ready ? <span className="badge success">{t('ov.ready')}</span> : fmtAgo(f.readyAt, lang)}</td></tr>;
  })}</tbody></table>;
}

export function ScanSlots({ scan }: { scan: ScanResult }) {
  const { t, n, lang } = useI18n();
  return (<>
    <p className="muted small">{fmtAgo(scan.ts, lang)} · {t('ol.lang')}: {scan.lang ? scan.lang.toUpperCase() : '–'} · {t('ol.ms')} {scan.ms} ms</p>
    <div className="slots">{scan.slots.map((s, i) => (
      <div key={i} className={`slot ${i === scan.bestIndex ? 'best' : ''}`}>
        {i === scan.bestIndex && <span className="badge warning" style={{ marginBottom: 6 }}>{t('ol.best')}</span>}
        <Thumb id={s.uniqueName} size={56} />
        <div style={{ fontWeight: 600 }}>{s.name ? n(s.name) : <span className="muted">{t('ol.unknown')}</span>}</div>
        <div className="row" style={{ gap: 8 }}><Plat v={s.plat} /><Ducat v={s.ducats} /></div>
        <div className="muted small">{t('common.owned')}: {s.owned} · {t('ol.conf')} %{Math.round(s.score * 100)}{s.vaulted ? ` · ${t('common.vaulted')}` : ''}</div>
      </div>))}</div>
  </>);
}

// ---------------- S04 envanter ----------------
type Cat = 'all' | 'prime' | 'relic' | 'set' | 'mod' | 'arcane' | 'other';
/** Bellek okumadan envanter: oyunda Envanter/Dökümhane ekranı açıkken ekrandan oku. */
function ScreenScanCard() {
  const { t, n } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ ref: string; count: number; name: { en: string; tr?: string } | null }[] | null>(null);
  useEffect(() => window.wiramus.on((m) => { if (m.event === 'invscan') setLast(m.data as typeof last); }), []);
  const run = async () => {
    setBusy(true);
    try {
      await new Promise((r) => setTimeout(r, 3000)); // oyuna dönmek için süre
      const r = await call<{ items: NonNullable<typeof last> }>('inventory:screenScan');
      setLast(r.items); toast(r.items.length ? `${r.items.length} ${t('inv.scanFound')}` : t('inv.scanNone'), !r.items.length);
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  };
  return (<section className="card stack" style={{ marginBottom: 16 }}>
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <div><strong>{t('inv.scanTitle')}</strong><div className="muted small">{t('inv.scanHint')}</div></div>
      <button className="btn primary" disabled={busy} onClick={() => void run()}><ScanLine size={16} />{busy ? t('inv.scanWait') : t('inv.scanBtn')}</button>
    </div>
    {last && last.length > 0 && <div className="small muted">{t('inv.scanLast')}: {last.slice(0, 12).map((x) => `${x.name ? n(x.name) : x.ref.split('/').pop()} ×${x.count}`).join(' · ')}{last.length > 12 ? ` … +${last.length - 12}` : ''}</div>}
  </section>);
}

export function InventoryPage({ status, openItem }: { status: Status | null; openItem: (id: string) => void }) {
  const { t, n, lang } = useI18n();
  const q = useData<InventoryRow[]>('inventory:rows');
  const sets = useData<SetRow[]>('sets:rows');
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState<Cat>('all');
  const [extra, setExtra] = useState(false);
  const [sell, setSell] = useState<InventoryRow | null>(null);
  const needed = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sets.data ?? []) if (s.have > 0) for (const p of s.parts) m.set(p.item, (m.get(p.item) ?? 0) + p.need);
    return m;
  }, [sets.data]);
  const rows = (q.data ?? []).filter((r) => (cat === 'all' || r.category === cat) && matches(r.name, search))
    .map((r) => ({ ...r, count: extra ? Math.max(0, r.count - (needed.get(r.uniqueName) ?? 0)) : r.count })).filter((r) => r.count > 0);
  const cols: Col<InventoryRow>[] = [
    { key: 'name', label: t('common.name'), sort: (r) => n(r.name), render: (r) => <Named id={r.uniqueName}>{n(r.name)} {r.vaulted && <span className="badge warning">{t('common.vaulted')}</span>}</Named> },
    { key: 'cat', label: '', render: (r) => <span className="muted small">{t(`inv.cat.${r.category}` as Key)}</span> },
    { key: 'count', label: t('common.count'), num: true, sort: (r) => r.count, render: (r) => r.count },
    { key: 'plat', label: t('common.plat'), num: true, sort: (r) => r.plat ?? -1, render: (r) => <Plat v={r.plat} /> },
    { key: 'ducats', label: t('common.ducats'), num: true, sort: (r) => r.ducats ?? -1, render: (r) => <Ducat v={r.ducats} /> },
    { key: 'value', label: t('inv.value'), num: true, sort: (r) => (r.plat ?? 0) * r.count, render: (r) => <Plat v={r.plat == null ? null : r.plat * r.count} /> },
    { key: 'act', label: '', render: (r) => <button className="btn sm" onClick={(e) => { e.stopPropagation(); setSell(r); }}>{t('common.sell')}</button> },
  ];
  return (
    <div className="page">
      <h1>{t('inv.title')}</h1>
      <ScreenScanCard />
      <div className="row" style={{ marginBottom: 12 }}>
        <input className="input" aria-label={t('common.search')} placeholder={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Chips value={cat} onChange={setCat} options={(['all', 'prime', 'relic', 'set', 'mod', 'arcane', 'other'] as Cat[]).map((v) => ({ v, label: v === 'all' ? t('common.all') : t(`inv.cat.${v}` as Key) }))} />
        <label className="row small muted"><Switch checked={extra} onChange={setExtra} label={t('inv.extra')} />{t('inv.extra')}</label>
      </div>
      <Loadable q={q} empty={(d) => !d.length} emptyView={<Empty title={t('ov.noInv')} hint={t('ov.noInvHint')} />}>{() =>
        <><p className="muted small">{rows.length} · {t('common.total')} <Plat v={rows.reduce((s, r) => s + (r.plat ?? 0) * r.count, 0)} /> · {t('common.updated')} {fmtAgo(status?.inventorySyncedAt, lang)}</p>
          <DataTable rows={rows} cols={cols} rowKey={(r) => r.uniqueName} onRow={(r) => openItem(r.uniqueName)} initialSort={{ key: 'value', dir: -1 }} /></>}
      </Loadable>
      <SellModal row={sell} onClose={() => setSell(null)} linked={!!status?.wfmUser} />
    </div>
  );
}

function SellModal({ row, onClose, linked }: { row: InventoryRow | null; onClose: () => void; linked: boolean }) {
  const { t, n } = useI18n();
  const toast = useToast();
  const [price, setPrice] = useState<number>(1);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (row) { setPrice(row.plat ?? 1); setQty(row.count); } }, [row]);
  if (!row) return null;
  return (
    <Modal open={!!row} onClose={onClose} title={`${t('inv.sellTitle')}: ${n(row.name)}`}>
      {!linked ? <div className="callout info">{t('inv.needWfm')}</div> : <form className="stack" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true);
        try { await call('wfm:create', { slug: row.slug, platinum: price, quantity: qty }); toast(t('inv.listed')); onClose(); }
        catch (err) { toast((err as Error).message, true); } finally { setBusy(false); }
      }}>
        <label className="field">{t('inv.price')}<input className="input" type="number" min={1} value={price} onChange={(e) => setPrice(Number(e.target.value))} required /></label>
        <label className="field">{t('inv.qty')}<input className="input" type="number" min={1} max={row.count} value={qty} onChange={(e) => setQty(Number(e.target.value))} required /></label>
        <div className="row"><button className="btn primary" disabled={busy} aria-busy={busy}>{t('common.sell')}</button></div>
      </form>}
      <div className="row" style={{ marginTop: 12, justifyContent: 'space-between' }}>
        <button type="button" className="btn ghost" onClick={() => openExt(wfmUrl(row.slug))}><ExternalLink size={14} />{t('det.wfm')}</button>
        <button className="btn ghost" onClick={onClose}>{t('common.close')}</button></div>
    </Modal>
  );
}

// ---------------- S05 dökümhane ----------------
type FFilter = 'all' | 'owned' | 'mastered' | 'missing' | 'building';
export function FoundryPage({ openItem }: { openItem: (id: string) => void }) {
  const { t, n } = useI18n();
  const q = useData<FoundryRow[]>('foundry:rows');
  const [f, setF] = useState<FFilter>('all');
  const [kind, setKind] = useState('all');
  const [prime, setPrime] = useState(false);
  const [search, setSearch] = useState('');
  const kinds = useMemo(() => [...new Set((q.data ?? []).map((r) => r.kind))], [q.data]);
  const rows = (q.data ?? []).filter((r) => (f === 'all' || (f === 'owned' && r.owned) || (f === 'mastered' && r.mastered) || (f === 'missing' && !r.mastered) || (f === 'building' && r.building))
    && (kind === 'all' || r.kind === kind) && (!prime || r.prime) && matches(r.name, search));
  const cols: Col<FoundryRow>[] = [
    { key: 'name', label: t('common.name'), sort: (r) => n(r.name), render: (r) => <Named id={r.uniqueName}>{n(r.name)}</Named> },
    { key: 'kind', label: t('fd.kind'), sort: (r) => r.kind, render: (r) => <span className="muted">{t(`kind.${r.kind}` as Key)}</span> },
    { key: 'rank', label: t('fd.rank'), num: true, sort: (r) => r.rank, render: (r) => `${r.rank}/${r.maxRank}` },
    { key: 'mr', label: t('fd.mr'), num: true, sort: (r) => r.masteryReq, render: (r) => r.masteryReq },
    { key: 'st', label: '', render: (r) => r.building ? <span className="badge warning">{t('fd.building')}</span> : r.mastered ? <span className="badge success">{t('fd.mastered')}</span> : r.owned ? <span className="badge muted">{t('fd.owned')}</span> : null },
  ];
  return (
    <div className="page">
      <h1>{t('fd.title')}</h1>
      <div className="row" style={{ marginBottom: 12 }}>
        <input className="input" aria-label={t('common.search')} placeholder={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Chips value={f} onChange={setF} options={[{ v: 'all', label: t('common.all') }, { v: 'owned', label: t('fd.owned') }, { v: 'mastered', label: t('fd.mastered') }, { v: 'missing', label: t('fd.missing') }, { v: 'building', label: t('fd.building') }]} />
        <select className="select" aria-label={t('fd.kind')} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="all">{t('common.all')}</option>{kinds.map((k) => <option key={k} value={k}>{t(`kind.${k}` as Key)}</option>)}</select>
        <label className="row small muted"><Switch checked={prime} onChange={setPrime} label={t('fd.primeOnly')} />{t('fd.primeOnly')}</label>
      </div>
      <Loadable q={q}>{() => <><p className="muted small">{rows.length}</p><DataTable rows={rows} cols={cols} rowKey={(r) => r.uniqueName} onRow={(r) => openItem(r.uniqueName)} initialSort={{ key: 'name', dir: 1 }} limit={1000} /></>}</Loadable>
    </div>
  );
}

// ---------------- S07 ustalık ----------------
export function MasteryPage({ openItem }: { openItem: (id: string) => void }) {
  const { t, n, lang } = useI18n();
  const q = useData<MasteryPlan>('mastery:plan');
  const [how, setHow] = useState<'all' | MasteryHow>('all');
  const [locked, setLocked] = useState(false);
  return (
    <div className="page">
      <h1>{t('ms.title')}</h1>
      <Loadable q={q}>{(m) => {
        const rows = m.items.filter((r) => (how === 'all' || r.how === how) && (locked || !r.locked));
        const short = Math.max(0, m.gap - m.sessionsXp);
        const chips: ['all' | MasteryHow, string][] = [
          ['all', t('ms.allChip')], ['level', `${t('ms.how.level')} (${m.counts.level})`], ['build', `${t('ms.how.build')} (${m.counts.build})`],
          ['buy', `${t('ms.how.buy')} (${m.counts.buy})`], ['farm', `${t('ms.how.farm')} (${m.counts.farm})`]];
        return (<>
          <div className="grid tiles">
            <Tile label={t('ov.mr')} value={m.mr} />
            <Tile label={t('ms.nextMr')} value={fmtNum(m.gap, lang)} />
            <Tile label={t('ms.plan')} value={`${m.sessions.length} ${t('ms.planTotal')}`}>
              <div className="muted small">{t('ms.approx')} {fmtNum(m.minutes, lang)} {t('ms.minutes')}</div></Tile>
            <Tile label={t('ms.covered')} value={`+${fmtNum(m.sessionsXp, lang)}`}>
              <div className="muted small">{short ? `${t('ms.short')} ${fmtNum(short, lang)}` : t('ms.done30')}</div></Tile>
          </div>
          <p className="muted small">{t('ms.baseNote')}</p>

          <h2>{t('ms.plan')}</h2>
          <p className="muted small">{t('ms.planNote')}</p>
          {m.sessions.length ? <div className="sessions">{m.sessions.map((ses, i) => (
            <section key={i} className="card session">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{t('ms.session')} {i + 1}</strong>
                <span className="muted small">{t(`ms.grp.${ses.group}` as Key)} · ~{ses.minutes} {t('ms.minutes')}</span>
              </div>
              <ul>{ses.items.map((it) => (
                <li key={it.uniqueName} className="click" onClick={() => openItem(it.uniqueName)}>
                  <Named id={it.uniqueName}>{n(it.name)} <span className="muted small">{t(`kind.${it.kind}` as Key)}</span></Named>
                  <span className="plat num">+{fmtNum(it.xp, lang)}</span></li>))}</ul>
              <div className="muted small" style={{ textAlign: 'right' }}>+{fmtNum(ses.xp, lang)}</div>
            </section>))}</div> : <p className="muted">{t('ms.noPlan')}</p>}

          <h2>{t('ms.tips')}</h2>
          <ol className="tips card">{(['ms.tip1', 'ms.tip2', 'ms.tip3', 'ms.tip4', 'ms.tip5', 'ms.tip6', 'ms.tip7', 'ms.tip8'] as Key[]).map((k) => <li key={k}>{t(k)}</li>)}</ol>

          <h2>{t('ms.all')}</h2>
          <div className="toolbar">
            <Chips value={how} onChange={setHow} options={chips.map(([v, label]) => ({ v, label }))} />
            <label className="row small muted"><Switch checked={locked} onChange={setLocked} label={t('ms.showLocked')} />{t('ms.showLocked')}</label>
          </div>
          <DataTable rows={rows} rowKey={(r) => r.uniqueName} onRow={(r) => openItem(r.uniqueName)} cols={[
            { key: 'name', label: t('common.name'), sort: (r) => n(r.name), render: (r) => <Named id={r.uniqueName}>{n(r.name)}{r.rank > 0 ? <span className="muted small"> · {r.rank}/{r.maxRank}</span> : null}</Named> },
            { key: 'kind', label: t('fd.kind'), sort: (r) => r.kind, render: (r) => <span className="muted">{t(`kind.${r.kind}` as Key)}</span> },
            { key: 'how', label: t('ms.how'), render: (r) => <span className={`badge ${r.how === 'level' || r.how === 'build' ? 'success' : r.how === 'buy' ? 'muted' : 'warning'}`}>{t(`ms.how.${r.how}` as Key)}</span> },
            { key: 'xp', label: t('ms.gain'), num: true, sort: (r) => r.xp, render: (r) => `+${fmtNum(r.xp, lang)}` },
            { key: 'cost', label: t('ms.cost'), num: true, sort: (r) => r.plat ?? -1, render: (r) => r.how === 'buy' ? <Plat v={r.plat} /> : r.how === 'build' && r.credits ? <span className="muted">{fmtNum(r.credits, lang)} {t('ov.credits')}</span> : '' },
            { key: 'mr', label: t('fd.mr'), num: true, sort: (r) => r.masteryReq, render: (r) => <span style={{ color: r.locked ? 'var(--danger)' : undefined }}>{r.masteryReq}</span> },
          ]} />
        </>);
      }}</Loadable>
    </div>
  );
}

// ---------------- S08 relic planlayıcı ----------------
export function RelicsPage({ openItem }: { openItem: (id: string) => void }) {
  const { t, n } = useI18n();
  const [ref, setRef] = useState<Refinement>('intact');
  const [owned, setOwned] = useState(false);
  const [hideV, setHideV] = useState(false);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<RelicPlanRow | null>(null);
  const q = useData<RelicPlanRow[]>('relics:plan', { refinement: ref, owned });
  const rows = (q.data ?? []).filter((r) => (!hideV || !r.vaulted) && (matches(r.name, search) || r.rewards.some((w) => matches(w.name, search))));
  return (
    <div className="page">
      <h1>{t('rl.title')}</h1>
      <div className="row" style={{ marginBottom: 12 }}>
        <input className="input" aria-label={t('common.search')} placeholder={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Chips value={ref} onChange={setRef} options={(['intact', 'exceptional', 'flawless', 'radiant'] as Refinement[]).map((v) => ({ v, label: t(`rl.${v}` as Key) }))} />
        <label className="row small muted"><Switch checked={owned} onChange={setOwned} label={t('rl.onlyOwned')} />{t('rl.onlyOwned')}</label>
        <label className="row small muted"><Switch checked={hideV} onChange={setHideV} label={t('rl.hideVaulted')} />{t('rl.hideVaulted')}</label>
      </div>
      <Loadable q={q}>{() => <DataTable rows={rows} rowKey={(r) => r.uniqueName} onRow={setOpen} initialSort={{ key: 'solo', dir: -1 }} cols={[
        { key: 'name', label: t('common.name'), sort: (r) => n(r.name), render: (r) => <Named id={r.uniqueName}>{n(r.name)} {r.vaulted ? <span className="badge warning">{t('common.vaulted')}</span> : null}</Named> },
        { key: 'own', label: t('common.owned'), num: true, sort: (r) => r.owned, render: (r) => r.owned || '' },
        { key: 'solo', label: t('rl.solo'), num: true, sort: (r) => r.evSolo, render: (r) => <Plat v={r.evSolo} /> },
        { key: 'squad', label: t('rl.squad'), num: true, sort: (r) => r.evSquad, render: (r) => <Plat v={r.evSquad} /> },
        { key: 'duc', label: t('rl.ducats'), num: true, sort: (r) => r.evDucats, render: (r) => <Ducat v={r.evDucats} /> },
      ]} />}</Loadable>
      <Drawer open={!!open} onClose={() => setOpen(null)} title={open ? n(open.name) : ''}>
        {open && <table className="dt" style={{ marginTop: 16 }}><tbody>{open.rewards.map((w) => (
          <tr key={w.item} className="click" onClick={() => { setOpen(null); openItem(w.item); }}><td><Named id={w.item}>{n(w.name)}</Named></td><td className="muted">{t(`rl.${w.rarity}` as Key)} · %{Math.round(w.chance * 1000) / 10}</td>
            <td className="num"><Plat v={w.plat} /></td><td className="num"><Ducat v={w.ducats} /></td></tr>))}</tbody></table>}
      </Drawer>
    </div>
  );
}

// ---------------- S09 setler ----------------
export function SetsPage({ openItem }: { openItem: (id: string) => void }) {
  const { t, n } = useI18n();
  const q = useData<SetRow[]>('sets:rows');
  const [started, setStarted] = useState(true);
  const [search, setSearch] = useState('');
  const rows = (q.data ?? []).filter((s) => (!started || s.have > 0) && matches(s.name, search));
  return (
    <div className="page">
      <h1>{t('st.title')}</h1>
      <div className="row" style={{ marginBottom: 12 }}>
        <input className="input" aria-label={t('common.search')} placeholder={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="row small muted"><Switch checked={started} onChange={setStarted} label={t('st.onlyStarted')} />{t('st.onlyStarted')}</label>
      </div>
      <Loadable q={q}>{() => <DataTable rows={rows} rowKey={(r) => r.uniqueName} onRow={(r) => openItem(r.uniqueName)} initialSort={{ key: 'prog', dir: -1 }} cols={[
        { key: 'name', label: t('common.name'), sort: (r) => n(r.name), render: (r) => <Named id={r.uniqueName}>{n(r.name)} {r.complete && <span className="badge success">{t('st.complete')}</span>}</Named> },
        { key: 'prog', label: t('st.progress'), sort: (r) => r.have / r.need, render: (r) => <div className="row" style={{ flexWrap: 'nowrap' }}><Progress value={r.have} max={r.need} label={t('st.progress')} /><span className="small muted">{r.have}/{r.need}</span></div> },
        { key: 'set', label: t('st.setPrice'), num: true, sort: (r) => r.plat ?? -1, render: (r) => <Plat v={r.plat} /> },
        { key: 'parts', label: t('st.partsPrice'), num: true, sort: (r) => r.partsPlat, render: (r) => <Plat v={r.partsPlat} /> },
      ]} />}</Loadable>
    </div>
  );
}

// ---------------- S10–S12 rivenler ----------------
export function RivensPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<'mine' | 'find' | 'watch'>('mine');
  return (
    <div className="page">
      <h1>{t('nav.rivens')}</h1>
      <div role="tablist" className="row" style={{ marginBottom: 16 }}>
        {(['mine', 'find', 'watch'] as const).map((k) => <button key={k} role="tab" aria-selected={tab === k} className="chip" aria-pressed={tab === k} onClick={() => setTab(k)}>
          {k === 'mine' ? t('rv.title') : k === 'find' ? t('rv.finder') : t('rv.sniper')}</button>)}
      </div>
      {tab === 'mine' && <MyRivens />}{tab === 'find' && <RivenFinder />}{tab === 'watch' && <RivenWatch />}
    </div>
  );
}

function MyRivens() {
  const { t, n } = useI18n();
  const q = useData<Riven[]>('rivens:rows');
  return <Loadable q={q} empty={(d) => !d.length} emptyView={<Empty title={t('rv.none')} />}>{(d) => <DataTable rows={d} rowKey={(r) => r.id} initialSort={{ key: 'g', dir: -1 }} cols={[
    { key: 'g', label: t('rv.grade'), sort: (r) => r.score, render: (r) => <span className={`grade ${r.grade}`} title={`${r.score}/100`}>{r.grade}</span> },
    { key: 'w', label: t('rv.weapon'), sort: (r) => r.weaponName, render: (r) => r.weaponName },
    { key: 's', label: t('rv.stats'), render: (r) => <div className="small">{r.stats.map((s) => <div key={s.tag} style={{ color: s.curse ? 'var(--danger)' : undefined }}>{s.curse ? '−' : '+'} {n(s.name)} <span className="muted">({Math.round(s.roll * 100)}%)</span></div>)}</div> },
    { key: 'r', label: t('rv.rerolls'), num: true, sort: (r) => r.rerolls, render: (r) => r.rerolls },
    { key: 'l', label: '', render: (r) => r.weaponSlug ? <button className="btn sm" onClick={() => openExt(`https://warframe.market/auctions/search?type=riven&weapon_url_name=${r.weaponSlug}&sort_by=price_asc`)}><ExternalLink size={14} />{t('rv.similar')}</button> : null },
  ]} />}</Loadable>;
}

function useRivenMeta() {
  const weapons = useData<{ slug: string; name: string }[]>('rivens:weapons');
  const attrs = useData<{ slug: string; name: I18nName }[]>('rivens:attrs');
  return { weapons: weapons.data ?? [], attrs: attrs.data ?? [] };
}

function AttrPicker({ attrs, value, onChange }: { attrs: { slug: string; name: I18nName }[]; value: string[]; onChange: (v: string[]) => void }) {
  const { t, n } = useI18n();
  return <div className="row">{[0, 1, 2].map((i) => (
    <select key={i} className="select" aria-label={`${t('rv.positives')} ${i + 1}`} value={value[i] ?? ''} onChange={(e) => { const v = [...value]; v[i] = e.target.value; onChange(v.filter(Boolean)); }}>
      <option value="">{t('rv.positives')} {i + 1}</option>{attrs.map((a) => <option key={a.slug} value={a.slug}>{n(a.name)}</option>)}</select>))}</div>;
}

function RivenFinder() {
  const { t, n } = useI18n();
  const { weapons, attrs } = useRivenMeta();
  const [weapon, setWeapon] = useState('');
  const [pos, setPos] = useState<string[]>([]);
  const [res, setRes] = useState<Auction[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const search = async () => { setBusy(true); setErr(null); try { setRes(await call<Auction[]>('rivens:search', { weapon, positives: pos })); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const attrName = (slug: string) => { const a = attrs.find((x) => x.slug === slug); return a ? n(a.name) : slug; };
  return (<div className="stack">
    <div className="row">
      <select className="select" aria-label={t('rv.pickWeapon')} value={weapon} onChange={(e) => setWeapon(e.target.value)}>
        <option value="">{t('rv.pickWeapon')}</option>{weapons.map((w) => <option key={w.slug} value={w.slug}>{w.name}</option>)}</select>
      <AttrPicker attrs={attrs} value={pos} onChange={setPos} />
      <button className="btn primary" disabled={!weapon || busy} onClick={search}>{t('rv.searchBtn')}</button>
    </div>
    {err && <ErrorBox msg={err} />}
    {busy ? <Skeleton /> : res && <DataTable rows={res} rowKey={(a) => a.id} initialSort={{ key: 'p', dir: 1 }} cols={[
      { key: 'n', label: t('common.name'), render: (a) => `${a.weapon} ${a.name}` },
      { key: 'a', label: t('rv.stats'), render: (a) => <div className="small">{a.attrs.map((x) => <div key={x.slug} style={{ color: x.positive ? undefined : 'var(--danger)' }}>{x.positive ? '+' : '−'}{x.value} {attrName(x.slug)}</div>)}</div> },
      { key: 'p', label: t('common.plat'), num: true, sort: (a) => a.price, render: (a) => <Plat v={a.price} /> },
      { key: 's', label: t('rv.seller'), render: (a) => <>{a.seller} <span className="muted small">{a.status}</span></> },
    ]} />}
  </div>);
}

function RivenWatch() {
  const { t } = useI18n();
  const { weapons, attrs } = useRivenMeta();
  const q = useData<SniperRule[]>('sniper:list');
  const [weapon, setWeapon] = useState('');
  const [pos, setPos] = useState<string[]>([]);
  const [max, setMax] = useState(100);
  const add = async () => { await call('sniper:add', { weapon, positives: pos, maxPrice: max }); q.reload(); };
  return (<div className="stack">
    <div className="card stack">
      <h2 style={{ margin: 0 }}>{t('rv.addRule')}</h2>
      <div className="row">
        <select className="select" aria-label={t('rv.pickWeapon')} value={weapon} onChange={(e) => setWeapon(e.target.value)}>
          <option value="">{t('rv.pickWeapon')}</option>{weapons.map((w) => <option key={w.slug} value={w.slug}>{w.name}</option>)}</select>
        <AttrPicker attrs={attrs} value={pos} onChange={setPos} />
        <label className="field">{t('rv.maxPrice')}<input className="input" type="number" min={1} value={max} onChange={(e) => setMax(Number(e.target.value))} /></label>
        <button className="btn primary" disabled={!weapon} onClick={add}>{t('common.add')}</button>
      </div>
    </div>
    <Loadable q={q} empty={(d) => !d.length} emptyView={<Empty title={t('rv.noRules')} />}>{(d) => <DataTable rows={d} rowKey={(r) => r.id} cols={[
      { key: 'w', label: t('rv.weapon'), render: (r) => weapons.find((w) => w.slug === r.weapon)?.name ?? r.weapon },
      { key: 'p', label: t('rv.positives'), render: (r) => r.positives.join(', ') || '–' },
      { key: 'm', label: t('rv.maxPrice'), num: true, render: (r) => <Plat v={r.maxPrice} /> },
      { key: 'x', label: '', render: (r) => <button className="btn sm danger" aria-label={t('common.remove')} onClick={async () => { await call('sniper:remove', r.id); q.reload(); }}><Trash2 size={14} /></button> },
    ]} />}</Loadable>
  </div>);
}

// ---------------- S13 market ----------------
export function MarketPage({ status, onChange }: { status: Status | null; onChange: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  if (!status?.wfmUser) return (
    <div className="page"><h1>{t('mk.title')}</h1>
      <form className="card stack" style={{ maxWidth: 420 }} onSubmit={async (e) => {
        e.preventDefault(); setBusy(true);
        try { await call('wfm:login', { email, password }); setPassword(''); onChange(); } catch (err) { toast((err as Error).message, true); } finally { setBusy(false); }
      }}>
        <h2 style={{ margin: 0 }}>{t('mk.connect')}</h2>
        <label className="field">{t('mk.email')}<input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="field">{t('mk.password')}<input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <p className="muted small">{t('mk.passNote')}</p>
        <button className="btn primary" disabled={busy} aria-busy={busy}>{t('mk.connect')}</button>
      </form></div>);
  return <MarketOrders user={status.wfmUser} onChange={onChange} />;
}

function MarketOrders({ user, onChange }: { user: string; onChange: () => void }) {
  const { t, lang } = useI18n();
  const q = useData<any[]>('wfm:orders');
  return (<div className="page">
    <div className="row" style={{ justifyContent: 'space-between' }}><h1>{t('mk.orders')}</h1>
      <div className="row"><span className="muted">{t('mk.connected')}: <b>{user}</b></span>
        <button className="btn" onClick={async () => { await call('wfm:logout'); onChange(); }}>{t('mk.logout')}</button></div></div>
    <Loadable q={q} empty={(d) => !d.length} emptyView={<Empty title={t('mk.noOrders')} />}>{(d) => <DataTable rows={d} rowKey={(o) => o.id} cols={[
      { key: 'i', label: t('common.name'), render: (o) => o.item?.i18n?.[lang]?.name ?? o.item?.i18n?.en?.name ?? o.itemId },
      { key: 't', label: '', render: (o) => <span className="badge muted">{o.type}</span> },
      { key: 'p', label: t('common.plat'), num: true, render: (o) => <Plat v={o.platinum} /> },
      { key: 'q', label: t('common.count'), num: true, render: (o) => o.quantity },
      { key: 'x', label: '', render: (o) => <button className="btn sm danger" aria-label={t('common.remove')} onClick={async () => { await call('wfm:remove', o.id); q.reload(); }}><Trash2 size={14} /></button> },
    ]} />}</Loadable>
  </div>);
}

// ---------------- S14 istatistik ----------------
export function StatsPage() {
  const { t } = useI18n();
  const q = useData<StatPoint[]>('stats:series');
  const label = { platinum: t('common.plat'), ducats: t('common.ducats'), credits: t('ov.credits'), endo: t('ov.endo') };
  return (<div className="page"><h1>{t('sx.title')}</h1>
    <Loadable q={q} empty={(d) => d.length < 2} emptyView={<Empty title={t('sx.none')} />}>{(d) => <div className="grid two">
      {(['platinum', 'ducats', 'credits', 'endo'] as const).map((k) => <div key={k} className="card"><h2 style={{ marginTop: 0 }}>{label[k]}</h2>
        <LineChart label={label[k]} series={d.map((p) => ({ x: Date.parse(p.ts), y: p[k] }))} /></div>)}
    </div>}</Loadable></div>);
}

// ---------------- S15 analitik ----------------
export function AnalyticsPage() {
  const { t, n } = useI18n();
  const q = useData<{ slug: string; name: I18nName; plat: number; vol: number; value: number }[]>('analytics:top');
  return (<div className="page"><h1>{t('an.title')}</h1><p className="muted">{t('an.note')}</p>
    <Loadable q={q} empty={(d) => !d.length}>{(d) => <DataTable rows={d} rowKey={(r) => r.slug} onRow={(r) => openExt(wfmUrl(r.slug))} initialSort={{ key: 'v', dir: -1 }} cols={[
      { key: 'n', label: t('common.name'), sort: (r) => n(r.name), render: (r) => <Named id={`slug:${r.slug}`}>{n(r.name)}</Named> },
      { key: 'p', label: t('common.plat'), num: true, sort: (r) => r.plat, render: (r) => <Plat v={r.plat} /> },
      { key: 'vol', label: t('an.vol'), num: true, sort: (r) => r.vol, render: (r) => r.vol },
      { key: 'v', label: t('inv.value'), num: true, sort: (r) => r.value, render: (r) => <Plat v={r.value} /> },
    ]} />}</Loadable></div>);
}

// ---------------- overlay & taramalar ----------------
export function OverlayPage() {
  const { t } = useI18n();
  const toast = useToast();
  const q = useData<ScanResult[]>('scans:list');
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); q.reload(); } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); } };
  const test = async () => {
    const f = await call<string | null>('dialog:open', [{ name: 'PNG', extensions: ['png'] }]);
    if (f) await run(() => call('scan:test', f));
  };
  return (<div className="page"><h1>{t('ol.title')}</h1>
    <p className="muted">{t('ol.howto')}</p>
    <div className="callout info" style={{ marginBottom: 12 }}>{t('set.borderless')}</div>
    <div className="row" style={{ marginBottom: 16 }}>
      <button className="btn primary" onClick={test} disabled={busy} aria-busy={busy}><ScanLine size={16} />{t('ol.test')}</button>
      <button className="btn" onClick={() => run(() => call('scan:now'))} disabled={busy}>{t('ol.scanNow')}</button>
    </div>
    <h2>{t('ol.history')}</h2>
    <Loadable q={q} empty={(d) => !d.length} emptyView={<Empty title={t('ov.noScan')} />}>{(d) => <div className="stack">{d.map((s) => <div key={s.ts} className="card"><ScanSlots scan={s} /></div>)}</div>}</Loadable>
  </div>);
}

// ---------------- S16 ayarlar ----------------
export function SettingsPage({ settings, status, onChange }: { settings: Settings; status: Status | null; onChange: (s: Settings) => void }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [riskOpen, setRiskOpen] = useState(false);
  const [risk, setRisk] = useState(false);
  const patch = async (p: Partial<Settings>) => onChange(await call<Settings>('settings:set', p));
  return (<div className="page"><h1>{t('set.title')}</h1>
    <div className="grid two">
      <section className="card stack">
        <label className="field">{t('set.uiLang')}<select className="select" value={settings.uiLang} onChange={(e) => void patch({ uiLang: e.target.value as Settings['uiLang'] })}>
          <option value="tr">Türkçe</option><option value="en">English</option></select></label>
        <label className="field">{t('set.gameLang')}<select className="select" value={settings.gameLang} onChange={(e) => void patch({ gameLang: e.target.value as Settings['gameLang'] })}>
          <option value="auto">{t('set.auto')}</option><option value="tr">Türkçe</option><option value="en">English</option></select></label>
        <label className="field">{t('set.uiScale')}<input className="input" type="number" step={0.05} min={0.5} max={1.5} value={settings.uiScale} onChange={(e) => void patch({ uiScale: Number(e.target.value) })} />
          <span className="small">{t('set.uiScaleHint')}</span></label>
      </section>
      <section className="card stack">
        <div className="row" style={{ justifyContent: 'space-between' }}><span>{t('set.overlay')}</span>
          <Switch checked={settings.overlay.enabled} label={t('set.overlay')} onChange={(v) => void patch({ overlay: { ...settings.overlay, enabled: v } })} /></div>
        <label className="field">{t('set.overlaySec')}<input className="input" type="number" min={3} max={60} value={settings.overlay.seconds} onChange={(e) => void patch({ overlay: { ...settings.overlay, seconds: Number(e.target.value) } })} /></label>
        <label className="field">{t('set.eelog')}<input className="input" defaultValue={settings.eeLogPath} onBlur={(e) => void patch({ eeLogPath: e.target.value })} />
          <span className="small">{status?.eeLogFound ? t('status.log') : t('status.nolog')}</span></label>
      </section>
      <section className="card stack">
        <div className="row" style={{ justifyContent: 'space-between' }}><span>{t('set.memory')}</span>
          <Switch checked={settings.memoryReader.enabled} label={t('set.memory')} onChange={(v) => v && !settings.memoryReader.consentAt ? setRiskOpen(true) : void patch({ memoryReader: { ...settings.memoryReader, enabled: v } })} /></div>
        <div className="callout warning small">{t('set.risk')}</div>
        {status?.memoryError && <ErrorBox msg={status.memoryError} />}
      </section>
      <section className="card stack">
        <h2 style={{ margin: 0 }}>{t('set.data')}</h2>
        <div className="small muted">{t('set.dataBuilt')}: {fmtAgo(status?.dataBuiltAt, lang)}</div>
        <div className="small muted">{t('set.prices')}: {fmtAgo(status?.pricesFetchedAt, lang)}</div>
        <button className="btn" onClick={async () => { try { await call('data:refresh'); toast(t('common.updated')); } catch (e) { toast((e as Error).message, true); } }}><RefreshCw size={16} />{t('set.refreshPrices')}</button>
      </section>
    </div>
    <Modal open={riskOpen} onClose={() => setRiskOpen(false)} title={t('set.memory')}>
      <div className="callout warning">{t('set.risk')}</div>
      <div style={{ marginTop: 12 }}><Agree checked={risk} onChange={setRisk}>{t('set.riskAgree')}</Agree></div>
      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn primary" disabled={!risk} onClick={async () => { await patch({ memoryReader: { enabled: true, consentAt: null } }); setRiskOpen(false); }}>{t('set.riskAccept')}</button>
        <button className="btn" onClick={() => setRiskOpen(false)}>{t('common.cancel')}</button>
      </div>
    </Modal>
  </div>);
}
