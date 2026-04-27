import type { CouchConfig } from './config.js';

export interface CouchRequestOptions extends RequestInit {
  expectedStatuses?: number[];
}

export interface CouchInfo {
  couchdb?: string;
  version?: string;
  vendor?: unknown;
}

export interface DatabaseInfo {
  db_name: string;
  doc_count: number;
  update_seq: string | number;
}

export class CouchError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `CouchDB request failed with status ${status}`);
    this.name = 'CouchError';
    this.status = status;
    this.body = body;
  }
}

export function createCouchHeaders(config: CouchConfig, extra?: Record<string, string>): Headers {
  const headers = new Headers(extra);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (config.username && config.password) {
    const token = Buffer.from(`${config.username}:${config.password}`).toString('base64');
    headers.set('Authorization', `Basic ${token}`);
  }
  return headers;
}

function buildUrl(config: CouchConfig, path: string): string {
  const base = config.url.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

export async function couchRequest<T>(
  config: CouchConfig,
  path: string,
  options: CouchRequestOptions = {},
  fetchImpl: typeof fetch = fetch
): Promise<T> {
  const { expectedStatuses = [200, 201, 202], headers: optHeaders, ...init } = options;
  const headers = createCouchHeaders(config, optHeaders as Record<string, string> | undefined);
  const response = await fetchImpl(buildUrl(config, path), { ...init, headers });
  const body = await parseBody(response);
  if (!expectedStatuses.includes(response.status)) {
    throw new CouchError(response.status, body);
  }
  return body as T;
}

export async function getDocument<T>(
  config: CouchConfig,
  id: string,
  fetchImpl: typeof fetch = fetch
): Promise<T | null> {
  try {
    return await couchRequest<T>(
      config,
      `/${encodeURIComponent(config.database)}/${encodeURIComponent(id)}`,
      { method: 'GET' },
      fetchImpl
    );
  } catch (err) {
    if (err instanceof CouchError && err.status === 404) return null;
    throw err;
  }
}

export async function putDocument<T extends { _id: string; _rev?: string }>(
  config: CouchConfig,
  doc: T,
  fetchImpl: typeof fetch = fetch
): Promise<T & { _rev: string }> {
  const response = await couchRequest<{ ok: boolean; id: string; rev: string }>(
    config,
    `/${encodeURIComponent(config.database)}/${encodeURIComponent(doc._id)}`,
    {
      method: 'PUT',
      body: JSON.stringify(doc),
      expectedStatuses: [201, 202]
    },
    fetchImpl
  );
  return { ...doc, _rev: response.rev };
}

export interface AllDocsOptions {
  startkey?: string;
  endkey?: string;
  includeDocs?: boolean;
  limit?: number;
  descending?: boolean;
}

interface AllDocsRow<T> {
  id: string;
  key: string;
  value: { rev: string };
  doc?: T;
}

interface AllDocsResponse<T> {
  total_rows: number;
  offset: number;
  rows: AllDocsRow<T>[];
}

export async function getAllDocuments<T>(
  config: CouchConfig,
  options: AllDocsOptions = {},
  fetchImpl: typeof fetch = fetch
): Promise<T[]> {
  const params = new URLSearchParams();
  if (options.startkey !== undefined) params.set('startkey', JSON.stringify(options.startkey));
  if (options.endkey !== undefined) params.set('endkey', JSON.stringify(options.endkey));
  if (options.includeDocs) params.set('include_docs', 'true');
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.descending) params.set('descending', 'true');

  const query = params.toString();
  const path =
    `/${encodeURIComponent(config.database)}/_all_docs` + (query ? `?${query}` : '');

  const body = await couchRequest<AllDocsResponse<T>>(
    config,
    path,
    { method: 'GET' },
    fetchImpl
  );

  if (!options.includeDocs) {
    return body.rows.map((row) => row as unknown as T);
  }
  return body.rows
    .map((row) => row.doc)
    .filter((doc): doc is T => doc !== undefined);
}
