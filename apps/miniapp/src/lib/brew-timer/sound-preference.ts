// Ported from apps/web/src/lib/brew-timer/sound-preference.ts.
export const SOUND_PREF_KEY = 'brewdial.timer.soundEnabled';

export function loadSoundPreference(): boolean {
  if (typeof localStorage === 'undefined') return true;
  try {
    return localStorage.getItem(SOUND_PREF_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function saveSoundPreference(enabled: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SOUND_PREF_KEY, enabled ? 'true' : 'false');
  } catch {
    // ignore quota / private mode failures
  }
}
