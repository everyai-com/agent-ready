/**
 * Rich markdown rendering — the universal fallback every host gets (CLI users
 * are first-class; see docs/host-ui-plan.md §2.1). Never a dumb stringify:
 * list results are honest tables with headers from the tool's exposed
 * fields, truncation notes, and an empty-state line; get results are a
 * labeled field list; create/update are one-line summaries; errors and
 * denials are plain language, never a stack trace.
 */

import type { ToolDefinition, ToolResult } from "@agent-ready/core";

const MAX_CELL_LENGTH = 60;

/** Escape a value for safe embedding in a markdown table cell / field list. */
function escapeMarkdown(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = typeof value === "string" ? value : JSON.stringify(value);
  return str
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .replace(/`/g, "\\`");
}

function truncateCell(value: string): string {
  if (value.length <= MAX_CELL_LENGTH) return value;
  return `${value.slice(0, MAX_CELL_LENGTH - 1)}…`;
}

function formatCell(value: unknown): string {
  return truncateCell(escapeMarkdown(value));
}

/** Pull the ordered list of exposed field names for a tool from its outputSchema. */
function exposedFieldNames(tool: ToolDefinition): string[] {
  const schema = tool.outputSchema;
  if (tool.verb === "list") {
    const rows = schema.properties.rows as
      | { items?: { properties?: Record<string, unknown> } }
      | undefined;
    return Object.keys(rows?.items?.properties ?? {});
  }
  if (tool.verb === "read") {
    return Object.keys(schema.properties ?? {});
  }
  // create / update
  const row = schema.properties.row as
    | { properties?: Record<string, unknown> }
    | undefined;
  return Object.keys(row?.properties ?? {});
}

function renderListMarkdown(tool: ToolDefinition, result: ToolResult): string {
  const fields = exposedFieldNames(tool);
  const rows = result.rows ?? [];

  if (rows.length === 0) {
    return `No ${tool.resource} found.`;
  }

  const header = `| ${fields.join(" | ")} |`;
  const divider = `| ${fields.map(() => "---").join(" | ")} |`;
  const body = rows
    .map((row) => `| ${fields.map((f) => formatCell(row[f])).join(" | ")} |`)
    .join("\n");

  const lines = [header, divider, body];

  const total = typeof result.total === "number" ? result.total : undefined;
  const truncated = result.truncated === true || (total !== undefined && total > rows.length);
  if (truncated) {
    const totalLabel = total !== undefined ? total : "more";
    lines.push("", `_Showing ${rows.length} of ${totalLabel}._`);
  }

  return lines.join("\n");
}

function renderReadMarkdown(tool: ToolDefinition, result: ToolResult): string {
  const fields = exposedFieldNames(tool);
  const row = result.rows?.[0];
  if (!row) {
    return `No ${tool.resource} found.`;
  }
  return fields
    .map((f) => `**${escapeMarkdown(f)}:** ${formatCell(row[f])}`)
    .join("\n");
}

function renderWriteMarkdown(tool: ToolDefinition, result: ToolResult): string {
  const verbLabel = tool.verb === "create" ? "Created" : "Updated";
  const row = result.rows?.[0];
  if (!row) {
    return `${verbLabel} ${tool.resource}.`;
  }
  const idPart = "id" in row ? ` (id: ${formatCell(row.id)})` : "";
  return `${verbLabel} ${tool.resource}${idPart}.`;
}

/** Plain-language message for errors and denials — never a stack trace. */
function renderErrorMarkdown(tool: ToolDefinition, result: ToolResult): string {
  const message = result.error?.trim();
  if (message) {
    return `Could not complete **${tool.name}**: ${escapeMarkdown(message)}`;
  }
  return `Could not complete **${tool.name}**.`;
}

/**
 * Render a tool result as markdown appropriate to its verb. This is the
 * `content: [{ type: "text", text }]` fallback every host receives.
 */
export function renderResultMarkdown(
  tool: ToolDefinition,
  result: ToolResult,
): string {
  if (!result.ok) {
    return renderErrorMarkdown(tool, result);
  }

  switch (tool.verb) {
    case "list":
      return renderListMarkdown(tool, result);
    case "read":
      return renderReadMarkdown(tool, result);
    case "create":
    case "update":
      return renderWriteMarkdown(tool, result);
    default:
      return renderErrorMarkdown(tool, result);
  }
}
