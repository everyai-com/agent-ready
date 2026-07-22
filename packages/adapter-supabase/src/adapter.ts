/**
 * The Supabase backend adapter.
 *
 * Introspection reads the PostgREST OpenAPI document. Execution maps
 * capability-checked tool calls onto PostgREST REST queries over plain `fetch`:
 *
 *   - read/list  → GET  with `?select=<allow-listed cols>` and `limit`
 *   - create     → POST with a body of allow-listed columns
 *   - update     → PATCH with `?id=eq.<id>` and a body of allow-listed columns
 *
 * The adapter is the enforcement point for the safety model: it re-checks the
 * manifest on every call, never selects a column outside the capability's
 * `exposedFields`, caps rows at `maxRowsPerCall`, and refuses any verb whose
 * capability is not `enabled`. Rows are redacted again on the way out so the
 * agent can never receive a column the manifest did not allow.
 */

import {
  redactRows,
  type BackendAdapter,
  type Capability,
  type Identity,
  type Introspection,
  type Manifest,
  type ToolCall,
  type ToolResult,
} from "@agent-ready/core";
import { parseSwagger, type PostgrestSwagger } from "./swagger.js";

/** Configuration for a Supabase adapter instance. */
export interface SupabaseAdapterOptions {
  /** Project URL, e.g. `https://abc.supabase.co`. No trailing slash required. */
  url: string;
  /** Service key (or anon key) used as apikey + bearer for PostgREST. */
  serviceKey: string;
  /** Optional app slug carried into the drafted manifest. */
  appName?: string;
  /**
   * Injectable fetch, primarily for tests. Defaults to the global `fetch`
   * (Node 18+ / 22 has it built in).
   */
  fetchImpl?: typeof fetch;
}

export class SupabaseAdapter implements BackendAdapter {
  private readonly baseUrl: string;
  private readonly serviceKey: string;
  private readonly appName?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: SupabaseAdapterOptions) {
    this.baseUrl = opts.url.replace(/\/+$/, "");
    this.serviceKey = opts.serviceKey;
    this.appName = opts.appName;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      apikey: this.serviceKey,
      Authorization: `Bearer ${this.serviceKey}`,
      ...extra,
    };
  }

  private restUrl(path = ""): string {
    return `${this.baseUrl}/rest/v1${path}`;
  }

  /** Fetch and parse the PostgREST OpenAPI document. */
  async introspect(): Promise<Introspection> {
    const res = await this.fetchImpl(this.restUrl("/"), {
      headers: this.headers({ Accept: "application/openapi+json" }),
    });
    if (!res.ok) {
      throw new Error(
        `Supabase introspection failed: ${res.status} ${res.statusText}`,
      );
    }
    const swagger = (await res.json()) as PostgrestSwagger;
    return parseSwagger(swagger, {
      backend: "supabase",
      appName: this.appName,
    });
  }

  async execute(
    call: ToolCall,
    manifest: Manifest,
    _identity: Identity,
  ): Promise<ToolResult> {
    const capability = findEnabledCapability(manifest, call);
    if (!capability) {
      return {
        ok: false,
        error: `capability ${call.verb} on ${call.resource} is not enabled`,
      };
    }

    try {
      switch (call.verb) {
        case "read":
        case "list":
          return await this.executeRead(call, capability);
        case "create":
          return await this.executeCreate(call, capability);
        case "update":
          return await this.executeUpdate(call, capability);
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  // --- read / list -------------------------------------------------------

  private async executeRead(
    call: ToolCall,
    capability: Capability,
  ): Promise<ToolResult> {
    const params = new URLSearchParams();
    // Only ever select allow-listed columns — never `select=*`.
    params.set("select", capability.exposedFields.join(","));

    const input = call.input ?? {};

    if (call.verb === "read") {
      const id = input.id;
      if (id === undefined) return { ok: false, error: "read requires an id" };
      params.set("id", `eq.${String(id)}`);
    } else {
      // list: apply exact-match filters over exposed fields only.
      const filters = (input.filters ?? {}) as Record<string, unknown>;
      for (const [key, value] of Object.entries(filters)) {
        if (capability.exposedFields.includes(key)) {
          params.set(key, `eq.${String(value)}`);
        }
      }
    }

    // Enforce the row cap: the smaller of the requested limit and the guardrail.
    const max = capability.guardrails?.maxRowsPerCall;
    const requested = typeof input.limit === "number" ? input.limit : max;
    const limit = clampLimit(requested, max);
    if (limit !== undefined) params.set("limit", String(limit));

    const url = `${this.restUrl("/" + call.resource)}?${params.toString()}`;
    const res = await this.fetchImpl(url, { headers: this.headers() });
    if (!res.ok) {
      return { ok: false, error: `${res.status} ${res.statusText}` };
    }
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    // Defense in depth: redact again even though we only selected allow-listed.
    return { ok: true, rows: redactRows(rows, capability) };
  }

  // --- create ------------------------------------------------------------

  private async executeCreate(
    call: ToolCall,
    capability: Capability,
  ): Promise<ToolResult> {
    const values = pickAllowed(
      (call.input?.values ?? {}) as Record<string, unknown>,
      capability.exposedFields,
    );
    const url = `${this.restUrl("/" + call.resource)}?select=${capability.exposedFields.join(",")}`;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: this.headers({
        "Content-Type": "application/json",
        Prefer: "return=representation",
      }),
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      return { ok: false, error: `${res.status} ${res.statusText}` };
    }
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    return { ok: true, rows: redactRows(rows, capability) };
  }

  // --- update ------------------------------------------------------------

  private async executeUpdate(
    call: ToolCall,
    capability: Capability,
  ): Promise<ToolResult> {
    const id = call.input?.id;
    if (id === undefined) return { ok: false, error: "update requires an id" };
    const values = pickAllowed(
      (call.input?.values ?? {}) as Record<string, unknown>,
      capability.exposedFields,
    );
    const params = new URLSearchParams();
    params.set("id", `eq.${String(id)}`);
    params.set("select", capability.exposedFields.join(","));
    const url = `${this.restUrl("/" + call.resource)}?${params.toString()}`;
    const res = await this.fetchImpl(url, {
      method: "PATCH",
      headers: this.headers({
        "Content-Type": "application/json",
        Prefer: "return=representation",
      }),
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      return { ok: false, error: `${res.status} ${res.statusText}` };
    }
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    return { ok: true, rows: redactRows(rows, capability) };
  }
}

// --- helpers -------------------------------------------------------------

/** Find the enabled capability matching a call, or undefined. */
function findEnabledCapability(
  manifest: Manifest,
  call: ToolCall,
): Capability | undefined {
  const caps = manifest.capabilities[call.resource] ?? [];
  return caps.find((c) => c.verb === call.verb && c.enabled);
}

/** Keep only allow-listed keys from a write payload. */
function pickAllowed(
  values: Record<string, unknown>,
  allowed: string[],
): Record<string, unknown> {
  const set = new Set(allowed);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (set.has(k)) out[k] = v;
  }
  return out;
}

/** Clamp a requested limit to the guardrail max (and to a positive integer). */
function clampLimit(
  requested: number | undefined,
  max: number | undefined,
): number | undefined {
  if (requested === undefined) return max;
  const positive = Math.max(1, Math.floor(requested));
  return max === undefined ? positive : Math.min(positive, max);
}
