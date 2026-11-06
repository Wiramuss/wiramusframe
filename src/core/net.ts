// Ağ istemcileri: fiyatlar, warframe.market (kullanıcının kendi hesabı), riven açık artırmaları,
// DE envanter uç noktası. Hepsi açık/public uç noktalar.
import type { Auction, GameData, Prices } from '../shared/types';

const UA = 'wiramusframe/0.1';
const WFM1 = 'https://api.warframe.market/v1';
const WFM2 = 'https://api.warframe.market/v2';
export const INVENTORY_URL = 'https://mobile.warframe.com/api/inventory.php';

// WFM ~3 istek/sn: basit sıra
let chain: Promise<unknown> = Promise.resolve();
function queued<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn, fn);
  const gap = () => new Promise((r) => setTimeout(r, 350));
  chain = p.then(gap, gap);
  return p;
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

/** Toplu prime fiyatları (warframestat/wfinfo) + slug eşlemesi. */
export async function fetchPrices(gd: GameData): Promise<Prices> {
  const rows: { name: string; custom_avg: string; today_vol: string; yesterday_vol: string }[] =
    await getJson('https://api.warframestat.us/wfinfo/prices');
  const slugByEn = new Map<string, string>();
  for (const it of Object.values(gd.items)) if (it.slug) slugByEn.set(it.name.en.toLowerCase(), it.slug);
  const bySlug: Prices['bySlug'] = {};
  for (const r of rows) {
    const slug = slugByEn.get(r.name.toLowerCase());
    const plat = Number(r.custom_avg);
    if (slug && Number.isFinite(plat)) bySlug[slug] = { plat: Math.round(plat), vol: Number(r.today_vol) + Number(r.yesterday_vol) };
  }
  return { fetchedAt: new Date().toISOString(), bySlug };
}

/** Tek eşya için çevrimiçi satıcıların en düşük 5 fiyatının medyanı. */
export async function fetchItemPrice(slug: string): Promise<number | null> {
  const j = await queued(() => getJson(`${WFM2}/orders/item/${slug}/top`));
  const sells: number[] = (j?.data?.sell ?? []).map((o: any) => o.platinum).slice(0, 5);
  if (!sells.length) return null;
  sells.sort((a, b) => a - b);
  return sells[Math.floor(sells.length / 2)];
}

// ---- warframe.market hesabı ----
export async function wfmLogin(email: string, password: string): Promise<{ token: string; user: string }> {
  const r = await fetch(`${WFM1}/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'JWT', 'User-Agent': UA, platform: 'pc', language: 'en' },
    body: JSON.stringify({ auth_type: 'header', email, password }),
  });
  const body: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = body?.error ? JSON.stringify(body.error) : `HTTP ${r.status}`;
    throw new Error(e.includes('email_not_exist') ? 'E-posta bulunamadı' : e.includes('password') ? 'Şifre hatalı' : e);
  }
  const token = (r.headers.get('authorization') ?? '').replace(/^JWT\s+/i, '');
  if (!token) throw new Error('Oturum anahtarı alınamadı');
  return { token, user: body?.payload?.user?.ingame_name ?? email };
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': UA, Platform: 'pc', Language: 'tr' };
}

export async function wfmMyOrders(token: string): Promise<any[]> {
  const r = await queued(() => fetch(`${WFM2}/orders/my`, { headers: authHeaders(token) }));
  if (!r.ok) throw new Error(`WFM HTTP ${r.status}`);
  return ((await r.json()) as any).data ?? [];
}

export async function wfmCreateOrder(token: string, itemId: string, platinum: number, quantity: number) {
  const body = { itemId, type: 'sell', platinum, quantity, visible: true };
  const r = await queued(() => fetch(`${WFM2}/order`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify(body) }));
  if (!r.ok) throw new Error(`İlan oluşturulamadı (HTTP ${r.status}): ${await r.text()}`);
  return ((await r.json()) as any).data;
}

export async function wfmDeleteOrder(token: string, orderId: string) {
  const r = await queued(() => fetch(`${WFM2}/order/${orderId}`, { method: 'DELETE', headers: authHeaders(token) }));
  if (!r.ok) throw new Error(`İlan silinemedi (HTTP ${r.status})`);
}

export async function wfmItemId(slug: string): Promise<string> {
  const j = await queued(() => getJson(`${WFM2}/item/${slug}`));
  return j.data.id;
}

// ---- riven açık artırmaları (public) ----
export async function searchRivens(weaponSlug: string, positives: string[] = [], negative?: string): Promise<Auction[]> {
  const q = new URLSearchParams({ type: 'riven', weapon_url_name: weaponSlug, sort_by: 'price_asc', buyout_policy: 'direct' });
  if (positives.length) q.set('positive_stats', positives.join(','));
  if (negative) q.set('negative_stats', negative);
  const j = await queued(() => getJson(`${WFM1}/auctions/search?${q}`, { Platform: 'pc' }));
  return (j?.payload?.auctions ?? []).map((a: any) => ({
    id: a.id, weapon: a.item?.weapon_url_name, name: a.item?.name, price: a.buyout_price ?? a.starting_price,
    seller: a.owner?.ingame_name, status: a.owner?.status, rerolls: a.item?.re_rolls ?? 0, mr: a.item?.mastery_level ?? 0,
    attrs: (a.item?.attributes ?? []).map((x: any) => ({ slug: x.url_name, value: x.value, positive: x.positive })),
  }));
}

// ---- DE envanteri ----
export async function fetchInventory(accountId: string, nonce: string): Promise<any> {
  const url = `${INVENTORY_URL}?accountId=${encodeURIComponent(accountId)}&nonce=${encodeURIComponent(nonce)}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`Envanter alınamadı (HTTP ${r.status})`);
  const j = await r.json();
  if (!j || typeof j !== 'object' || !('PlayerLevel' in j || 'MiscItems' in j)) throw new Error('Beklenmeyen envanter yanıtı');
  return j;
}
