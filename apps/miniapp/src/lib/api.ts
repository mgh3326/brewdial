// HTTP API client for the BrewDial backend (https://api.brewdial.robinco.dev).
//
// Base URL resolution order:
//   1. Runtime override via setApiBaseUrl() — Task 5 injects the .ait-resolved URL.
//   2. import.meta.env.VITE_API_BASE_URL  — set at build / dev time.
//   3. Placeholder ('https://placeholder.brewdial.invalid') — keeps the WebView alive
//      at module load so we never black-screen on missing env (mirrors supabase.ts).

import type { Identity } from './identity';

// ── Base URL ──────────────────────────────────────────────────────────────────

let _baseUrl: string | null = null;

/** Override the base URL at runtime (used by Task 5 for .ait environment). */
export function setApiBaseUrl(url: string): void {
  _baseUrl = url;
}

/** Returns the current base URL (runtime override → env var → placeholder). */
export function getApiBaseUrl(): string {
  if (_baseUrl) return _baseUrl;
  const env = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (env) return env;
  console.warn('[brewdial] VITE_API_BASE_URL is not set; using placeholder base URL');
  return 'https://placeholder.brewdial.invalid';
}

// ── Error helpers ─────────────────────────────────────────────────────────────

/**
 * Error thrown on non-2xx HTTP responses.
 * The message is phrased so localizeMessage() / dbError() in labels.ts map it
 * to a friendly Korean string:
 *   - 401 → 'permission denied' → '권한이 없어요…'
 *   - network → 'failed to fetch' → '네트워크 연결을 확인해 주세요.'
 *   - other  → generic 문제가 발생했어요.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function errorForStatus(status: number, bodyText: string): ApiError {
  if (status === 401) {
    // Matches localizeMessage 'permission' branch → '권한이 없어요…'
    return new ApiError(status, `permission denied: login required (${status})`);
  }
  if (status >= 500) {
    return new ApiError(status, bodyText || `server error (${status})`);
  }
  return new ApiError(status, bodyText || `request failed (${status})`);
}

// ── Core fetch wrapper ────────────────────────────────────────────────────────

interface RequestOpts {
  identity?: Identity;
}

function buildHeaders(sendJson: boolean, opts?: RequestOpts): HeadersInit {
  const headers: Record<string, string> = {};
  if (sendJson) headers['Content-Type'] = 'application/json';
  if (opts?.identity) {
    headers['X-BrewDial-Identity'] = `${opts.identity.provider}:${opts.identity.externalKey}`;
  }
  return headers;
}

async function parseResponse<T>(res: Response): Promise<T> {
  // 204 No Content or empty body → return undefined cast to T
  if (res.status === 204) return undefined as unknown as T;
  const text = await res.text();
  if (!text) return undefined as unknown as T;
  return JSON.parse(text) as T;
}

async function request<T>(
  method: string,
  path: string,
  body: unknown | undefined,
  opts?: RequestOpts,
): Promise<T> {
  const url = `${getApiBaseUrl()}${path}`;
  const hasBody = body !== undefined;
  const res = await fetch(url, {
    method,
    headers: buildHeaders(hasBody, opts),
    body: hasBody ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let bodyText = '';
    try {
      bodyText = await res.text();
    } catch {
      // ignore
    }
    throw errorForStatus(res.status, bodyText);
  }

  return parseResponse<T>(res);
}

// ── Public API ────────────────────────────────────────────────────────────────

/** GET `${base}${path}` → parsed JSON of type T. */
export function apiGet<T>(path: string, opts?: RequestOpts): Promise<T> {
  return request<T>('GET', path, undefined, opts);
}

/** POST / PUT / PATCH / DELETE with optional JSON body → parsed response of type T. */
export function apiSend<T>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  opts?: RequestOpts,
): Promise<T> {
  return request<T>(method, path, body, opts);
}
