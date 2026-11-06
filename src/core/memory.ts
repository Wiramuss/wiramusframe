// Oyun sürecinden KULLANICININ KENDİ oturum bilgisini (accountId + nonce) SALT-OKUNUR okur.
// - Yalnız PROCESS_QUERY_INFORMATION | PROCESS_VM_READ izni istenir; yazma/enjeksiyon yoktur.
// - Okunan bilgi yalnız DE'nin envanter uç noktasına, kullanıcının kendi envanterini çekmek için gönderilir.
// - Kullanıcı ayarlardan açık onay vermeden çalışmaz (bkz. services.ts).
import { execFile } from 'node:child_process';

export interface Session { accountId: string; nonce: string }

const PROCESS_NAMES = ['Warframe.x64.exe'];
const PROCESS_QUERY_INFORMATION = 0x0400;
const PROCESS_VM_READ = 0x0010;
const MEM_COMMIT = 0x1000;
const MEM_PRIVATE = 0x20000;
const PAGE_READWRITE = 0x04;
const PAGE_GUARD = 0x100;
const CHUNK = 16 * 1024 * 1024;

export function findGamePid(): Promise<number | null> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
      if (err) return resolve(null);
      for (const line of out.split(/\r?\n/)) {
        const m = line.match(/^"([^"]+)","(\d+)"/);
        if (m && PROCESS_NAMES.includes(m[1])) return resolve(Number(m[2]));
      }
      resolve(null);
    });
  });
}

/** Bellekteki "accountId=<24 hex>&nonce=<rakam>" kalıbını bulur. Saf fonksiyon (test edilebilir). */
export function extractSession(buf: Buffer): Session | null {
  const s = buf.toString('latin1');
  const m = /accountId=([0-9a-f]{24})&nonce=(\d{4,20})/.exec(s);
  return m ? { accountId: m[1], nonce: m[2] } : null;
}

type Kernel = {
  OpenProcess: (access: number, inherit: boolean, pid: number) => unknown;
  CloseHandle: (h: unknown) => boolean;
  VirtualQueryEx: (h: unknown, addr: bigint, info: Buffer, len: number) => number;
  ReadProcessMemory: (h: unknown, addr: bigint, buf: Buffer, size: number, read: Buffer | null) => boolean;
};

let kernel: Kernel | null = null;
async function loadKernel(): Promise<Kernel> {
  if (kernel) return kernel;
  const koffi = (await import('koffi')).default;
  const lib = koffi.load('kernel32.dll');
  koffi.pointer('HANDLE', koffi.opaque());
  kernel = {
    OpenProcess: lib.func('HANDLE __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)'),
    CloseHandle: lib.func('bool __stdcall CloseHandle(HANDLE h)'),
    VirtualQueryEx: lib.func('size_t __stdcall VirtualQueryEx(HANDLE h, uint64 addr, _Out_ uint8_t *info, size_t len)'),
    ReadProcessMemory: lib.func('bool __stdcall ReadProcessMemory(HANDLE h, uint64 addr, _Out_ uint8_t *buf, size_t size, _Out_ uint8_t *read)'),
  } as unknown as Kernel;
  return kernel;
}

/** Sürecin özel, okunabilir bölgelerini tarar; oturumu bulunca durur. */
export async function readSession(pid: number, timeoutMs = 20_000): Promise<Session | null> {
  const k = await loadKernel();
  const h = k.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid);
  if (!h) throw new Error('Oyun sürecine erişilemedi (oyun yönetici olarak çalışıyorsa bu uygulamayı da yönetici olarak açın).');
  const info = Buffer.alloc(48); // MEMORY_BASIC_INFORMATION64
  const t0 = Date.now();
  try {
    let addr = 0n;
    const max = 0x7fffffffffffn;
    while (addr < max) {
      if (Date.now() - t0 > timeoutMs) return null;
      if (!k.VirtualQueryEx(h, addr, info, info.length)) break;
      const base = info.readBigUInt64LE(0);
      const size = info.readBigUInt64LE(24);
      const state = info.readUInt32LE(32);
      const protect = info.readUInt32LE(36);
      const type = info.readUInt32LE(40);
      if (state === MEM_COMMIT && type === MEM_PRIVATE && (protect & PAGE_READWRITE) && !(protect & PAGE_GUARD)) {
        for (let off = 0n; off < size; off += BigInt(CHUNK)) {
          const len = Number(size - off < BigInt(CHUNK) ? size - off : BigInt(CHUNK));
          const buf = Buffer.alloc(len);
          if (k.ReadProcessMemory(h, base + off, buf, len, null)) {
            const s = extractSession(buf);
            if (s) return s;
          }
        }
      }
      const next = base + size;
      if (next <= addr) break;
      addr = next;
    }
    return null;
  } finally {
    k.CloseHandle(h);
  }
}
