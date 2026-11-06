// Renderer tarafı IPC sarmalayıcısı + küçük veri kancası.
import { useCallback, useEffect, useState } from 'react';

declare global {
  interface Window {
    wiramus: {
      invoke(channel: string, arg?: unknown): Promise<{ ok: boolean; data?: unknown; error?: string }>;
      on(cb: (msg: { event: string; data: unknown }) => void): () => void;
      onOverlay(cb: (scan: unknown) => void): void;
    };
  }
}

export async function call<T>(channel: string, arg?: unknown): Promise<T> {
  const r = await window.wiramus.invoke(channel, arg);
  if (!r.ok) throw new Error(r.error ?? 'Hata');
  return r.data as T;
}

/** Bir kanaldan veri yükler; argüman değişince ve envanter/fiyat olaylarında yeniler. */
export function useData<T>(channel: string, arg?: unknown) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const key = JSON.stringify(arg ?? null);
  const load = useCallback(() => {
    setLoading(true);
    call<T>(channel, key === 'null' ? undefined : JSON.parse(key))
      .then((d) => { setData(d); setError(null); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [channel, key]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => window.wiramus.on((m) => { if (m.event === 'inventory' || m.event === 'prices') load(); }), [load]);
  return { data, error, loading, reload: load };
}
