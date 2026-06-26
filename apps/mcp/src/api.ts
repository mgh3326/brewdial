// Thin HTTP API client for the BrewDial MCP server.
// Talks to the OCI backend's agent surface (https://api.brewdial.robinco.dev)
// using a Bearer AGENT_TOKEN. Injectable fetchImpl keeps repos testable with a
// mock fetch and no network dependency.

import type { ApiConfig } from './config.js';

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `API request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

function apiUrl(config: ApiConfig, path: string): string {
  const base = config.baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

function authHeaders(
  config: ApiConfig,
  extra?: Record<string, string>
): Record<string, string> {
  return {
    Authorization: `Bearer ${config.agentToken}`,
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
  config: ApiConfig,
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
  fetchImpl: typeof fetch = fetch
): Promise<T> {
  const { headers: extraHeaders, ...rest } = init;
  const response = await fetchImpl(apiUrl(config, path), {
    ...rest,
    headers: authHeaders(config, extraHeaders),
  });
  const body = await parseBody(response);
  if (response.status >= 400) throw new ApiError(response.status, body);
  return body as T;
}

/** GET <path>[?<query>]. Returns the parsed JSON body. */
export async function getJson<T>(
  config: ApiConfig,
  path: string,
  query = '',
  fetchImpl: typeof fetch = fetch
): Promise<T> {
  const url = query ? `${path}?${query}` : path;
  return request<T>(config, url, { method: 'GET' }, fetchImpl);
}

/** POST <path> with a JSON body. Returns the parsed response. */
export async function postJson<T>(
  config: ApiConfig,
  path: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch
): Promise<T> {
  return request<T>(config, path, { method: 'POST', body: JSON.stringify(body) }, fetchImpl);
}

/** PATCH <path> with a JSON body. Returns the parsed response. */
export async function patchJson<T>(
  config: ApiConfig,
  path: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch
): Promise<T> {
  return request<T>(config, path, { method: 'PATCH', body: JSON.stringify(body) }, fetchImpl);
}
