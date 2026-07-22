import type { Manifest } from "@agent-ready/core";
import { escapeHtml } from "./escape.js";
import type { ManifestView } from "./manifestView.js";

const PAGE_HEAD = (title: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/console-assets/app.css" />
</head>
<body>`;

const PAGE_TAIL = "</body></html>";

/** Shown when no `CONSOLE_PASSWORD` is configured — never a silently-open console. */
export function disabledPage(): string {
  return `${PAGE_HEAD("agent-ready gateway")}
<div class="login-wrap">
  <h1>🟡 Console disabled</h1>
  <p>This is a live <a href="https://github.com/everyai-com/agent-ready" target="_blank" rel="noopener">agent-ready</a> MCP gateway. The owner console is off because no <code>CONSOLE_PASSWORD</code> secret is set.</p>
  <p>Set <code>CONSOLE_PASSWORD</code> on this deployment to turn it on.</p>
  <p class="footer-note">The MCP endpoint at <code>/mcp</code> is unaffected by this setting.</p>
</div>
${PAGE_TAIL}`;
}

export function loginPage(opts: { error?: boolean } = {}): string {
  return `${PAGE_HEAD("Sign in — agent-ready console")}
<div class="login-wrap">
  <h1>Gateway Console</h1>
  <p>Sign in with the console password to see your capability sheet and try tools.</p>
  <form id="login-form">
    <label for="password">Password</label>
    <input type="password" id="password" name="password" autocomplete="current-password" autofocus />
    <div id="login-error" class="error-text">${opts.error ? "Incorrect password." : ""}</div>
    <button class="primary" type="submit">Sign in</button>
  </form>
</div>
<script src="/console-assets/login.js"></script>
${PAGE_TAIL}`;
}

function verbChip(cap: ManifestView["resources"][number]["capabilities"][number]): string {
  const label = cap.verb;
  if (cap.locked) {
    return `<span class="chip locked" title="${escapeHtml(cap.reason ?? "locked")}">🔒 ${escapeHtml(label)}</span>`;
  }
  if (cap.enabled) {
    return `<span class="chip on">✅ ${escapeHtml(label)}</span>`;
  }
  return `<span class="chip">☐ ${escapeHtml(label)}</span>`;
}

function resourceRow(resource: ManifestView["resources"][number]): string {
  const rows = resource.approximateRows != null ? ` <span class="rmeta">(${resource.approximateRows} rows)</span>` : "";
  const lockedNotes = resource.capabilities
    .filter((c) => c.locked && c.reason)
    .map((c) => `<div class="chip-note">${escapeHtml(c.reason!)}</div>`)
    .slice(0, 1)
    .join("");
  return `<div class="resource-row">
    <span class="rname">${escapeHtml(resource.label)}</span>${rows}
    ${resource.description ? `<div class="chip-note">${escapeHtml(resource.description)}</div>` : ""}
    <div class="chips">${resource.capabilities.map(verbChip).join("")}</div>
    ${lockedNotes}
  </div>`;
}

function connectSnippets(mcpUrl: string): string {
  const claudeAdd = `claude mcp add --transport http gateway ${mcpUrl}`;
  const genericJson = JSON.stringify(
    { mcpServers: { gateway: { url: mcpUrl, transport: "http" } } },
    null,
    2,
  );
  const claudeAiUrl = `https://claude.ai/connectors?url=${encodeURIComponent(mcpUrl)}`;

  return `<div class="card">
    <h2>Connect an agent</h2>
    <p>MCP endpoint: <code>${escapeHtml(mcpUrl)}</code></p>
    <p><a href="${escapeHtml(claudeAiUrl)}" target="_blank" rel="noopener">Add to Claude.ai →</a></p>
    <div class="snippet-tabs">
      <button data-snippet="cli" class="active">Claude Code CLI</button>
      <button data-snippet="json">Generic MCP JSON</button>
    </div>
    <div class="copy-row">
      <pre data-snippet="cli" id="snippet-cli" style="display:block">${escapeHtml(claudeAdd)}</pre>
      <pre data-snippet="json" id="snippet-json" style="display:none">${escapeHtml(genericJson)}</pre>
      <button class="copy-btn" data-copy-target="snippet-cli">Copy</button>
    </div>
  </div>`;
}

export function consoleAppPage(view: ManifestView, mcpUrl: string, appTitle: string): string {
  const title = appTitle || view.app.title || view.app.name;
  return `${PAGE_HEAD(`${title} — agent-ready console`)}
<div class="wrap">
  <div class="hero">
    <span class="badge">🟢 Agent-ready</span>
    <h1>${escapeHtml(title)} is agent-ready</h1>
    <p>${escapeHtml(view.app.description ?? "AI agents can use exactly the capabilities you've enabled below — nothing more.")}</p>
  </div>

  <div class="tabs">
    <button class="tab-btn active" data-panel="panel-overview">Overview</button>
    <button class="tab-btn" data-panel="panel-playground">Playground</button>
    <button class="link" id="logout-btn" style="margin-left:auto;align-self:center">Sign out</button>
  </div>

  <div id="panel-overview" class="panel active">
    <div class="card">
      <h2>Capability sheet</h2>
      ${view.resources.map(resourceRow).join("") || '<p class="empty">No resources declared.</p>'}
    </div>
    ${connectSnippets(mcpUrl)}
  </div>

  <div id="panel-playground" class="panel">
    <div class="card">
      <h2>Try a tool</h2>
      <label for="tool-select">Tool</label>
      <select id="tool-select"></select>
      <form id="playground-form"></form>
      <button class="primary" id="run-btn" disabled type="button">Run</button>
    </div>
    <div class="card">
      <h2>Result</h2>
      <div id="playground-result" class="empty">Run a tool to see results here.</div>
      <div class="raw-toggle">
        <button class="link" id="raw-toggle">Show raw request/response</button>
        <pre id="raw-json" style="display:none"></pre>
      </div>
    </div>
  </div>

  <p class="footer-note">Playground calls run through the same capability checks and redaction agents get — nothing privileged.</p>
</div>
<script src="/console-assets/app.js"></script>
${PAGE_TAIL}`;
}

/** Exported for tests that want the raw manifest type without pulling pages.ts internals. */
export type { Manifest };
