// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSoundPreference, saveSoundPreference, SOUND_PREF_KEY } from './sound-preference';

describe('sound-preference', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to true when nothing is stored', () => {
    expect(loadSoundPreference()).toBe(true);
  });

  it('returns false only when the stored value is exactly "false"', () => {
    localStorage.setItem(SOUND_PREF_KEY, 'false');
    expect(loadSoundPreference()).toBe(false);

    localStorage.setItem(SOUND_PREF_KEY, 'true');
    expect(loadSoundPreference()).toBe(true);

    localStorage.setItem(SOUND_PREF_KEY, 'garbage');
    expect(loadSoundPreference()).toBe(true);
  });

  it('persists boolean values', () => {
    saveSoundPreference(false);
    expect(localStorage.getItem(SOUND_PREF_KEY)).toBe('false');
    saveSoundPreference(true);
    expect(localStorage.getItem(SOUND_PREF_KEY)).toBe('true');
  });

  it('survives a setItem that throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => saveSoundPreference(true)).not.toThrow();
    expect(spy).toHaveBeenCalled();
  });

  it('returns true when localStorage access throws on read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadSoundPreference()).toBe(true);
  });
});
