import type { CounterDoc } from '@brewdial/shared';
import type { CouchConfig } from '../config.js';
import { CouchError, getDocument, putDocument } from '../couch.js';

const COUNTER_ID = 'counter:recipe';
const MAX_RETRIES = 3;

function pad4(value: number): string {
  return value.toString().padStart(4, '0');
}

export async function nextRecipeCode(
  config: CouchConfig,
  fetchImpl: typeof fetch = fetch
): Promise<`COF-${string}`> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const now = new Date().toISOString();
    const existing = await getDocument<CounterDoc>(config, COUNTER_ID, fetchImpl);
    const current = existing?.next ?? 1;
    const updated: CounterDoc = existing
      ? { ...existing, next: current + 1, updatedAt: now }
      : {
          _id: COUNTER_ID,
          type: 'counter',
          next: current + 1,
          createdAt: now,
          updatedAt: now
        };

    try {
      await putDocument(config, updated, fetchImpl);
      return `COF-${pad4(current)}`;
    } catch (err) {
      if (err instanceof CouchError && err.status === 409) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error('nextRecipeCode failed after retries');
}
