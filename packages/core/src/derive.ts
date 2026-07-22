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

/** Map a manifest field type to a JSON-Schema property fragment for output. */
function jsonSchemaProperty(field: Field): Record<string, unknown> {
  switch (field.type) {
    case "number":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "json":
      return { type: "object" };
    case "datetime":
      return { type: "string", format: "date-time" };
    case "string":
      return { type: "string" };
    default:
      return {};
  }
}

/** Build the `{ [field]: schema }` properties object for a set of exposed fields. */
function exposedFieldProperties(
  capability: Capability,
  resource: Resource,
): { properties: Record<string, unknown>; required: string[] } {
  const fieldByName = new Map(resource.fields.map((f) => [f.name, f]));
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const name of capability.exposedFields) {
    const field = fieldByName.get(name);
    if (!field) continue;
    properties[name] = jsonSchemaProperty(field);
    required.push(name);
  }
  return { properties, required };
}

/** Build the JSON-Schema output for a tool from its capability + resource. */
function buildOutputSchema(
  capability: Capability,
  resource: Resource,
): JsonSchema {
  if (capability.verb === "list") {
    const { properties: rowProperties, required } = exposedFieldProperties(
      capability,
      resource,
    );
    const rowSchema = {
      type: "object",
      properties: rowProperties,
      required,
      additionalProperties: false,
    };
    return {
      type: "object",
      properties: {
        rows: { type: "array", items: rowSchema },
        total: { type: "number" },
        truncated: { type: "boolean" },
      },
      required: ["rows"],
      additionalProperties: false,
    };
  }

  if (capability.verb === "read") {
    const { properties, required } = exposedFieldProperties(
      capability,
      resource,
    );
    return {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    };
  }

  // create / update: a write-acknowledgement shape.
  const { properties: rowProperties, required } = exposedFieldProperties(
    capability,
    resource,
  );
  const rowSchema = {
    type: "object",
    properties: rowProperties,
    required,
    additionalProperties: false,
  };
  return {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      row: rowSchema,
    },
    required: ["ok"],
    additionalProperties: false,
  };
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
        outputSchema: buildOutputSchema(capability, res),
        resource: resource.name,
        verb: capability.verb,
      });
    }
  }

  return tools;
}
