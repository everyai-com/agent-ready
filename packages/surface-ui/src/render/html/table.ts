/**
 * `table.html` — v1 of the single HTML component template (MCP Apps /
 * Apps SDK groundwork, see docs/host-ui-plan.md §2.2.1). Self-contained,
 * dependency-free, CSP-safe: no external resources, no inline event-handler
 * attributes (everything wired via `addEventListener`), light/dark via
 * `prefers-color-scheme` using the shared design tokens.
 *
 * The template reads its data from a `window.__AGENT_READY_DATA__`
 * bootstrap object rather than fetching anything, so it works offline and
 * under `default-src 'none'`. `renderTableHtml` inlines a tool's list
 * result into this template — nothing here executes agent-supplied HTML;
 * only manifest-typed field values are ever placed in the DOM, and always
 * via `textContent`, never `innerHTML`.
 */

import type { ToolDefinition, ToolResult } from "@agent-ready/core";
import { theme } from "../../theme.js";

/** Escape a value so it can be safely embedded inside a `<script>` block. */
function escapeForScript(json: string): string {
  const lineSeparator = String.fromCharCode(0x2028);
  const paragraphSeparator = String.fromCharCode(0x2029);
  return json
    .split("<").join("\\u003c")
    .split(">").join("\\u003e")
    .split("&").join("\\u0026")
    .split(lineSeparator).join("\\u2028")
    .split(paragraphSeparator).join("\\u2029");
}

function fieldsFromRowSchema(schema: unknown): string[] {
  const s = schema as { properties?: Record<string, unknown> } | undefined;
  return Object.keys(s?.properties ?? {});
}

/** The static page shell. `%%DATA%%` and `%%TITLE%%` are replaced at render time. */
const TEMPLATE = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>%%TITLE%%</title>
<style>
  :root {
    --bg-light: ${theme.light.background};
    --surface-light: ${theme.light.surface};
    --border-light: ${theme.light.border};
    --text-light: ${theme.light.text};
    --text-muted-light: ${theme.light.textMuted};
    --accent-light: ${theme.light.accent};
    --bg-dark: ${theme.dark.background};
    --surface-dark: ${theme.dark.surface};
    --border-dark: ${theme.dark.border};
    --text-dark: ${theme.dark.text};
    --text-muted-dark: ${theme.dark.textMuted};
    --accent-dark: ${theme.dark.accent};
    --bg: var(--bg-light);
    --surface: var(--surface-light);
    --border: var(--border-light);
    --text: var(--text-light);
    --text-muted: var(--text-muted-light);
    --accent: var(--accent-light);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: var(--bg-dark);
      --surface: var(--surface-dark);
      --border: var(--border-dark);
      --text: var(--text-dark);
      --text-muted: var(--text-muted-dark);
      --accent: var(--accent-dark);
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: ${theme.spacing.lg};
    background: var(--bg);
    color: var(--text);
    font-family: ${theme.font.sans};
    font-size: 14px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: ${theme.radius.md};
    overflow: hidden;
  }
  th, td {
    text-align: left;
    padding: ${theme.spacing.sm} ${theme.spacing.md};
    border-bottom: 1px solid var(--border);
  }
  th {
    cursor: pointer;
    user-select: none;
    color: var(--text-muted);
    font-weight: 600;
  }
  th[aria-sort]:after { content: " " attr(data-arrow); }
  tr:last-child td { border-bottom: none; }
  .empty, .note {
    color: var(--text-muted);
    padding: ${theme.spacing.md} 0;
  }
</style>
</head>
<body>
  <table id="agent-ready-table">
    <thead><tr id="agent-ready-head"></tr></thead>
    <tbody id="agent-ready-body"></tbody>
  </table>
  <div class="empty" id="agent-ready-empty" hidden>No rows.</div>
  <div class="note" id="agent-ready-note" hidden></div>
  <script>
    window.__AGENT_READY_DATA__ = %%DATA%%;
  </script>
  <script>
    (function () {
      var data = window.__AGENT_READY_DATA__ || { columns: [], rows: [] };
      var columns = data.columns || [];
      var rows = (data.rows || []).slice();
      var sortState = { column: null, direction: 1 };

      var head = document.getElementById("agent-ready-head");
      var body = document.getElementById("agent-ready-body");
      var empty = document.getElementById("agent-ready-empty");
      var note = document.getElementById("agent-ready-note");

      function cellText(value) {
        if (value === null || value === undefined) return "";
        if (typeof value === "object") return JSON.stringify(value);
        return String(value);
      }

      function renderHead() {
        head.textContent = "";
        columns.forEach(function (col) {
          var th = document.createElement("th");
          th.textContent = col;
          th.dataset.column = col;
          if (sortState.column === col) {
            th.setAttribute("aria-sort", sortState.direction === 1 ? "ascending" : "descending");
            th.setAttribute("data-arrow", sortState.direction === 1 ? "\\u25B2" : "\\u25BC");
          }
          th.addEventListener("click", function () {
            sortByColumn(col);
          });
          head.appendChild(th);
        });
      }

      function renderBody() {
        body.textContent = "";
        rows.forEach(function (row) {
          var tr = document.createElement("tr");
          columns.forEach(function (col) {
            var td = document.createElement("td");
            td.textContent = cellText(row[col]);
            tr.appendChild(td);
          });
          body.appendChild(tr);
        });
        empty.hidden = rows.length !== 0;
      }

      function sortByColumn(col) {
        if (sortState.column === col) {
          sortState.direction = sortState.direction * -1;
        } else {
          sortState.column = col;
          sortState.direction = 1;
        }
        rows.sort(function (a, b) {
          var av = a[col];
          var bv = b[col];
          if (av === bv) return 0;
          if (av === null || av === undefined) return 1;
          if (bv === null || bv === undefined) return -1;
          if (av < bv) return -1 * sortState.direction;
          if (av > bv) return 1 * sortState.direction;
          return 0;
        });
        renderHead();
        renderBody();
      }

      renderHead();
      renderBody();

      if (typeof data.total === "number" && data.total > rows.length) {
        note.hidden = false;
        note.textContent = "Showing " + rows.length + " of " + data.total + ".";
      } else if (data.truncated) {
        note.hidden = false;
        note.textContent = "Showing " + rows.length + " row(s); more available.";
      }
    })();
  </script>
</body>
</html>
`;

/**
 * Render a `list_*` tool result as a self-contained sortable HTML table.
 * Only manifest-typed field values are ever inlined — no agent-supplied
 * HTML or URLs are rendered.
 */
export function renderTableHtml(tool: ToolDefinition, result: ToolResult): string {
  const rowsSchema = tool.outputSchema.properties.rows as
    | { items?: unknown }
    | undefined;
  const columns = fieldsFromRowSchema(rowsSchema?.items);
  const rows = result.ok ? result.rows ?? [] : [];

  const bootstrap: Record<string, unknown> = { columns, rows };
  if (result.ok && typeof result.total === "number") bootstrap.total = result.total;
  if (result.ok && typeof result.truncated === "boolean") {
    bootstrap.truncated = result.truncated;
  }

  const title = `${tool.name} results`;
  return TEMPLATE.replace("%%TITLE%%", title).replace(
    "%%DATA%%",
    escapeForScript(JSON.stringify(bootstrap)),
  );
}
