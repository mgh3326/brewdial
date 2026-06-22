// Crash-proof probes for Apps-in-Toss bridge functions.
//
// Every call is guarded and uses a dynamic import so the spike still builds and
// runs in a plain browser (outside the Toss WebView), where the native bridge
// is absent. Inside the Toss app / sandbox, the real implementations resolve.

type Env = 'toss' | 'sandbox' | 'web';

async function sdk(): Promise<Record<string, unknown> | null> {
  try {
    return (await import('@apps-in-toss/web-framework')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// 'toss' (real Toss app) | 'sandbox' (dev sandbox app) | 'web' (plain browser).
export async function getEnv(): Promise<Env> {
  const m = await sdk();
  const fn = m?.['getOperationalEnvironment'];
  if (typeof fn === 'function') {
    try {
      const v = (fn as () => string)();
      if (v === 'toss' || v === 'sandbox') return v;
    } catch {
      // not running inside a Toss host
    }
  }
  return 'web';
}

// Keep the screen awake during a brew. Returns true if the bridge accepted it.
export async function setKeepAwake(enabled: boolean): Promise<boolean> {
  const m = await sdk();
  const fn = m?.['setScreenAwakeMode'];
  if (typeof fn === 'function') {
    try {
      await (fn as (o: { enabled: boolean }) => Promise<unknown>)({ enabled });
      return true;
    } catch {
      // bridge present but call failed (e.g. unsupported version)
    }
  }
  return false;
}

export type HapticType =
  | 'tickWeak'
  | 'tap'
  | 'tickMedium'
  | 'softMedium'
  | 'basicWeak'
  | 'basicMedium'
  | 'success'
  | 'error'
  | 'wiggle'
  | 'confetti';

// Haptic feedback fires even when the phone is on silent — a reliable foreground
// cue for a timer. Returns true if the bridge accepted it (false in a plain browser).
export async function haptic(type: HapticType = 'basicMedium'): Promise<boolean> {
  const m = await sdk();
  const fn = m?.['generateHapticFeedback'];
  if (typeof fn === 'function') {
    try {
      (fn as (o: { type: HapticType }) => void)({ type });
      return true;
    } catch {
      // bridge present but call failed
    }
  }
  return false;
}
