import { describe, it, expect } from 'vitest';
import {
  CouchError,
  couchRequest,
  createCouchHeaders,
  ensureDatabase,
  getDocument
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
