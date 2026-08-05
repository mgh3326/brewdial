// One-time migration of the legacy localStorage gear preference (brewdial.gear)
// into the server-side user_gear table via rpc_upsert_gear. localStorage stays as
// an offline cache; this just seeds the per-user gear record so it survives across
// devices once Toss Login (v2) links identities. Safe to call on every launch.

import { loadGear } from '../gear-preferences';
import { upsertGear } from './user-content';

const MIGRATED_KEY = 'brewdial.gear.migrated';

export async function migrateLocalGearOnce(): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  try {
    if (localStorage.getItem(MIGRATED_KEY)) return;
  } catch {
    return; // storage unavailable; nothing to migrate
  }

  const gear = loadGear();
  // Only a named grinder is meaningful gear to seed; method/grind ride along as details.
  if (!gear.grinder) {
    try {
      localStorage.setItem(MIGRATED_KEY, '1'); // nothing to do; don't retry every launch
    } catch {
      // ignore
    }
    return;
  }

  try {
    await upsertGear({
      kind: 'grinder',
      label: gear.grinder,
      details: { defaultGrind: gear.grind, method: gear.method },
      isDefault: true,
    });
    localStorage.setItem(MIGRATED_KEY, '1');
  } catch {
    // Leave the flag unset so a later launch retries (the RPC is idempotent-friendly).
  }
}
