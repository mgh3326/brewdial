import { createDefaultPreferenceDoc, type PreferenceDoc } from '@brewdial/shared';
import type { CouchConfig } from '../config';
import { getDocument, putDocument } from '../couch';

export async function getGlobalPreferences(
  config: CouchConfig,
  fetchImpl?: typeof fetch
): Promise<PreferenceDoc | null> {
  return getDocument<PreferenceDoc>(config, 'preference:global', fetchImpl);
}

export async function ensureGlobalPreferences(
  config: CouchConfig,
  fetchImpl?: typeof fetch
): Promise<PreferenceDoc> {
  const existing = await getGlobalPreferences(config, fetchImpl);
  if (existing) return existing;
  const doc = createDefaultPreferenceDoc();
  return putDocument(config, doc, fetchImpl);
}
