import { describe, it, expect } from 'vitest';
import { insertRow, selectRows, SupabaseError, updateRows } from './supabase.js';
import type { SupabaseConfig } from './config.js';

const config: SupabaseConfig = { url: 'https://proj.supabase.co', serviceRoleKey: 'svc-key' };

interface Call {
  url: string;
  init: RequestInit & { headers?: Record<string, string> };
}

function fetchReturning(status: number, body: unknown, calls?: Call[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls?.push({ url: String(url), init: (init ?? {}) as Call['init'] });
    const text = body === undefined ? '' : JSON.stringify(body);
    return new Response(text, { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

describe('selectRows', () => {
  it('GETs the table with auth headers and returns rows', async () => {
    const calls: Call[] = [];
    const rows = await selectRows(
      config,
      'recipes',
      'status=eq.active&limit=2',
      fetchReturning(200, [{ code: 'COF-0001' }, { code: 'COF-0002' }], calls)
    );
    expect(rows).toHaveLength(2);
    expect(calls[0].url).toBe('https://proj.supabase.co/rest/v1/recipes?status=eq.active&limit=2');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.headers?.apikey).toBe('svc-key');
    expect(calls[0].init.headers?.Authorization).toBe('Bearer svc-key');
  });

  it('returns [] for an empty body', async () => {
    const rows = await selectRows(config, 'recipes', '', fetchReturning(200, undefined));
    expect(rows).toEqual([]);
  });
});

describe('insertRow', () => {
  it('POSTs with return=representation and returns the first row', async () => {
    const calls: Call[] = [];
    const row = await insertRow(
      config,
      'recipes',
      { title: 'x' },
      'code',
      fetchReturning(201, [{ code: 'COF-0003', title: 'x' }], calls)
    );
    expect(row).toEqual({ code: 'COF-0003', title: 'x' });
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers?.Prefer).toBe('return=representation');
    expect(calls[0].url).toContain('/rest/v1/recipes?select=code');
  });
});

describe('updateRows', () => {
  it('PATCHes matching rows and returns them', async () => {
    const calls: Call[] = [];
    const rows = await updateRows(
      config,
      'recipes',
      'code=eq.COF-0001',
      { status: 'archived' },
      'code,status',
      fetchReturning(200, [{ code: 'COF-0001', status: 'archived' }], calls)
    );
    expect(rows[0]).toEqual({ code: 'COF-0001', status: 'archived' });
    expect(calls[0].init.method).toBe('PATCH');
    expect(calls[0].url).toContain('code=eq.COF-0001');
  });
});

describe('errors', () => {
  it('throws SupabaseError on a 4xx response', async () => {
    await expect(
      selectRows(config, 'recipes', '', fetchReturning(403, { message: 'denied' }))
    ).rejects.toBeInstanceOf(SupabaseError);
  });
});
