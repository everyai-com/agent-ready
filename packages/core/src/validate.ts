/**
 * Manifest validation, implemented in plain TypeScript (no schema-validator
 * dependency). The rules here mirror `manifest.schema.json` and add a few
 * cross-field checks a static JSON Schema cannot express (e.g. every
 * capability key must reference a declared resource, and every exposed field
 * must exist on its resource).
 */

import {
  MANIFEST_VERSION,
  type Capability,
  type Field,
  type FieldType,
  type Manifest,
  type Resource,
} from "./types.js";

const FIELD_TYPES: readonly FieldType[] = [
  "string",
  "number",
  "boolean",
  "datetime",
  "json",
  "unknown",
];

const VERBS = ["read", "list", "create", "update"] as const;

/** Result of validating an unknown value against the manifest spec. */
export type ValidationResult =
  | { ok: true; manifest: Manifest; errors: [] }
  | { ok: false; manifest: null; errors: string[] };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate an unknown value (typically parsed JSON) as a v0 manifest.
 * Returns the typed manifest on success, or a list of human-readable errors.
 * Never throws.
 */
export function validateManifest(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isObject(input)) {
    return { ok: false, manifest: null, errors: ["manifest must be an object"] };
  }

  if (input.version !== MANIFEST_VERSION) {
    errors.push(`version must be "${MANIFEST_VERSION}"`);
  }

  // --- app metadata ---
  if (!isObject(input.app)) {
    errors.push("app must be an object");
  } else if (typeof input.app.name !== "string" || input.app.name.length === 0) {
    errors.push("app.name must be a non-empty string");
  }

  // --- resources ---
  const resourceNames = new Set<string>();
  const fieldsByResource = new Map<string, Set<string>>();
  if (!Array.isArray(input.resources)) {
    errors.push("resources must be an array");
  } else {
    input.resources.forEach((r, i) => {
      validateResource(r, i, errors, resourceNames, fieldsByResource);
    });
  }

  // --- capabilities ---
  if (!isObject(input.capabilities)) {
    errors.push("capabilities must be an object");
  } else {
    for (const [resourceName, caps] of Object.entries(input.capabilities)) {
      if (!resourceNames.has(resourceName)) {
        errors.push(
          `capabilities["${resourceName}"] references an unknown resource`,
        );
      }
      if (!Array.isArray(caps)) {
        errors.push(`capabilities["${resourceName}"] must be an array`);
        continue;
      }
      const knownFields = fieldsByResource.get(resourceName);
      caps.forEach((c, i) => {
        validateCapability(c, resourceName, i, errors, knownFields);
      });
    }
  }

  if (errors.length > 0) {
    return { ok: false, manifest: null, errors };
  }
  return { ok: true, manifest: input as unknown as Manifest, errors: [] };
}

function validateResource(
  r: unknown,
  index: number,
  errors: string[],
  resourceNames: Set<string>,
  fieldsByResource: Map<string, Set<string>>,
): void {
  const where = `resources[${index}]`;
  if (!isObject(r)) {
    errors.push(`${where} must be an object`);
    return;
  }
  if (typeof r.name !== "string" || r.name.length === 0) {
    errors.push(`${where}.name must be a non-empty string`);
  } else {
    if (resourceNames.has(r.name)) {
      errors.push(`${where}.name "${r.name}" is duplicated`);
    }
    resourceNames.add(r.name);
  }

  const fieldNames = new Set<string>();
  if (!Array.isArray(r.fields)) {
    errors.push(`${where}.fields must be an array`);
  } else {
    (r.fields as unknown[]).forEach((f, i) => {
      validateField(f, `${where}.fields[${i}]`, errors, fieldNames);
    });
  }
  if (typeof r.name === "string") {
    fieldsByResource.set(r.name, fieldNames);
  }
}

function validateField(
  f: unknown,
  where: string,
  errors: string[],
  fieldNames: Set<string>,
): void {
  if (!isObject(f)) {
    errors.push(`${where} must be an object`);
    return;
  }
  if (typeof f.name !== "string" || f.name.length === 0) {
    errors.push(`${where}.name must be a non-empty string`);
  } else {
    fieldNames.add(f.name);
  }
  if (!FIELD_TYPES.includes(f.type as FieldType)) {
    errors.push(`${where}.type must be one of ${FIELD_TYPES.join(", ")}`);
  }
  if (f.sensitive !== undefined && typeof f.sensitive !== "boolean") {
    errors.push(`${where}.sensitive must be a boolean`);
  }
}

function validateCapability(
  c: unknown,
  resourceName: string,
  index: number,
  errors: string[],
  knownFields: Set<string> | undefined,
): void {
  const where = `capabilities["${resourceName}"][${index}]`;
  if (!isObject(c)) {
    errors.push(`${where} must be an object`);
    return;
  }
  if (!VERBS.includes(c.verb as (typeof VERBS)[number])) {
    errors.push(`${where}.verb must be one of ${VERBS.join(", ")}`);
  }
  if (typeof c.enabled !== "boolean") {
    errors.push(`${where}.enabled must be a boolean`);
  }
  if (!Array.isArray(c.exposedFields)) {
    errors.push(`${where}.exposedFields must be an array`);
  } else {
    (c.exposedFields as unknown[]).forEach((name, i) => {
      if (typeof name !== "string") {
        errors.push(`${where}.exposedFields[${i}] must be a string`);
      } else if (knownFields && !knownFields.has(name)) {
        errors.push(
          `${where}.exposedFields[${i}] "${name}" is not a field on resource "${resourceName}"`,
        );
      }
    });
  }
  if (c.locked !== undefined && typeof c.locked !== "boolean") {
    errors.push(`${where}.locked must be a boolean`);
  }
  if (c.guardrails !== undefined) {
    validateGuardrails(c.guardrails, `${where}.guardrails`, errors);
  }
}

function validateGuardrails(g: unknown, where: string, errors: string[]): void {
  if (!isObject(g)) {
    errors.push(`${where} must be an object`);
    return;
  }
  for (const key of ["maxRowsPerCall", "rateLimitPerMinute"] as const) {
    if (g[key] !== undefined && (typeof g[key] !== "number" || (g[key] as number) < 1)) {
      errors.push(`${where}.${key} must be a number >= 1`);
    }
  }
  if (
    g.requiresConfirmation !== undefined &&
    typeof g.requiresConfirmation !== "boolean"
  ) {
    errors.push(`${where}.requiresConfirmation must be a boolean`);
  }
}

// Re-export a couple of narrow helpers other modules find useful.
export type { Capability, Field, Manifest, Resource };
