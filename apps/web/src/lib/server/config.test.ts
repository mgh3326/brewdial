import { describe, expect, it } from 'vitest';
import { getSafeConfigStatus, getServerConfig } from './config';

describe('getServerConfig', () => {
  it('uses defaults and trims trailing slash from COUCHDB_URL', () => {
    const config = getServerConfig({ COUCHDB_URL: 'http://127.0.0.1:5984/' });
    expect(config.couch.url).toBe('http://127.0.0.1:5984');
    expect(config.couch.database).toBe('coffee');
  });

  it('treats blank or whitespace-only secrets as undefined', () => {
    const config = getServerConfig({
      COUCHDB_USERNAME: '',
      COUCHDB_PASSWORD: '   ',
      BREWDIAL_API_TOKEN: ''
    });
    expect(config.couch.username).toBeUndefined();
    expect(config.couch.password).toBeUndefined();
    expect(config.apiToken).toBeUndefined();
  });
});

describe('getSafeConfigStatus', () => {
  it('exposes only boolean flags for username/password/token (no values)', () => {
    const config = getServerConfig({
      COUCHDB_USERNAME: 'admin',
      COUCHDB_PASSWORD: 'secret',
      BREWDIAL_API_TOKEN: 'tok'
    });
    const safe = getSafeConfigStatus(config);
    expect(safe).toEqual({
      couchdbUrl: 'http://127.0.0.1:5984',
      database: 'coffee',
      hasUsername: true,
      hasPassword: true,
      hasApiToken: true
    });
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain('admin');
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('tok');
  });

  it('strips URL userinfo from couchdbUrl', () => {
    const config = getServerConfig({
      COUCHDB_URL: 'http://admin:password@127.0.0.1:5984'
    });
    const safe = getSafeConfigStatus(config);
    expect(safe.couchdbUrl).toBe('http://127.0.0.1:5984');
    expect(safe.couchdbUrl).not.toContain('admin');
    expect(safe.couchdbUrl).not.toContain('password');
    expect(safe.couchdbUrl).not.toContain('@');
  });

  it('preserves a normal URL without trailing slash', () => {
    const config = getServerConfig({
      COUCHDB_URL: 'http://127.0.0.1:5984/'
    });
    const safe = getSafeConfigStatus(config);
    expect(safe.couchdbUrl).toBe('http://127.0.0.1:5984');
  });
});
