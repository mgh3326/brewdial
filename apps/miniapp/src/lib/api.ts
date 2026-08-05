// HTTP API client for the BrewDial backend (https://api.brewdial.robinco.dev).
//
// Base URL resolution order:
//   1. Runtime override via setApiBaseUrl() — Task 5 injects the .ait-resolved URL.
//   2. import.meta.env.VITE_API_BASE_URL  — set at build / dev time.
//   3. Placeholder ('https://placeholder.brewdial.invalid') — keeps the WebView alive
//      at module load so we never black-screen on missing env.

import type { Identity } from './identity';
import { localizeMessage } from './labels.js';

// ── Base URL ──────────────────────────────────────────────────────────────────

let _baseUrl: string | null = null;

/**
 * Normalize a base URL: strip surrounding whitespace (env vars set in a
 * dashboard often pick up a trailing space → `https://host /beans` →
 * `host%20/beans` → "Failed to fetch") and drop any trailing slash so the
 * `${base}${path}` join stays clean.
 */
function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** Override the base URL at runtime (used by Task 5 for .ait environment). */
export function setApiBaseUrl(url: string): void {
  _baseUrl = normalizeBase(url);
}

/** Returns the current base URL (runtime override → env var → placeholder). */
export function getApiBaseUrl(): string {
  if (_baseUrl) return _baseUrl;
  const env = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (env && env.trim()) return normalizeBase(env);
  console.warn('[brewdial] VITE_API_BASE_URL is not set; using placeholder base URL');
  return 'https://placeholder.brewdial.invalid';
}

// ── Error helpers ─────────────────────────────────────────────────────────────

/**
 * Error thrown on non-2xx HTTP responses.
 * `.message` is already localized to Korean via localizeMessage() so every
 * UI catch site can display it directly.
 * `.rawMessage` preserves the original English / body text for logging.
 *   - 401 → '권한이 없어요. 잠시 후 다시 시도해 주세요.'
 *   - network → '네트워크 연결을 확인해 주세요.'
 *   - other  → '문제가 발생했어요. 잠시 후 다시 시도해 주세요.'
 */
export class ApiError extends Error {
  public readonly rawMessage: string;
  constructor(
    public readonly status: number,
    rawText: string,
  ) {
    const localized = localizeMessage(rawText);
    super(localized);
    this.rawMessage = rawText;
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

/**
 * GET `${base}${path}` → parsed JSON of type T, or **null** on 404.
 * All other non-2xx responses are re-thrown as `ApiError` (same as `apiGet`).
 * Use this for single-resource lookups where a missing resource is a valid
 * outcome (e.g. getRecipeByCode, getBean).
 */
export async function apiGetOrNull<T>(path: string, opts?: RequestOpts): Promise<T | null> {
  try {
    return await request<T>('GET', path, undefined, opts);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
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
