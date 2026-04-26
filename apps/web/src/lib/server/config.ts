export interface CouchConfig {
  url: string;
  database: string;
  username?: string;
  password?: string;
}

export interface BrewDialServerConfig {
  couch: CouchConfig;
  apiToken?: string;
}

export interface SafeConfigStatus {
  couchdbUrl: string;
  database: string;
  hasUsername: boolean;
  hasPassword: boolean;
  hasApiToken: boolean;
}

const DEFAULT_COUCHDB_URL = 'http://127.0.0.1:5984';
const DEFAULT_COUCHDB_DATABASE = 'coffee';

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export function getServerConfig(env: Record<string, string | undefined>): BrewDialServerConfig {
  const url = trimTrailingSlash(nonEmpty(env.COUCHDB_URL) ?? DEFAULT_COUCHDB_URL);
  const database = nonEmpty(env.COUCHDB_DATABASE) ?? DEFAULT_COUCHDB_DATABASE;
  const username = nonEmpty(env.COUCHDB_USERNAME);
  const password = nonEmpty(env.COUCHDB_PASSWORD);
  const apiToken = nonEmpty(env.BREWDIAL_API_TOKEN);
  return {
    couch: { url, database, username, password },
    apiToken
  };
}

export function getSafeConfigStatus(config: BrewDialServerConfig): SafeConfigStatus {
  return {
    couchdbUrl: config.couch.url,
    database: config.couch.database,
    hasUsername: Boolean(config.couch.username),
    hasPassword: Boolean(config.couch.password),
    hasApiToken: Boolean(config.apiToken)
  };
}
