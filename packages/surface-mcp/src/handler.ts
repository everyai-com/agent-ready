import {
  deriveTools as coreDeriveTools,
  type BackendAdapter,
  type Identity,
  type Manifest,
  type ToolDefinition,
  type ToolResult,
} from '@agent-ready/core';

const PROTOCOL_VERSION = '2025-03-26';
const SERVER_NAME = 'agent-ready-gateway';
const SERVER_VERSION = '0.1.0';

export interface CreateMcpHandlerOptions {
  manifest: Manifest;
  adapter: BackendAdapter;
  /**
   * Bearer tokens accepted on `Authorization: Bearer <token>`. Each entry
   * may be a plain string (any identity) or `{ token, identity }` to bind
   * a token to a specific caller identity passed through to the adapter.
   * When omitted, the handler performs no auth.
   */
  apiKeys?: Array<string | { token: string; identity?: Identity }>;
  /**
   * Override for @agent-ready/core's `deriveTools`. Defaults to the real
   * implementation exported by core. Injectable primarily for tests.
   */
  deriveTools?: (manifest: Manifest) => ToolDefinition[];
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: string | number | null;
  result: unknown;
}

interface JsonRpcError {
  jsonrpc: '2.0';
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

const ErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcError {
  return { jsonrpc: '2.0', id, error: { code, message, data } };
}

function rpcResult(id: string | number | null, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result };
}

/**
 * The MCP `tools/list` wire shape: only the agent-facing fields. Core's
 * `ToolDefinition` additionally carries `resource`/`verb` for the executor;
 * those are internal and not sent to the agent.
 */
interface McpToolSchema {
  name: string;
  description: string;
  inputSchema: ToolDefinition['inputSchema'];
}

function toWireTool(tool: ToolDefinition): McpToolSchema {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  };
}

/**
 * Creates a web-standard fetch handler implementing an MCP server over
 * Streamable HTTP (JSON-RPC 2.0 via POST). Runs unmodified on Cloudflare
 * Workers, Vercel Edge/Node functions, or any Node 18+ `fetch`-shaped
 * server.
 *
 * Implementation choice: this handles the JSON-RPC envelope directly
 * rather than depending on `@modelcontextprotocol/sdk`. The SDK's
 * transport layer assumes a long-lived server process (stdio or an
 * Express-style app with session state); the minimal request/response
 * surface MCP actually needs here — initialize, tools/list, tools/call —
 * is a few dozen lines, and hand-rolling it keeps this package
 * dependency-free and trivially portable to edge runtimes (Workers in
 * particular have no `node:http` and awkward support for long-lived SDK
 * transports). If a future need arises for resources/prompts/sampling or
 * SSE streaming, revisit adopting the SDK's server class directly.
 */
export function createMcpHandler(
  options: CreateMcpHandlerOptions,
): (request: Request) => Promise<Response> {
  const { manifest, adapter, apiKeys } = options;
  const deriveTools = options.deriveTools ?? coreDeriveTools;

  function authenticate(request: Request): { ok: true; identity?: Identity } | { ok: false } {
    if (!apiKeys || apiKeys.length === 0) return { ok: true };

    const header = request.headers.get('authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match) return { ok: false };
    const token = match[1];

    for (const entry of apiKeys) {
      if (typeof entry === 'string') {
        if (entry === token) return { ok: true };
      } else if (entry.token === token) {
        return { ok: true, identity: entry.identity };
      }
    }
    return { ok: false };
  }

  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method Not Allowed. POST JSON-RPC requests to this endpoint.' }, 405);
    }

    const auth = authenticate(request);
    if (!auth.ok) {
      return jsonResponse(
        rpcError(null, ErrorCodes.INVALID_REQUEST, 'Unauthorized: missing or invalid bearer token'),
        401,
      );
    }
    const identity: Identity = auth.identity ?? {};

    let body: JsonRpcRequest;
    try {
      body = (await request.json()) as JsonRpcRequest;
    } catch {
      return jsonResponse(rpcError(null, ErrorCodes.PARSE_ERROR, 'Invalid JSON'), 400);
    }

    if (!body || typeof body !== 'object' || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
      return jsonResponse(
        rpcError(typeof body?.id !== 'undefined' ? body.id ?? null : null, ErrorCodes.INVALID_REQUEST, 'Invalid JSON-RPC 2.0 request'),
        400,
      );
    }

    const id = body.id ?? null;

    try {
      switch (body.method) {
        case 'initialize': {
          return jsonResponse(
            rpcResult(id, {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: { tools: {} },
              serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
            }),
          );
        }

        case 'notifications/initialized':
        case 'initialized': {
          // Notification: no id expected, no body required in response.
          return new Response(null, { status: 202 });
        }

        case 'tools/list': {
          const tools = deriveTools(manifest).map(toWireTool);
          return jsonResponse(rpcResult(id, { tools }));
        }

        case 'tools/call': {
          const params = (body.params ?? {}) as { name?: string; arguments?: unknown };
          const toolName = params.name;
          if (!toolName || typeof toolName !== 'string') {
            return jsonResponse(rpcError(id, ErrorCodes.INVALID_PARAMS, 'Missing required param: name'));
          }

          // Only tools derived from *enabled* capabilities exist here, so an
          // unknown name is either a typo or a disabled/locked capability —
          // either way it is refused before any adapter call is made.
          const tools = deriveTools(manifest);
          const tool = tools.find((t) => t.name === toolName);
          if (!tool) {
            return jsonResponse(
              rpcResult(id, {
                content: [{ type: 'text', text: `Unknown or disabled tool: ${toolName}` }],
                isError: true,
              }),
            );
          }

          try {
            const result: ToolResult = await adapter.execute(
              {
                resource: tool.resource,
                verb: tool.verb,
                input: (params.arguments ?? {}) as Record<string, unknown>,
              },
              manifest,
              identity,
            );
            if (!result.ok) {
              return jsonResponse(
                rpcResult(id, {
                  content: [{ type: 'text', text: `Tool call failed: ${result.error ?? 'unknown error'}` }],
                  isError: true,
                }),
              );
            }
            return jsonResponse(
              rpcResult(id, {
                content: [{ type: 'text', text: JSON.stringify(result.rows ?? []) }],
                isError: false,
              }),
            );
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return jsonResponse(
              rpcResult(id, {
                content: [{ type: 'text', text: `Tool call failed: ${message}` }],
                isError: true,
              }),
            );
          }
        }

        default:
          return jsonResponse(rpcError(id, ErrorCodes.METHOD_NOT_FOUND, `Unknown method: ${body.method}`));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return jsonResponse(rpcError(id, ErrorCodes.INTERNAL_ERROR, message), 500);
    }
  };
}
