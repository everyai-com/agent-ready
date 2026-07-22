/**
 * Core type definitions for agent-ready.
 *
 * The **capability manifest** is the single source of truth for the whole
 * toolkit: backend adapters produce it, surface generators (MCP / API / CLI)
 * consume it. It is an open, versioned spec — see `manifest.schema.json` for the
 * machine-readable JSON Schema that mirrors these types.
 *
 * Design intent: the manifest is safe by default. Nothing is exposed unless a
 * capability is explicitly `enabled`, and only fields on a capability's
 * `exposedFields` allow-list are ever selected or returned to an agent.
 */

/** The manifest spec version this library reads and writes. */
export const MANIFEST_VERSION = "v0" as const;

/** Scalar shape of a field, normalized away from any backend-specific type. */
export type FieldType =
  | "string"
  | "number"
  | "boolean"
  | "datetime"
  | "json"
  | "unknown";

/** The four verbs a capability can express, in ascending order of danger. */
export type CapabilityVerb = "read" | "list" | "create" | "update";

/** A single column on a resource. */
export interface Field {
  /** Column name exactly as it exists in the backend. */
  name: string;
  /** Normalized scalar type. */
  type: FieldType;
  /**
   * Marks data that should never be handed to an agent without a deliberate
   * choice (PII, secrets, tokens, payment data). Sensitive fields are excluded
   * from generated allow-lists by default.
   */
  sensitive?: boolean;
}

/** A resource is a "noun" in the app — typically one table. */
export interface Resource {
  /** Stable machine name (usually the table name), e.g. `plants`. */
  name: string;
  /** Optional human-friendly label, e.g. `Plants`. */
  label?: string;
  /** Optional plain-language description shown in the wizard. */
  description?: string;
  /** Best-effort row count from introspection, for the wizard's overview. */
  approximateRows?: number;
  /** The columns on this resource. */
  fields: Field[];
}

/**
 * Optional per-capability guardrails. These are advisory limits the surface
 * generators enforce; absent values mean "no explicit limit".
 */
export interface Guardrails {
  /** Hard cap on rows a single read/list call may return. */
  maxRowsPerCall?: number;
  /** Advisory rate limit the generated gateway should enforce. */
  rateLimitPerMinute?: number;
  /** When true, a write must be presented to a human/agent confirm step first. */
  requiresConfirmation?: boolean;
}

/** A capability is one verb on one resource. */
export interface Capability {
  /** Which verb this capability grants. */
  verb: CapabilityVerb;
  /**
   * Master switch. `false` (the default posture) means the capability is not
   * exposed at all — no tool is derived for it.
   */
  enabled: boolean;
  /**
   * Allow-list of field names an agent may see (for read/list) or set
   * (for create/update). Anything not listed is never selected or returned.
   */
  exposedFields: string[];
  /**
   * When true the capability is pinned off and cannot be flipped on in the
   * wizard without an explicit "I understand" unlock — used for sensitive
   * resources (auth, users, secrets, payments).
   */
  locked?: boolean;
  /** Optional guardrails for this capability. */
  guardrails?: Guardrails;
}

/** Free-form, human-facing metadata about the app the manifest describes. */
export interface AppMetadata {
  /** Short machine name/slug for the app, e.g. `plantshop`. */
  name: string;
  /** Optional display title. */
  title?: string;
  /** Optional one-line description. */
  description?: string;
  /** Which backend produced this manifest, e.g. `supabase`. */
  backend?: string;
}

/** The capability manifest — the whole contract, in one object. */
export interface Manifest {
  /** Spec version. Currently always `"v0"`. */
  version: typeof MANIFEST_VERSION;
  /** App-level metadata. */
  app: AppMetadata;
  /** The resources (nouns) the app exposes. */
  resources: Resource[];
  /**
   * Capabilities (verbs), keyed by resource name. The key must match a
   * `Resource.name`. Each resource maps to a list of capabilities.
   */
  capabilities: Record<string, Capability[]>;
}

// ---------------------------------------------------------------------------
// Introspection — what a backend adapter reports before a manifest is drafted.
// ---------------------------------------------------------------------------

/** A table (or table-like object) discovered by introspection. */
export interface IntrospectedTable {
  name: string;
  /** Best-effort row count if the backend can supply one cheaply. */
  approximateRows?: number;
  columns: IntrospectedColumn[];
}

/** A column discovered by introspection. */
export interface IntrospectedColumn {
  name: string;
  type: FieldType;
  /** True if the backend reports the column as nullable. */
  nullable?: boolean;
}

/** The raw picture of a backend, before any safety classification is applied. */
export interface Introspection {
  /** Which backend this came from, e.g. `supabase`. */
  backend: string;
  /** Optional app name/slug carried through to the manifest. */
  appName?: string;
  tables: IntrospectedTable[];
}

// ---------------------------------------------------------------------------
// Execution — the runtime contract a surface uses to call a backend.
// ---------------------------------------------------------------------------

/** A single tool invocation coming from an agent. */
export interface ToolCall {
  /** Resource this call targets (must match a `Resource.name`). */
  resource: string;
  /** Verb being invoked. */
  verb: CapabilityVerb;
  /**
   * Structured arguments — e.g. `{ filters, limit }` for list, or
   * `{ values }` for create/update. Shape is verb-dependent.
   */
  input?: Record<string, unknown>;
}

/** The identity an agent is acting as (v1: an owner-issued API key). */
export interface Identity {
  /** Opaque id for the acting agent/key, used for audit + rate limiting. */
  agentId?: string;
}

/** The result of executing a tool call. */
export interface ToolResult {
  ok: boolean;
  /** Redacted rows for read/list, or the affected row(s) for create/update. */
  rows?: Array<Record<string, unknown>>;
  /** Human-readable error when `ok` is false. */
  error?: string;
}

/**
 * A backend adapter plugs a data source into agent-ready. Implementations live
 * in their own packages (e.g. `@agent-ready/adapter-supabase`).
 */
export interface BackendAdapter {
  /** Discover the backend's structure. */
  introspect(): Promise<Introspection>;
  /** Execute one capability-checked tool call as a given identity. */
  execute(
    call: ToolCall,
    manifest: Manifest,
    identity: Identity,
  ): Promise<ToolResult>;
}

// ---------------------------------------------------------------------------
// Derived tools — what a surface generator turns a manifest into.
// ---------------------------------------------------------------------------

/** Minimal JSON-Schema fragment used for a derived tool's input. */
export interface JsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

/** A single agent-facing tool derived from an enabled capability. */
export interface ToolDefinition {
  /** Tool name, e.g. `list_plants`, `create_order`. */
  name: string;
  /** One-line description an agent reads. */
  description: string;
  /** JSON Schema describing the tool's input. */
  inputSchema: JsonSchema;
  /** The resource/verb this tool maps back to, for the executor. */
  resource: string;
  verb: CapabilityVerb;
}
