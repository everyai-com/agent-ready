/**
 * `structuredContent` — the machine-readable rendering every host receives
 * alongside markdown, built to match the tool's `outputSchema` exactly (see
 * docs/host-ui-plan.md §2.1).
 */

import type { ToolDefinition, ToolResult } from "@agent-ready/core";

function pickFields(
  row: Record<string, unknown> | undefined,
  fields: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!row) return out;
  for (const f of fields) {
    if (f in row) out[f] = row[f];
  }
  return out;
}

function fieldsFromRowSchema(schema: unknown): string[] {
  const s = schema as { properties?: Record<string, unknown> } | undefined;
  return Object.keys(s?.properties ?? {});
}

/**
 * Build the structured-content JSON for a tool result, matching
 * `tool.outputSchema` exactly:
 *  - `list` → `{ rows, total?, truncated? }`
 *  - `read` → the exposed fields directly
 *  - `create`/`update` → `{ ok, row? }`
 */
export function buildStructuredContent(
  tool: ToolDefinition,
  result: ToolResult,
): Record<string, unknown> {
  if (!result.ok) {
    return { ok: false, error: result.error ?? "Unknown error" };
  }

  switch (tool.verb) {
    case "list": {
      const rowsSchema = tool.outputSchema.properties.rows as
        | { items?: unknown }
        | undefined;
      const fields = fieldsFromRowSchema(rowsSchema?.items);
      const rows = (result.rows ?? []).map((row) => pickFields(row, fields));
      const out: Record<string, unknown> = { rows };
      if (typeof result.total === "number") out.total = result.total;
      if (typeof result.truncated === "boolean") out.truncated = result.truncated;
      return out;
    }
    case "read": {
      const fields = Object.keys(tool.outputSchema.properties ?? {});
      return pickFields(result.rows?.[0], fields);
    }
    case "create":
    case "update": {
      const rowSchema = tool.outputSchema.properties.row;
      const fields = fieldsFromRowSchema(rowSchema);
      const row = result.rows?.[0];
      const out: Record<string, unknown> = { ok: true };
      if (row) out.row = pickFields(row, fields);
      return out;
    }
    default:
      return { ok: result.ok };
  }
}
