import { describe, it, expect, vi, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createBrewdialMcpServer } from './server.js';
import { handleListGrinders } from './tools.js';
import type { ApiConfig } from './config.js';

// Wrap the real handler so one test can make it throw; the rest pass through.
vi.mock('./tools.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tools.js')>();
  return { ...actual, handleListGrinders: vi.fn(actual.handleListGrinders) };
});

const EXPECTED_ANNOTATIONS: Record<string, { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint: boolean }> = {
  find_bean: { readOnlyHint: true, openWorldHint: false },
  list_beans: { readOnlyHint: true, openWorldHint: false },
  list_grinders: { readOnlyHint: true, openWorldHint: false },
  list_drippers: { readOnlyHint: true, openWorldHint: false },
  get_recent_context: { readOnlyHint: true, openWorldHint: false },
  get_recipe_context: { readOnlyHint: true, openWorldHint: false },
  create_recipe: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  create_feedback: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  update_recipe: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  archive_recipe: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  supersede_recipe: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  update_bean_attributes: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  update_preferences: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
};

const baseConfig: ApiConfig = {
  baseUrl: 'https://api.brewdial.example.com',
  agentToken: 'test-agent-token',
};

async function connect(api: ApiConfig, opts?: Parameters<typeof createBrewdialMcpServer>[1]) {
  const server = createBrewdialMcpServer(api, opts);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(handleListGrinders).mockClear();
});

describe('createBrewdialMcpServer', () => {
  it('lists exactly the 13 snake_case tools', async () => {
    const { client } = await connect(baseConfig);
    const { tools } = await client.listTools();

    expect(tools).toHaveLength(13);
    expect(tools.map((t) => t.name).sort()).toEqual(Object.keys(EXPECTED_ANNOTATIONS).sort());
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
    }
  });

  it('gives every tool a title and the annotations from the contract table', async () => {
    const { client } = await connect(baseConfig);
    const { tools } = await client.listTools();

    for (const tool of tools) {
      expect(typeof tool.title).toBe('string');
      expect(tool.title!.length).toBeGreaterThan(0);
      expect(tool.annotations, tool.name).toEqual(EXPECTED_ANNOTATIONS[tool.name]);
    }
  });

  it('routes every API call through api.fetchImpl instead of global fetch', async () => {
    const globalSpy = vi.fn(() => {
      throw new Error('global fetch must not be used');
    });
    vi.stubGlobal('fetch', globalSpy);

    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const { client } = await connect({ ...baseConfig, fetchImpl });
    const result = await client.callTool({ name: 'list_grinders', arguments: {} });

    expect(result.isError).not.toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.startsWith(baseConfig.baseUrl)).toBe(true);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${baseConfig.agentToken}`);
    expect(globalSpy).not.toHaveBeenCalled();
  });

  it('documents and forwards structured xBloom recipe fields', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if ((init?.method ?? 'GET') === 'GET') return new Response('[]', { status: 200 });
      return new Response(JSON.stringify({
        id: 'recipe:COF-1234', code: 'COF-1234', method: 'other', title: 'xBloom', version: 1,
        params: { bypass: { waterG: 40, tempC: 30 } }, steps: [{ note: 'Pour', pattern: 'spiral', rpm: 100, vibrationBefore: true, vibrationAfter: false, pauseSec: 10, tempC: 92 }],
        bean_id: null, bean_snapshot: null, intent: null, notes: null, adjustment_from_previous: null,
        created_by: 'agent', status: 'active', supersedes: null, superseded_by: null, parent_code: null,
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z'
      }), { status: 201, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const { client } = await connect({ ...baseConfig, fetchImpl });
    const args = {
      method: 'other', title: 'xBloom', params: { bypass: { waterG: 40, tempC: 30 } },
      steps: [{ note: 'Pour', pattern: 'spiral', rpm: 100, vibrationBefore: true, vibrationAfter: false, pauseSec: 10, tempC: 92 }]
    };
    const result = await client.callTool({ name: 'create_recipe', arguments: args });
    expect(result.isError).not.toBe(true);
    const body = JSON.parse(String(calls.find((c) => c.init.method === 'POST')!.init.body));
    expect(body.params).toEqual(args.params);
    expect(body.steps).toEqual(args.steps);
    const { tools } = await client.listTools();
    const create = tools.find((tool) => tool.name === 'create_recipe')!;
    const schema = create.inputSchema as unknown as {
      properties: Record<string, { description?: string; items?: { properties?: Record<string, unknown> }; properties?: Record<string, unknown> }>;
    };
    expect(schema.properties.steps.items?.properties).toHaveProperty('vibrationBefore');
    expect(schema.properties.params.properties).toHaveProperty('bypass');
    expect(schema.properties.steps.description).toContain('최대 9회');
    expect(schema.properties.steps.items?.properties?.rpm).toMatchObject({
      description: expect.stringContaining('첫 붓기의 값을 전체 추출에 적용')
    });
    expect(schema.properties.steps.items?.properties?.pauseSec).toMatchObject({ maximum: 127 });
    expect(schema.properties.params.properties?.bypass).toMatchObject({
      description: expect.stringContaining('범위 밖 값을 거부'),
      properties: { waterG: { minimum: 5, maximum: 100 } }
    });
    expect(create.description).toContain('범위 밖 값은 BrewDial이 거부하며');
    expect(create.description).toContain('note 태그를 대체');
    const update = tools.find((tool) => tool.name === 'update_recipe')!;
    expect(update.description).toContain('첫 붓기의 값을 전체 추출에 적용');
  });

  it('reports a thrown handler error once through onToolError, then surfaces it as an error', async () => {
    const onToolError = vi.fn();
    const { client } = await connect(baseConfig, { onToolError });
    vi.mocked(handleListGrinders).mockRejectedValueOnce(new Error('boom'));

    await expect(client.callTool({ name: 'list_grinders', arguments: {} })).rejects.toThrow();

    expect(onToolError).toHaveBeenCalledTimes(1);
    expect(onToolError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onToolError.mock.calls[0][1]).toBe('list_grinders');
  });

  it('returns isError for an unknown tool name', async () => {
    const onToolError = vi.fn();
    const { client } = await connect(baseConfig, { onToolError });

    const result = await client.callTool({ name: 'no_such_tool', arguments: {} });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: 'Unknown tool: no_such_tool' }]);
    expect(onToolError).not.toHaveBeenCalled();
  });
});
