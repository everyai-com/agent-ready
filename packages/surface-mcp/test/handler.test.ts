import { describe, expect, it } from 'vitest';
import { createMcpHandler } from '../src/handler.js';
import type {
  BackendAdapter,
  Identity,
  Manifest,
  ToolCall,
  ToolResult,
} from '@agent-ready/core';

const manifest: Manifest = {
  version: 'v0',
  app: { name: 'plantshop', backend: 'supabase' },
  resources: [
    {
      name: 'plants',
      label: 'Plants',
      fields: [
        { name: 'id', type: 'string' },
        { name: 'name', type: 'string' },
      ],
    },
    {
      name: 'orders',
      label: 'Orders',
      fields: [
        { name: 'id', type: 'string' },
        { name: 'plant_id', type: 'string' },
      ],
    },
  ],
  capabilities: {
    plants: [
      { verb: 'read', enabled: true, exposedFields: ['id', 'name'] },
      // Disabled: must never surface as a tool nor be executable.
      { verb: 'create', enabled: false, exposedFields: [] },
    ],
    orders: [{ verb: 'read', enabled: true, exposedFields: ['id', 'plant_id'] }],
  },
};

class FakeAdapter implements BackendAdapter {
  calls: ToolCall[] = [];

  async introspect() {
    return { backend: 'fake', tables: [] };
  }

  async execute(call: ToolCall, _manifest: Manifest, _identity: Identity): Promise<ToolResult> {
    this.calls.push(call);
    if (call.resource === 'plants' && call.verb === 'read') {
      return { ok: true, rows: [{ id: '1', name: 'Monstera' }] };
    }
    if (call.resource === 'orders' && call.verb === 'read') {
      // Adapter-level denial (e.g. an RLS policy blocked the row).
      return { ok: false, error: 'denied: RLS policy blocked this row' };
    }
    throw new Error(`no such tool: ${call.verb}_${call.resource}`);
  }
}

function post(handler: (r: Request) => Promise<Response>, body: unknown, headers: Record<string, string> = {}) {
  return handler(
    new Request('https://gateway.example/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );
}

describe('createMcpHandler', () => {
  it('handles the initialize handshake', async () => {
    const handler = createMcpHandler({ manifest, adapter: new FakeAdapter() });
    const res = await post(handler, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.serverInfo.name).toBeTruthy();
    expect(body.result.protocolVersion).toBeTruthy();
    expect(body.result.capabilities).toHaveProperty('tools');
  });

  it('tools/list reflects only enabled capabilities', async () => {
    const handler = createMcpHandler({ manifest, adapter: new FakeAdapter() });
    const res = await post(handler, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const body = await res.json();
    const names = body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain('get_plants');
    expect(names).toContain('get_orders');
    expect(names).not.toContain('create_plants');
    expect(names).toHaveLength(2);
  });

  it('tools/list exposes only agent-facing fields (no internal resource/verb)', async () => {
    const handler = createMcpHandler({ manifest, adapter: new FakeAdapter() });
    const res = await post(handler, { jsonrpc: '2.0', id: 22, method: 'tools/list' });
    const body = await res.json();
    const tool = body.result.tools[0];
    expect(tool).toHaveProperty('name');
    expect(tool).toHaveProperty('description');
    expect(tool).toHaveProperty('inputSchema');
    expect(tool).not.toHaveProperty('resource');
    expect(tool).not.toHaveProperty('verb');
  });

  it('tools/call happy path dispatches to the adapter', async () => {
    const adapter = new FakeAdapter();
    const handler = createMcpHandler({ manifest, adapter });
    const res = await post(handler, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'get_plants', arguments: { limit: 10 } },
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.result.isError).toBe(false);
    expect(body.result.content[0].text).toContain('Monstera');
    expect(adapter.calls).toEqual([{ resource: 'plants', verb: 'read', input: { limit: 10 } }]);
  });

  it('tools/call surfaces an adapter denial (ok:false) as an MCP error result, not an HTTP error', async () => {
    const handler = createMcpHandler({ manifest, adapter: new FakeAdapter() });
    const res = await post(handler, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'get_orders', arguments: {} },
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('denied');
  });

  it('tools/call rejects unknown or disabled tools before touching the adapter', async () => {
    const adapter = new FakeAdapter();
    const handler = createMcpHandler({ manifest, adapter });
    const res = await post(handler, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'create_plants', arguments: {} },
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('Unknown or disabled tool');
    // The disabled capability must never reach the adapter.
    expect(adapter.calls).toHaveLength(0);
  });

  it('rejects requests missing a bearer token when apiKeys is set', async () => {
    const handler = createMcpHandler({ manifest, adapter: new FakeAdapter(), apiKeys: ['secret-key'] });
    const res = await post(handler, { jsonrpc: '2.0', id: 6, method: 'tools/list' });
    expect(res.status).toBe(401);
  });

  it('rejects requests with an invalid bearer token', async () => {
    const handler = createMcpHandler({ manifest, adapter: new FakeAdapter(), apiKeys: ['secret-key'] });
    const res = await post(handler, { jsonrpc: '2.0', id: 7, method: 'tools/list' }, { authorization: 'Bearer wrong' });
    expect(res.status).toBe(401);
  });

  it('accepts requests with a valid bearer token', async () => {
    const handler = createMcpHandler({ manifest, adapter: new FakeAdapter(), apiKeys: ['secret-key'] });
    const res = await post(
      handler,
      { jsonrpc: '2.0', id: 8, method: 'tools/list' },
      { authorization: 'Bearer secret-key' },
    );
    expect(res.status).toBe(200);
  });

  it('threads bound identity from a keyed apiKey entry through to the adapter', async () => {
    const adapter = new FakeAdapter();
    let seenIdentity: unknown;
    const originalExecute = adapter.execute.bind(adapter);
    adapter.execute = (call, m, identity) => {
      seenIdentity = identity;
      return originalExecute(call, m, identity);
    };
    const handler = createMcpHandler({
      manifest,
      adapter,
      apiKeys: [{ token: 'user-1-key', identity: { agentId: 'user-1' } }],
    });
    await post(
      handler,
      { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'get_plants', arguments: {} } },
      { authorization: 'Bearer user-1-key' },
    );
    expect(seenIdentity).toEqual({ agentId: 'user-1' });
  });

  it('rejects malformed JSON-RPC bodies', async () => {
    const handler = createMcpHandler({ manifest, adapter: new FakeAdapter() });
    const res = await post(handler, { foo: 'bar' });
    expect(res.status).toBe(400);
  });

  it('rejects non-POST requests', async () => {
    const handler = createMcpHandler({ manifest, adapter: new FakeAdapter() });
    const res = await handler(new Request('https://gateway.example/mcp', { method: 'GET' }));
    expect(res.status).toBe(405);
  });
});
