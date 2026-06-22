// Thin PostgREST client for the BrewDial MCP server (mirrors the old couch.ts
// shape: plain fetch + injectable fetchImpl, so tools/repos stay testable with a
// mock fetch and no @supabase/supabase-js dependency). Uses the service role key.

import type { SupabaseConfig } from './config.js';

export class SupabaseError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `Supabase request failed with status ${status}`);
    this.name = 'SupabaseError';
    this.status = status;
    this.body = body;
  }
}

function restUrl(config: SupabaseConfig, path: string): string {
  const base = config.url.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}/rest/v1${suffix}`;
}

function authHeaders(
  config: SupabaseConfig,
  extra?: Record<string, string>
): Record<string, string> {
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(extra ?? {}),
  };
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request<T>(
  config: SupabaseConfig,
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
  fetchImpl: typeof fetch = fetch
): Promise<T> {
  const { headers: extraHeaders, ...rest } = init;
  const response = await fetchImpl(restUrl(config, path), {
    ...rest,
    headers: authHeaders(config, extraHeaders),
  });
  const body = await parseBody(response);
  if (response.status >= 400) throw new SupabaseError(response.status, body);
  return body as T;
}

/** GET /rest/v1/<table>?<query>. query is a raw PostgREST querystring. */
export async function selectRows<T>(
  config: SupabaseConfig,
  table: string,
  query = '',
  fetchImpl: typeof fetch = fetch
): Promise<T[]> {
  const path = query ? `/${table}?${query}` : `/${table}`;
  const body = await request<T[] | undefined>(config, path, { method: 'GET' }, fetchImpl);
  return Array.isArray(body) ? body : [];
}

/** POST a single row, returning the inserted row (Prefer: return=representation). */
export async function insertRow<T>(
  config: SupabaseConfig,
  table: string,
  row: Record<string, unknown>,
  returning: string,
  fetchImpl: typeof fetch = fetch
): Promise<T> {
  const body = await request<T[]>(
    config,
    `/${table}?select=${returning}`,
    { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) },
    fetchImpl
  );
  const rows = Array.isArray(body) ? body : ([body] as unknown as T[]);
  if (rows[0] === undefined) {
    throw new SupabaseError(500, body, `Insert into ${table} returned no row`);
  }
  return rows[0];
}

/** PATCH rows matching <filter>, returning the updated rows. */
export async function updateRows<T>(
  config: SupabaseConfig,
  table: string,
  filter: string,
  patch: Record<string, unknown>,
  returning: string,
  fetchImpl: typeof fetch = fetch
): Promise<T[]> {
  const body = await request<T[]>(
    config,
    `/${table}?${filter}&select=${returning}`,
    { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) },
    fetchImpl
  );
  return Array.isArray(body) ? body : [];
}
