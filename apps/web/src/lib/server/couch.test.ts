import { describe, it, expect } from 'vitest';
import {
  CouchError,
  couchRequest,
  createCouchHeaders,
  ensureDatabase,
  getDocument,
  getAllDocuments
} from './couch';
import type { CouchConfig } from './config';

const baseConfig: CouchConfig = {
  url: 'http://127.0.0.1:5984',
  database: 'coffee'
};

const authConfig: CouchConfig = {
  ...baseConfig,
  username: 'admin',
  password: 'secret'
};

interface MockResponseSpec {
  status: number;
  body?: unknown;
  contentType?: string;
}

function mockFetch(spec: MockResponseSpec): typeof fetch {
  return (async () => {
    const text = spec.body === undefined ? '' : JSON.stringify(spec.body);
    return new Response(text, {
      status: spec.status,
      headers: { 'content-type': spec.contentType ?? 'application/json' }
    });
  }) as unknown as typeof fetch;
}

describe('createCouchHeaders', () => {
  it('omits Authorization when username/password are missing', () => {
    const headers = createCouchHeaders(baseConfig);
    expect(headers.has('Authorization')).toBe(false);
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('includes Basic auth when both username and password are present', () => {
    const headers = createCouchHeaders(authConfig);
    const expected = `Basic ${Buffer.from('admin:secret').toString('base64')}`;
    expect(headers.get('Authorization')).toBe(expected);
  });
});

describe('ensureDatabase', () => {
  it('returns { created: true } on 201', async () => {
    const result = await ensureDatabase(baseConfig, mockFetch({ status: 201, body: { ok: true } }));
    expect(result).toEqual({ created: true });
  });

  it('returns { created: false } on 412', async () => {
    const result = await ensureDatabase(
      baseConfig,
      mockFetch({ status: 412, body: { error: 'file_exists', reason: 'already exists' } })
    );
    expect(result).toEqual({ created: false });
  });
});

describe('getDocument', () => {
  it('returns null on 404', async () => {
    const result = await getDocument<{ _id: string }>(
      baseConfig,
      'preference:global',
      mockFetch({ status: 404, body: { error: 'not_found' } })
    );
    expect(result).toBeNull();
  });
});

describe('couchRequest', () => {
  it('throws CouchError with status and parsed body on unexpected status', async () => {
    const fetchImpl = mockFetch({ status: 500, body: { error: 'internal_server_error' } });
    await expect(couchRequest(baseConfig, '/coffee', { method: 'GET' }, fetchImpl)).rejects.toMatchObject({
      name: 'CouchError',
      status: 500,
      body: { error: 'internal_server_error' }
    });
    await expect(couchRequest(baseConfig, '/coffee', { method: 'GET' }, fetchImpl)).rejects.toBeInstanceOf(CouchError);
  });
});

describe('getAllDocuments', () => {
  it('builds a _all_docs URL with startkey/endkey/include_docs/limit and returns rows.doc', async () => {
    const captured: { url?: string; method?: string } = {};
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      captured.url = url;
      captured.method = init?.method ?? 'GET';
      return new Response(
        JSON.stringify({
          total_rows: 2,
          offset: 0,
          rows: [
            { id: 'recipe:COF-0001', key: 'recipe:COF-0001', value: { rev: '1-x' }, doc: { _id: 'recipe:COF-0001', _rev: '1-x', type: 'recipe' } },
            { id: 'recipe:COF-0002', key: 'recipe:COF-0002', value: { rev: '1-y' }, doc: { _id: 'recipe:COF-0002', _rev: '1-y', type: 'recipe' } }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }) as unknown as typeof fetch;

    const docs = await getAllDocuments<{ _id: string; _rev: string; type: string }>(
      baseConfig,
      { startkey: 'recipe:', endkey: 'recipe:￰', includeDocs: true, limit: 50 },
      fetchImpl
    );

    expect(docs).toHaveLength(2);
    expect(docs[0]._id).toBe('recipe:COF-0001');
    expect(captured.method).toBe('GET');
    expect(captured.url).toContain('/coffee/_all_docs');
    expect(captured.url).toContain('include_docs=true');
    expect(captured.url).toContain('limit=50');
    // startkey and endkey must be JSON-encoded strings, then URL-encoded
    expect(captured.url).toContain('startkey=' + encodeURIComponent('"recipe:"'));
    expect(captured.url).toContain('endkey=' + encodeURIComponent('"recipe:￰"'));
  });

  it('skips rows whose doc is missing when includeDocs is true', async () => {
    const fetchImpl = mockFetch({
      status: 200,
      body: {
        total_rows: 1,
        offset: 0,
        rows: [{ id: 'recipe:COF-0001', key: 'recipe:COF-0001', value: { rev: '1-x' } }]
      }
    });
    const docs = await getAllDocuments<{ _id: string }>(
      baseConfig,
      { startkey: 'recipe:', endkey: 'recipe:￰', includeDocs: true },
      fetchImpl
    );
    expect(docs).toEqual([]);
  });
});
