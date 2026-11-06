// Oyun üstü overlay (O1): tıklama geçiren şeffaf pencere; her ödül parçasının resminin üstüne kart çizer.
// Alt-tab gerekmesin diye kart her şeyi gösterir: platin, ducat, sahip olunan, set durumu, "alırsam ne olur".
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/jetbrains-mono/500.css';
import type React from 'react';
import type { ScanResult, SlotResult } from '../shared/types';
import './api';

type Scan = ScanResult & { k: number };
type Lang = 'tr' | 'en';

const C = { bg: 'linear-gradient(180deg, rgba(21,28,40,.95), rgba(7,9,15,.95))', text: '#e6e9ef', muted: '#8d97a8', border: 'rgba(227,184,102,.35)', accent: '#e3b866', plat: '#6fd6ff', ok: '#4fd69a', warn: '#f2a65a' };
const DISPLAY = "'Barlow Condensed', Inter, 'Segoe UI', sans-serif";
const MONO = "'JetBrains Mono', Consolas, monospace";
const CUT = 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)';

const TXT = {
  tr: { best: 'EN İYİ', vaulted: 'KASADA', completes: 'SETİ TAMAMLAR', needed: 'SETE LAZIM', extra: 'FAZLA', owned: 'SENDE' },
  en: { best: 'BEST', vaulted: 'VAULTED', completes: 'COMPLETES SET', needed: 'SET NEEDS', extra: 'EXTRA', owned: 'OWNED' },
};

// küçük ikonlar (kendi çizimimiz): platin = mavi elmas, ducat = altın sikke
const PlatIcon = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden><path d="M8 1 15 8 8 15 1 8Z" fill={C.plat} /><path d="M8 4 12 8 8 12 4 8Z" fill="#c9f0ff" opacity=".55" /></svg>);
const DucatIcon = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden><circle cx="8" cy="8" r="7" fill={C.accent} /><circle cx="8" cy="8" r="4.2" fill="none" stroke="#7a5a17" strokeWidth="1.4" /></svg>);

function Chip({ color, bg, children, fs }: { color: string; bg: string; children: React.ReactNode; fs: number }) {
  return <span style={{ color, background: bg, fontSize: fs, fontWeight: 500, fontFamily: MONO, letterSpacing: '.08em', padding: '2px 7px', borderRadius: 2, whiteSpace: 'nowrap' }}>{children}</span>;
}

function Card({ s, best, lang, fs }: { s: SlotResult; best: boolean; lang: Lang; fs: (px: number) => number }) {
  const L = TXT[lang];
  const set = s.set;
  const status = set?.outcome === 'completes' ? <Chip fs={fs(11)} color="#0b1a12" bg={C.ok}>✓ {L.completes}</Chip>
    : set?.outcome === 'needed' ? <Chip fs={fs(11)} color="#06202c" bg={C.plat}>{L.needed} {set.have + 1}/{set.need}</Chip>
    : set?.outcome === 'extra' ? <Chip fs={fs(11)} color={C.text} bg="#3a4558">{L.extra} · {s.owned}</Chip>
    : <Chip fs={fs(11)} color={C.text} bg="#3a4558">{L.owned} {s.owned}</Chip>;
  return (<>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: fs(14) }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: C.plat, fontSize: fs(30), fontWeight: 700, fontFamily: DISPLAY, textShadow: '0 0 12px rgba(111,214,255,.45)' }}><PlatIcon size={fs(18)} />{s.plat ?? '–'}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: C.accent, fontSize: fs(25), fontWeight: 700, fontFamily: DISPLAY }}><DucatIcon size={fs(15)} />{s.ducats ?? '–'}</span>
    </div>
    <div style={{ display: 'flex', justifyContent: 'center', gap: 5, marginTop: 5, flexWrap: 'wrap' }}>
      {best && <Chip fs={fs(11)} color="#1a1205" bg={C.accent}>★ {L.best}</Chip>}
      {status}
      {s.vaulted && <Chip fs={fs(11)} color={C.warn} bg="rgba(240,163,94,.15)">{L.vaulted}</Chip>}
    </div>
  </>);
}

function Overlay() {
  const [scan, setScan] = useState<Scan | null>(null);
  const [lang, setLang] = useState<Lang>('tr');
  useEffect(() => {
    window.wiramus.onOverlay((s) => {
      setScan(s as Scan);
      void window.wiramus.invoke('settings:get').then((r) => { if (r.ok) setLang((r.data as { uiLang: Lang }).uiLang); });
    });
  }, []);
  if (!scan) return null;
  // 1080p'ye göre ölçek: yazılar her çözünürlükte okunur kalsın
  const unit = (scan.screen.height / 1080) * scan.k;
  const fs = (px: number) => Math.round(px * Math.max(0.85, Math.min(unit, 1.6)) * 10) / 10;
  return (<>{scan.slots.map((s, i) => {
    if (!s.uniqueName) return null;
    const w = s.width * scan.k;
    const best = i === scan.bestIndex;
    return (
      // kartın alt kenarı ad yazısının hemen üstünde: parçanın resminin üstüne oturur
      <div key={`${scan.ts}-${i}`} style={{
        position: 'fixed', left: s.x * scan.k + w * 0.08, width: w * 0.84, top: s.y * scan.k - 6 * unit, transform: 'translateY(-100%)',
        background: C.bg, color: C.text, borderRadius: 0, clipPath: CUT, padding: '6px 8px', fontFamily: 'Inter, Segoe UI, sans-serif', boxSizing: 'border-box',
        border: best ? `2px solid ${C.accent}` : `1px solid ${C.border}`, boxShadow: best ? 'inset 0 0 22px rgba(227,184,102,.18)' : 'none',
        animation: 'in 200ms ease',
      }}>
        <Card s={s} best={best} lang={lang} fs={fs} />
      </div>
    );
  })}<style>{'@keyframes in{from{opacity:0}to{opacity:1}} html,body{background:transparent;margin:0;overflow:hidden}'}</style></>);
}

createRoot(document.getElementById('root')!).render(<Overlay />);
