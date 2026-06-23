// Phase 1 identity (v1 — best-effort, SPOOFABLE, NOT a security boundary; real
// security arrives with Toss Login in v2). Resolves a stable (provider, externalKey)
// pair that the SECURITY DEFINER RPCs (rpc_*) use to scope a user's owned/saved data.
//   - Toss WebView: getAnonymousKey() (provider 'toss_anon') — stable per Toss user.
//   - Plain web:    a persisted localStorage UUID (provider 'web_local').
// The two do NOT match across surfaces; cross-surface unification is v2 (Toss Login
// + merge_app_users). The key is persisted so one device keeps one durable identity.

import { getEnv } from './toss';

export type IdentityProvider = 'toss_anon' | 'web_local';
export interface Identity {
  provider: IdentityProvider;
  externalKey: string;
}

const STORE_KEY = 'brewdial.identity';
// DB constraint: user_identities.external_key length is between 16 and 256.
const MIN_KEY_LEN = 16;

let cached: Promise<Identity> | null = null;

function readStored(): Identity | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Identity>;
    if (
      (v.provider === 'toss_anon' || v.provider === 'web_local') &&
      typeof v.externalKey === 'string' &&
      v.externalKey.length >= MIN_KEY_LEN
    ) {
      return { provider: v.provider, externalKey: v.externalKey };
    }
  } catch {
    // ignore corrupt / unavailable storage
  }
  return null;
}

function writeStored(id: Identity): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(id));
  } catch {
    // ignore quota / private mode
  }
}

// Crash-safe getAnonymousKey probe (mirrors toss.ts). Returns the hash or null.
// Toss returns { type:'HASH', hash } on success, or 'INVALID_CATEGORY'|'ERROR'|undefined.
async function tossAnonKey(): Promise<string | null> {
  try {
    const m = (await import('@apps-in-toss/web-framework')) as Record<string, unknown>;
    const fn = m['getAnonymousKey'];
    if (typeof fn === 'function') {
      const res = (await (fn as () => Promise<unknown>)()) as
        | { type?: string; hash?: string }
        | string
        | undefined;
      if (res && typeof res === 'object' && res.type === 'HASH' && typeof res.hash === 'string') {
        return res.hash;
      }
    }
  } catch {
    // bridge absent (plain browser) or call failed (unsupported host version)
  }
  return null;
}

function genUuid(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(b);
  } else {
    // Degenerate no-crypto fallback: salt with the clock so keys are not all-zero.
    let seed = Date.now();
    for (let i = 0; i < 16; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      b[i] = seed & 0xff;
    }
  }
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Resolve the current identity (memoised for the session).
export function resolveIdentity(): Promise<Identity> {
  if (cached) return cached;
  cached = (async () => {
    const env = await getEnv();
    if (env === 'toss' || env === 'sandbox') {
      const hash = await tossAnonKey();
      if (hash && hash.length >= MIN_KEY_LEN) {
        const id: Identity = { provider: 'toss_anon', externalKey: hash };
        writeStored(id);
        return id;
      }
      // Toss host but the anon-key bridge is unavailable (older app / error):
      // reuse a previously stored toss_anon key if we have one.
      const prevToss = readStored();
      if (prevToss?.provider === 'toss_anon') return prevToss;
    }
    // Web surface (or Toss fallback): persisted local UUID.
    const prev = readStored();
    if (prev?.provider === 'web_local') return prev;
    const id: Identity = { provider: 'web_local', externalKey: genUuid() };
    writeStored(id);
    return id;
  })();
  return cached;
}
