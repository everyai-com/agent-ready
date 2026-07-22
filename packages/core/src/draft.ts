/**
 * Safety-first manifest drafting.
 *
 * `draftManifest(introspection)` turns a raw backend picture into a manifest
 * that is safe to hand to a non-technical user for review. The defaults encode
 * the product's spine (PLAN.md §4):
 *
 *  - Read-only posture: only `read` and `list` capabilities are drafted, and
 *    they are enabled only for non-sensitive resources. `create`/`update` are
 *    always drafted disabled.
 *  - Sensitive resources (auth, users, secrets, payments, tokens) are locked:
 *    every capability is `enabled: false, locked: true`.
 *  - Sensitive fields are flagged and excluded from the exposed-field allow-list
 *    so PII/secrets are never selected by default.
 */

import {
  MANIFEST_VERSION,
  type Capability,
  type Field,
  type Introspection,
  type Manifest,
  type Resource,
} from "./types.js";

/**
 * Table/resource names that indicate a sensitive area of the app. Matched as
 * whole-word-ish substrings against the lower-cased resource name.
 */
const SENSITIVE_RESOURCE_PATTERNS: readonly string[] = [
  "user",
  "auth",
  "account",
  "secret",
  "credential",
  "password",
  "payment",
  "billing",
  "invoice",
  "card",
  "token",
  "session",
  "api_key",
  "apikey",
];

/** Column-name fragments that indicate a sensitive field (PII/secrets). */
const SENSITIVE_FIELD_PATTERNS: readonly string[] = [
  "password",
  "passwd",
  "secret",
  "token",
  "api_key",
  "apikey",
  "access_key",
  "private_key",
  "ssn",
  "social_security",
  "credit_card",
  "card_number",
  "cvv",
  "email",
  "phone",
  "address",
  "dob",
  "birth",
  "salt",
  "hash",
];

function matchesAny(haystack: string, patterns: readonly string[]): boolean {
  const lower = haystack.toLowerCase();
  return patterns.some((p) => lower.includes(p));
}

/** True if a resource name looks like a sensitive area of the app. */
export function isSensitiveResource(name: string): boolean {
  return matchesAny(name, SENSITIVE_RESOURCE_PATTERNS);
}

/** True if a column name looks like it holds PII or secrets. */
export function isSensitiveField(name: string): boolean {
  return matchesAny(name, SENSITIVE_FIELD_PATTERNS);
}

/** Turn a machine name like `plant_orders` into a label like `Plant Orders`. */
function toLabel(name: string): string {
  return name
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Produce a safe, read-only draft manifest from introspection. The output is a
 * valid manifest that a user reviews and toggles in the wizard; nothing here is
 * exposed until the user (or a developer editing the JSON) opts in.
 */
export function draftManifest(introspection: Introspection): Manifest {
  const resources: Resource[] = [];
  const capabilities: Record<string, Capability[]> = {};

  for (const table of introspection.tables) {
    const sensitiveResource = isSensitiveResource(table.name);

    const fields: Field[] = table.columns.map((col) => ({
      name: col.name,
      type: col.type,
      sensitive: isSensitiveField(col.name),
    }));

    resources.push({
      name: table.name,
      label: toLabel(table.name),
      approximateRows: table.approximateRows,
      fields,
    });

    // Non-sensitive fields form the default read allow-list.
    const exposedFields = fields
      .filter((f) => !f.sensitive)
      .map((f) => f.name);

    // Reads/lists are enabled only for non-sensitive resources. Writes are
    // always drafted off. Sensitive resources are locked entirely.
    const readEnabled = !sensitiveResource;

    capabilities[table.name] = [
      {
        verb: "read",
        enabled: readEnabled,
        exposedFields: readEnabled ? exposedFields : [],
        locked: sensitiveResource,
      },
      {
        verb: "list",
        enabled: readEnabled,
        exposedFields: readEnabled ? exposedFields : [],
        locked: sensitiveResource,
        guardrails: { maxRowsPerCall: 100 },
      },
      {
        verb: "create",
        enabled: false,
        exposedFields: [],
        locked: sensitiveResource,
      },
      {
        verb: "update",
        enabled: false,
        exposedFields: [],
        locked: sensitiveResource,
      },
    ];
  }

  return {
    version: MANIFEST_VERSION,
    app: {
      name: introspection.appName ?? "app",
      backend: introspection.backend,
    },
    resources,
    capabilities,
  };
}
