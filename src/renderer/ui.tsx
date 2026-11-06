// Tasarım sistemi bileşenleri (replica/design/components.md).
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Inbox, X } from 'lucide-react';
import { fmtNum, useI18n } from './i18n';
import { call } from './api';

// ---- eşya görselleri: uniqueName (veya "slug:<slug>") -> URL, bir kez yüklenir ----
let iconMap: Record<string, string> | null = null;
let iconLoad: Promise<void> | null = null;
const iconSubs = new Set<() => void>();
function useIcons() {
  const [, bump] = useState(0);
  useEffect(() => {
    if (iconMap) return;
    const cb = () => bump((x) => x + 1);
    iconSubs.add(cb);
    iconLoad ??= call<Record<string, string>>('data:icons')
      .then((m) => { iconMap = m; }).catch(() => { iconMap = {}; })
      .finally(() => iconSubs.forEach((s) => s()));
    return () => { iconSubs.delete(cb); };
  }, []);
  return iconMap;
}

export function Thumb({ id, size = 36 }: { id?: string | null; size?: number }) {
  const icons = useIcons();
  const [bad, setBad] = useState<string | null>(null);
  const src = id ? icons?.[id] : undefined;
  if (!src || bad === src) return <span className="thumb ph" style={{ width: size, height: size }} aria-hidden />;
  return <img className="thumb" src={src} width={size} height={size} alt="" loading="lazy" decoding="async"
    referrerPolicy="no-referrer" onError={() => setBad(src)} />;
}

/** Görsel + ad, tablo hücreleri için. */
export function Named({ id, children, size }: { id?: string | null; children: ReactNode; size?: number }) {
  return <span className="named"><Thumb id={id} size={size} /><span>{children}</span></span>;
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)} />;
}

export function Tile({ label, value, cls, children }: { label: string; value: ReactNode; cls?: string; children?: ReactNode }) {
  return <div className="card tile"><div className="label">{label}</div><div className={`value ${cls ?? ''}`}>{value}</div>{children}</div>;
}

export function Plat({ v }: { v: number | null | undefined }) {
  const { lang } = useI18n();
  return <span className="plat num">{v == null ? '–' : `${fmtNum(v, lang)} p`}</span>;
}
export function Ducat({ v }: { v: number | null | undefined }) {
  const { lang } = useI18n();
  return <span className="ducat num">{v == null ? '–' : `${fmtNum(v, lang)} d`}</span>;
}

export function Progress({ value, max, label }: { value: number; max: number; label?: string }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  return <div className="progress" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}><div style={{ width: `${pct}%` }} /></div>;
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return <div className="empty"><div className="icon"><Inbox size={40} aria-hidden /></div><strong>{title}</strong>{hint && <div>{hint}</div>}{action && <div style={{ marginTop: 16 }}>{action}</div>}</div>;
}

export function Skeleton({ rows = 6 }: { rows?: number }) {
  return <div aria-busy="true">{Array.from({ length: rows }, (_, i) => <div key={i} className="skel" style={{ width: `${90 - (i % 3) * 15}%` }} />)}</div>;
}

export function ErrorBox({ msg }: { msg: string }) {
  return <div className="callout danger" role="alert">{msg}</div>;
}

/** Yükleme / hata / boş durumlarını tek yerde ele alır. */
export function Loadable<T>({ q, empty, emptyView, children }: {
  q: { data: T | null; error: string | null; loading: boolean }; empty?: (d: T) => boolean; emptyView?: ReactNode; children: (d: T) => ReactNode;
}) {
  const { t } = useI18n();
  if (q.error) return <ErrorBox msg={q.error} />;
  if (q.loading && q.data == null) return <Skeleton />;
  if (q.data == null || (empty && empty(q.data))) return <>{emptyView ?? <Empty title={t('common.empty')} />}</>;
  return <>{children(q.data)}</>;
}

export interface Col<R> { key: string; label: string; num?: boolean; sort?: (r: R) => number | string; render: (r: R) => ReactNode; width?: number }

