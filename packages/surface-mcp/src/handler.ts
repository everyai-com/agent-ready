import {
  ConfirmationGate,
  deriveTools as coreDeriveTools,
  executeWithConfirmation,
  toolRequiresConfirmation,
  type BackendAdapter,
  type Identity,
  type Manifest,
  type ToolDefinition,
  type ToolResult,
} from '@agent-ready/core';
import { buildStructuredContent, renderResultMarkdown } from '@agent-ready/surface-ui';

const PROTOCOL_VERSION = '2025-03-26';
const SERVER_NAME = 'agent-ready-gateway';
const SERVER_VERSION = '0.1.0';
const CONFIRM_PREFIX = 'confirm_';

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
  /**
   * HMAC secret for signing confirmation tokens (see docs/confirmations.md).
   * Falls back to a random per-instance secret, which is fine for a single
   * Worker isolate but means tokens do not verify across isolates/restarts —
   * pass a stable Worker secret for multi-isolate deployments.
   */
  confirmSecret?: string;
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

function errorResult(id: string | number | null, text: string) {
  return jsonResponse(
    rpcResult(id, {
      content: [{ type: 'text', text }],
      isError: true,
    }),
  );
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
  outputSchema: ToolDefinition['outputSchema'];
}

function toWireTool(tool: ToolDefinition): McpToolSchema {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
  };
}

/** The synthetic `confirm_<tool>` tool def for a confirmation-required capability. */
function confirmToolFor(tool: ToolDefinition): McpToolSchema {
  return {
    name: `${CONFIRM_PREFIX}${tool.name}`,
    description: `Confirm and execute the pending "${tool.name}" call from a confirmation token returned by ${tool.name}.`,
    inputSchema: {
      type: 'object',
      properties: {
        confirmationToken: {
          type: 'string',
          description: 'The confirmationToken returned by the preview call.',
        },
      },
      required: ['confirmationToken'],
      additionalProperties: false,
    },
    outputSchema: tool.outputSchema,
  };
}

/** Human, boring, unambiguous preview text for a pending write (host-ui-plan §2.2.3). */
function renderPreviewMarkdown(tool: ToolDefinition, input: Record<string, unknown>): string {
  const verbLabel = tool.verb === 'create' ? 'create' : 'update';
  const values = (input.values ?? {}) as Record<string, unknown>;
  const fieldLines = Object.entries(values).map(([k, v]) => `- **${k}:** ${JSON.stringify(v)}`);
  const idLine = tool.verb === 'update' && input.id ? `\n- **id:** ${JSON.stringify(input.id)}` : '';
  const fields = fieldLines.length > 0 ? `\n${fieldLines.join('\n')}${idLine}` : '';
  return `You are about to ${verbLabel} a **${tool.resource}** record:${fields}\n\nCall \`${CONFIRM_PREFIX}${tool.name}\` with the \`confirmationToken\` below to proceed. This does not execute until confirmed.`;
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
 *
 * Confirmation gate: `requiresConfirmation` capabilities never execute on
 * the first `tools/call` — see docs/confirmations.md. The gate itself
 * (`executeWithConfirmation`) lives in `@agent-ready/core` so this surface
 * and `@agent-ready/console` share exactly one enforcement path.
 */
export function createMcpHandler(
  options: CreateMcpHandlerOptions,
): (request: Request) => Promise<Response> {
  const { manifest, adapter, apiKeys } = options;
  const deriveTools = options.deriveTools ?? coreDeriveTools;
  const gate = new ConfirmationGate(options.confirmSecret);

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
          const tools = deriveTools(manifest);
          const wireTools: McpToolSchema[] = [];
          for (const tool of tools) {
            wireTools.push(toWireTool(tool));
            if (toolRequiresConfirmation(manifest, tool.resource, tool.verb)) {
              wireTools.push(confirmToolFor(tool));
            }
          }
          return jsonResponse(rpcResult(id, { tools: wireTools }));
        }

        case 'tools/call': {
          const params = (body.params ?? {}) as { name?: string; arguments?: unknown };
          const toolName = params.name;
          if (!toolName || typeof toolName !== 'string') {
            return jsonResponse(rpcError(id, ErrorCodes.INVALID_PARAMS, 'Missing required param: name'));
          }
          const args = (params.arguments ?? {}) as Record<string, unknown>;

          const tools = deriveTools(manifest);

          // --- confirm_<tool>: verify token, then execute the ORIGINAL call ---
          if (toolName.startsWith(CONFIRM_PREFIX)) {
            const baseName = toolName.slice(CONFIRM_PREFIX.length);
            const baseTool = tools.find((t) => t.name === baseName);
            if (!baseTool || !toolRequiresConfirmation(manifest, baseTool.resource, baseTool.verb)) {
              return errorResult(id, `Unknown or disabled tool: ${toolName}`);
            }
            const token = args.confirmationToken;
            if (typeof token !== 'string' || token.length === 0) {
              return errorResult(id, 'Missing required argument: confirmationToken');
            }
            const verified = await gate.verify(token, baseTool.name);
            if (!verified.ok) {
              return errorResult(id, `Could not complete ${baseTool.name}: ${verified.error}`);
            }

            try {
              const result: ToolResult = await executeWithConfirmation(
                adapter,
                baseTool,
                { resource: baseTool.resource, verb: baseTool.verb, input: verified.input },
                manifest,
                { ...identity, confirmed: true },
              );
              return jsonResponse(
                rpcResult(id, {
                  content: [{ type: 'text', text: renderResultMarkdown(baseTool, result) }],
                  structuredContent: buildStructuredContent(baseTool, result),
                  isError: !result.ok,
                }),
              );
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              return errorResult(id, `Tool call failed: ${message}`);
            }
          }

          // Only tools derived from *enabled* capabilities exist here, so an
          // unknown name is either a typo or a disabled/locked capability —
          // either way it is refused before any adapter call is made.
          const tool = tools.find((t) => t.name === toolName);
          if (!tool) {
            return errorResult(id, `Unknown or disabled tool: ${toolName}`);
          }

          // --- write requiring confirmation: preview only, never execute ---
          if (toolRequiresConfirmation(manifest, tool.resource, tool.verb)) {
            const token = await gate.issueToken(tool.name, args);
            return jsonResponse(
              rpcResult(id, {
                content: [{ type: 'text', text: renderPreviewMarkdown(tool, args) }],
                structuredContent: { preview: args, confirmationToken: token },
                isError: false,
              }),
            );
          }

          try {
            const result: ToolResult = await executeWithConfirmation(
              adapter,
              tool,
              { resource: tool.resource, verb: tool.verb, input: args },
              manifest,
              identity,
            );
            return jsonResponse(
              rpcResult(id, {
                content: [{ type: 'text', text: renderResultMarkdown(tool, result) }],
                structuredContent: buildStructuredContent(tool, result),
                isError: !result.ok,
              }),
            );
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return errorResult(id, `Tool call failed: ${message}`);
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
