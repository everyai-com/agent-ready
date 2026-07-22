/**
 * The two-step confirmation protocol (docs/host-ui-plan.md §2.4,
 * docs/confirmations.md). A write capability with `guardrails.
 * requiresConfirmation: true` must never execute on the first call: the
 * caller gets a preview + a single-use, short-TTL confirmation token, and
 * only a second call presenting that token executes the write.
 *
 * This module is the SHARED gate: both `@agent-ready/surface-mcp` and
 * `@agent-ready/console` call `executeWithConfirmation` instead of
 * `adapter.execute` directly, so the rule is enforced identically no matter
 * which surface a caller goes through. A surface cannot opt out of it by
 * calling the adapter itself, because there is exactly one code path that
 * performs the check.
 *
 * Token shape: base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload
 * over a per-instance or caller-supplied secret)). The payload embeds the
 * exact input the preview was issued for, so the confirm step re-executes
 * with server-verified values, never values re-supplied by the caller.
 *
 * Limitations, documented rather than hidden:
 *  - Single-use enforcement uses an in-memory `Set` of consumed nonces. This
 *    is correct for a single Worker isolate / single process. A
 *    multi-isolate or multi-instance deployment needs a shared store (KV,
 *    Durable Object, Redis) to make single-use hold across instances — until
 *    then a token could in principle be replayed once per isolate.
 *  - When no `confirmSecret` is supplied, a random per-instance secret is
 *    generated at construction. That's fine for a single Worker isolate
 *    (tokens are only ever verified by the isolate that issued them within
 *    the 5-minute TTL), but it means tokens do NOT verify across isolates or
 *    after a redeploy/restart. Pass an explicit `confirmSecret` (a Worker
 *    secret) for multi-isolate deployments.
 */

import type {
  BackendAdapter,
  CapabilityVerb,
  Identity,
  Manifest,
  ToolCall,
  ToolDefinition,
  ToolResult,
} from "./types.js";

const TOKEN_TTL_MS = 5 * 60 * 1000;

interface TokenPayload {
  tool: string;
  input: Record<string, unknown>;
  exp: number;
  nonce: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomHex(byteLength = 16): string {
  const arr = new Uint8Array(byteLength);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/**
 * Whether the manifest marks this tool's underlying capability as requiring
 * confirmation before it may execute.
 */
export function toolRequiresConfirmation(
  manifest: Manifest,
  resource: string,
  verb: CapabilityVerb,
): boolean {
  const caps = manifest.capabilities[resource] ?? [];
  const capability = caps.find((c) => c.verb === verb && c.enabled);
  return capability?.guardrails?.requiresConfirmation === true;
}

/**
 * Issues and verifies single-use, short-TTL confirmation tokens for the
 * two-step write protocol. One instance should be created per running
 * gateway (per Worker isolate) and shared between the MCP and console
 * surfaces so a token issued by one can be confirmed via the other.
 */
export class ConfirmationGate {
  private readonly keyPromise: Promise<CryptoKey>;
  private readonly usedNonces = new Set<string>();

  constructor(secret?: string) {
    this.keyPromise = importHmacKey(secret ?? randomHex(32));
  }

  /** Sign a preview of `input` for `toolName`, valid for 5 minutes, single-use. */
  async issueToken(toolName: string, input: Record<string, unknown>): Promise<string> {
    const key = await this.keyPromise;
    const payload: TokenPayload = {
      tool: toolName,
      input,
      exp: Date.now() + TOKEN_TTL_MS,
      nonce: randomHex(12),
    };
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
    const payloadB64 = toBase64Url(payloadBytes);
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
    const sigB64 = toBase64Url(new Uint8Array(sig));
    return `${payloadB64}.${sigB64}`;
  }

  /**
   * Verify signature, expiry, tool binding, and single-use, then consume the
   * token's nonce. On success returns the server-signed input to execute
   * with — never values supplied fresh by the caller.
   */
  async verify(
    token: string,
    expectedTool: string,
  ): Promise<{ ok: true; input: Record<string, unknown> } | { ok: false; error: string }> {
    const parts = token.split(".");
    if (parts.length !== 2) return { ok: false, error: "Malformed confirmation token." };
    const [payloadB64, sigB64] = parts;

    const key = await this.keyPromise;
    let sigValid: boolean;
    try {
      sigValid = await crypto.subtle.verify(
        "HMAC",
        key,
        fromBase64Url(sigB64).buffer as ArrayBuffer,
        new TextEncoder().encode(payloadB64).buffer as ArrayBuffer,
      );
    } catch {
      return { ok: false, error: "Malformed confirmation token." };
    }
    if (!sigValid) return { ok: false, error: "Invalid confirmation token." };

    let payload: TokenPayload;
    try {
      payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64)));
    } catch {
      return { ok: false, error: "Malformed confirmation token." };
    }

    if (payload.tool !== expectedTool) {
      return { ok: false, error: "Confirmation token does not match this tool." };
    }
    if (Date.now() > payload.exp) {
      return { ok: false, error: "Confirmation token has expired. Call the tool again to get a new one." };
    }
    if (this.usedNonces.has(payload.nonce)) {
      return { ok: false, error: "Confirmation token has already been used." };
    }

    this.usedNonces.add(payload.nonce);
    return { ok: true, input: payload.input };
  }
}

/**
 * The single shared execution gate. Every surface (MCP, console) MUST route
 * writes through this instead of calling `adapter.execute` directly, so
 * `requiresConfirmation` is enforced no matter which surface is used.
 *
 * `identity.confirmed` is an internal marker set only by a surface handler
 * after it has independently verified a `ConfirmationGate` token — it is
 * never derived from agent-supplied tool input.
 */
export async function executeWithConfirmation(
  adapter: BackendAdapter,
  tool: Pick<ToolDefinition, "resource" | "verb" | "name">,
  call: ToolCall,
  manifest: Manifest,
  identity: Identity,
): Promise<ToolResult> {
  if (toolRequiresConfirmation(manifest, tool.resource, tool.verb) && !identity.confirmed) {
    return {
      ok: false,
      error: `This action requires confirmation. Call ${tool.name} first to get a preview and confirmation token, then confirm it before it will execute.`,
    };
  }
  return adapter.execute(call, manifest, identity);
}
