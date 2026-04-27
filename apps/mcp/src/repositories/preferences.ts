import type { PreferenceDoc } from '@brewdial/shared';
import type { CouchConfig } from '../config.js';
import { getDocument } from '../couch.js';

export async function getGlobalPreferences(
  config: CouchConfig,
  fetchImpl?: typeof fetch
): Promise<PreferenceDoc | null> {
  return getDocument<PreferenceDoc>(config, 'preference:global', fetchImpl);
}
