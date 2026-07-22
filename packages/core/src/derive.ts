/**
 * Tool derivation. Given a manifest, produce the agent-facing tool definitions
 * for every *enabled* capability — and only those. Disabled or locked-off
 * capabilities never become tools, so an agent literally cannot see them.
 */

import type {
  Capability,
  CapabilityVerb,
  Field,
  JsonSchema,
  Manifest,
  Resource,
  ToolDefinition,
} from "./types.js";

/** Map a manifest field type to a JSON-Schema `type` string. */
function jsonType(field: Field): string {
  switch (field.type) {
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "json":
      return "object";
    // string, datetime, unknown all serialize as strings for agent input.
    default:
      return "string";
  }
}

/** `list` → `list_plants`, `create` → `create_order`, etc. */
export function toolName(verb: CapabilityVerb, resource: string): string {
  const verbPrefix = verb === "read" ? "get" : verb;
  return `${verbPrefix}_${resource}`;
}

function describe(verb: CapabilityVerb, resource: Resource): string {
  const label = resource.label ?? resource.name;
  switch (verb) {
    case "read":
      return `Get a single ${label} record by id.`;
    case "list":
      return `List ${label} records.`;
    case "create":
      return `Create a new ${label} record.`;
    case "update":
      return `Update an existing ${label} record.`;
  }
}

/** Build the JSON-Schema input for a tool from its capability + resource. */
function buildInputSchema(
  capability: Capability,
  resource: Resource,
): JsonSchema {
  const fieldByName = new Map(resource.fields.map((f) => [f.name, f]));
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  if (capability.verb === "read") {
    // Read one row by id.
    properties.id = { type: "string", description: `id of the ${resource.name}` };
    required.push("id");
  } else if (capability.verb === "list") {
    // Optional structured filters over exposed fields + a bounded limit.
    const filterProps: Record<string, unknown> = {};
    for (const name of capability.exposedFields) {
      const field = fieldByName.get(name);
      if (field) filterProps[name] = { type: jsonType(field) };
    }
    properties.filters = {
      type: "object",
      description: "Exact-match filters over exposed fields.",
      properties: filterProps,
      additionalProperties: false,
    };
    const max = capability.guardrails?.maxRowsPerCall;
    properties.limit = {
      type: "number",
      description: max
        ? `Max rows to return (capped at ${max}).`
        : "Max rows to return.",
      ...(max ? { maximum: max } : {}),
    };
  } else {
    // create / update: a `values` object of the allow-listed writable fields.
    const valueProps: Record<string, unknown> = {};
    for (const name of capability.exposedFields) {
      const field = fieldByName.get(name);
      if (field) valueProps[name] = { type: jsonType(field) };
    }
    if (capability.verb === "update") {
      properties.id = {
        type: "string",
        description: `id of the ${resource.name} to update`,
      };
      required.push("id");
    }
    properties.values = {
      type: "object",
      description: "Fields to write (only allow-listed fields are accepted).",
      properties: valueProps,
      additionalProperties: false,
    };
    required.push("values");
  }

  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

/**
 * Derive the full set of tools for a manifest. Only enabled capabilities on
 * declared resources are included. Order follows resource declaration order,
 * then read/list/create/update within each resource.
 */
export function deriveTools(manifest: Manifest): ToolDefinition[] {
  const resourceByName = new Map(manifest.resources.map((r) => [r.name, r]));
  const tools: ToolDefinition[] = [];

  for (const resource of manifest.resources) {
    const caps = manifest.capabilities[resource.name] ?? [];
    for (const capability of caps) {
      if (!capability.enabled) continue; // opt-in only
      const res = resourceByName.get(resource.name);
      if (!res) continue;
      tools.push({
        name: toolName(capability.verb, resource.name),
        description: describe(capability.verb, res),
        inputSchema: buildInputSchema(capability, res),
        resource: resource.name,
        verb: capability.verb,
      });
    }
  }

  return tools;
}