export function DataTable<R>({ rows, cols, onRow, rowKey, initialSort, limit = 500 }: {
  rows: R[]; cols: Col<R>[]; onRow?: (r: R) => void; rowKey: (r: R) => string; initialSort?: { key: string; dir: 1 | -1 }; limit?: number;
}) {
  const { t } = useI18n();
  const [sort, setSort] = useState(initialSort ?? null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const c = cols.find((x) => x.key === sort.key);
    if (!c?.sort) return rows;
    return [...rows].sort((a, b) => {
      const x = c.sort!(a), y = c.sort!(b);
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'tr')) * sort.dir;
    });
  }, [rows, cols, sort]);
  if (!rows.length) return <Empty title={t('common.empty')} />;
  return (
    <div className="tablewrap">
      <table className="dt">
        <thead><tr>{cols.map((c) => (
          <th key={c.key} className={c.num ? 'num' : ''} style={c.width ? { width: c.width } : undefined}
            aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
            onClick={() => c.sort && setSort((s) => ({ key: c.key, dir: s?.key === c.key ? (-s.dir as 1 | -1) : -1 }))}>
            {c.label}{sort?.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
          </th>))}</tr></thead>
        <tbody>{sorted.slice(0, limit).map((r) => (
          <tr key={rowKey(r)} className={onRow ? 'click' : ''} tabIndex={onRow ? 0 : undefined}
            onClick={() => onRow?.(r)} onKeyDown={(e) => { if (onRow && e.key === 'Enter') onRow(r); }}>
            {cols.map((c) => <td key={c.key} className={c.num ? 'num' : ''}>{c.render(r)}</td>)}
          </tr>))}</tbody>
      </table>
    </div>
  );
}

export function Chips<V extends string>({ value, options, onChange }: { value: V; options: { v: V; label: string }[]; onChange: (v: V) => void }) {
  return <div className="row" role="group">{options.map((o) => <button key={o.v} type="button" className="chip" aria-pressed={value === o.v} onClick={() => onChange(o.v)}>{o.label}</button>)}</div>;
}

export function Drawer({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (<>
    <div className="drawer-bg" onClick={onClose} />
    <div className="drawer" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}><h1 style={{ margin: 0 }}>{title}</h1>
        <button className="btn ghost" onClick={onClose} aria-label={t('common.close')}><X size={18} /></button></div>
      {children}
    </div>
  </>);
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (<><div className="drawer-bg" onClick={onClose} /><div className="modal" role="dialog" aria-modal="true" aria-label={title}><h2 style={{ marginTop: 0 }}>{title}</h2>{children}</div></>);
}

export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${38 - ((v - min) / span) * 36}`).join(' ');
  return <svg className="spark" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden><polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>;
}

export function LineChart({ series, label }: { series: { x: number; y: number }[]; label: string }) {
  const { lang } = useI18n();
  if (series.length < 2) return null;
  const W = 600, H = 180, P = 32;
  const xs = series.map((p) => p.x), ys = series.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sx = (x: number) => P + ((x - x0) / (x1 - x0 || 1)) * (W - P * 2);
  const sy = (y: number) => H - P / 2 - ((y - y0) / (y1 - y0 || 1)) * (H - P);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 200 }} role="img" aria-label={label}>
      <text x={4} y={14} fill="var(--text-muted)" fontSize="11">{fmtNum(y1, lang)}</text>
      <text x={4} y={H - 6} fill="var(--text-muted)" fontSize="11">{fmtNum(y0, lang)}</text>
      <polyline points={series.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2" />
    </svg>
  );
}

// ---- toast ----
type ToastMsg = { text: string; error?: boolean } | null;
const ToastCtx = createContext<(text: string, error?: boolean) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);
export function ToastHost({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<ToastMsg>(null);
  useEffect(() => { if (!msg) return; const id = setTimeout(() => setMsg(null), 4500); return () => clearTimeout(id); }, [msg]);
  return <ToastCtx.Provider value={(text, error) => setMsg({ text, error })}>{children}
    {msg && <div className={`toast ${msg.error ? 'error' : ''}`} role="status">{msg.text}</div>}</ToastCtx.Provider>;
}
