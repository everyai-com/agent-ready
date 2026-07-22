# Host UI Plan — how gateway UI shows up inside Claude, ChatGPT, Claude Code, Codex

> Status: planned. Companion to [console-plan.md](console-plan.md) (the owner-facing
> console). This doc covers the OTHER side: what the **agent's user** sees inside
> each host when an agent uses a gateway — results, confirmations, and interactive
> UI. Goal: one gateway, correct UI in every host, graceful everywhere.

## 0. The one-sentence strategy

**Generate UI from the capability manifest, negotiate per host:** every tool result
carries three renderings — structured data (always), rich text (always), and an
interactive component (when the host supports it) — so the same `list_plants` call
is an interactive table in ChatGPT, a clean card in claude.ai, and a crisp
markdown table in Claude Code or Codex CLI. No tool ever *requires* a UI-capable
host.

## 1. Host capability matrix (what exists today)

| Host | Surface | What we can render | Confirmation UX |
|---|---|---|---|
| **claude.ai / Claude apps** | Remote MCP connectors | Tool results (text + structured content); artifacts alongside; MCP Apps support emerging | MCP **elicitation** dialogs; host-level tool approval |
| **ChatGPT** | Apps SDK / connectors (MCP-based) | **Embedded interactive components**: tool returns `text/html+skybridge` template reference; component runs in iframe, talks to host via `window.openai` (widget state, tool calls, sizing) | Component-driven confirm UI + host approval |
| **Claude Code** | `claude mcp add` (terminal) | Markdown in terminal: tables, code blocks; no iframes | Terminal y/n prompts (host approval); elicitation supported as prompt |
| **Codex (OpenAI, CLI/IDE)** | MCP config (terminal) | Markdown/plain text | Terminal approval prompts |
| **Cursor / other IDEs** | MCP | Mostly text; some render markdown well | Host approval |
| **Everything else** | MCP baseline | `content` text blocks | Whatever the host does |

Two standards matter and are converging: **MCP Apps** (the MCP extension for
interactive UI resources, `ui://` templates + `text/html`, backed by Anthropic and
OpenAI collaboration on mcp-ui) and **OpenAI Apps SDK** (ChatGPT's
production implementation of the same idea). We target the shared shape:
*tool result references a pre-declared HTML template resource; template
communicates with the host over a postMessage bridge.*

## 2. The module: `packages/surface-ui`

One new package that turns manifest + tool result into per-host renderings.
Nothing else in the codebase knows about hosts.

```
surface-ui/
  render/
    structured.ts   → structuredContent (JSON matching tool outputSchema)
    markdown.ts     → tables/cards as markdown (CLI + baseline hosts)
    html/           → component templates (MCP Apps / Apps SDK)
      table.html      list results: sortable, paginated table
      record.html     single record: field card
      confirm.html    write preview: "you are about to create…" diff card
      error.html      denial card: what was blocked and why
  bridge/
    host.ts         → tiny adapter over window.openai / MCP Apps postMessage
  negotiate.ts      → pick renderings from client capabilities (initialize)
  theme.ts          → design tokens (matches console; host light/dark aware)
```

### 2.1 Every tool result becomes a triple

```ts
{
  content: [{ type: "text", text: markdownTable }],   // universal fallback
  structuredContent: { rows: [...], total, page },     // machine-readable, always
  _meta: { "ui/template": "ui://agent-ready/table" }   // only when host negotiated UI
}
```

Rules:
- **Text is never a dumb stringify.** `markdown.ts` renders honest tables with
  column headers from `exposedFields`, truncation notes ("showing 25 of 132"),
  and denial messages in plain language. CLI users are first-class.
- **`outputSchema` derived from the manifest** for every tool, so hosts and
  agents can rely on result shape (core's `deriveTools` gains output schemas).
- **Templates are declared as MCP resources at initialize** (`ui://agent-ready/...`),
  fetched once by the host, instantiated per result — the MCP Apps model.

### 2.2 Components (the HTML templates)

Small, dependency-free, self-contained HTML+JS (same discipline as everything we
generate — no CDNs, CSP-safe, themable via host-provided light/dark):

1. **Table** — list_* results: sort, paginate (next page = host-mediated tool
   call with cursor), row → record view. Respects `maxRowsPerCall`.
2. **Record card** — get_* results: labeled fields, sensitive fields simply absent
   (redaction upstream, UI never sees them).
3. **Confirm card** — the `requiresConfirmation` flow: renders the pending write
   as a human diff ("Create order: 2 × Monstera, $54"), Confirm/Cancel buttons →
   resolves the elicitation/tool continuation. THE trust moment; must be boring
   and unambiguous. Never renders agent-supplied HTML — only manifest-typed fields.
4. **Denial card** — capability blocked: what was asked, why it's off, and (for
   the owner) "enable this in your console" pointer.

### 2.3 Host negotiation & bridge

- `negotiate.ts` reads client info + capabilities at `initialize` (and the
  MCP Apps/`openai` extension announcements) → decides text-only vs +UI.
  Unknown host ⇒ text-only. Never break a host by sending what it didn't ask for.
- `bridge/host.ts` wraps the two bridges (`window.openai` in ChatGPT;
  MCP Apps postMessage elsewhere) behind one tiny interface:
  `{ callTool, setState, requestClose, theme }`. Components import only this.

### 2.4 Confirmations, per host (the "user feedback" flow)

`requiresConfirmation: true` on a write capability maps to:
- **UI hosts:** confirm card component (2.2.3).
- **Elicitation-capable hosts (claude.ai, Claude Code):** MCP elicitation request
  with a typed schema ("confirm: boolean") + human summary string.
- **Neither:** two-step tool protocol — `create_order` returns a preview +
  `confirmation_token`; the write only executes on `confirm_create_order(token)`.
  Tokens are single-use, short-TTL, generated in the gateway.

The two-step protocol is ALSO the fallback the other two compile down to
internally — one code path, three presentations. Server-side enforcement always;
UI is presentation, never the gate.

## 3. Per-host playbooks (docs we ship)

`docs/connect-your-agent.md` grows per-host pages, each with screenshots and a
"what you'll see" section — this is the "UI for saying it":

- **claude.ai** — add as connector; results render as cards; confirmations as
  elicitation dialogs.
- **Claude Code** — `claude mcp add --transport http gateway <url>`; results as
  markdown tables; confirmations as terminal prompts; `/mcp` to inspect.
- **ChatGPT** — enable developer mode / Apps; interactive table + confirm
  components; how the component talks to the conversation.
- **Codex CLI** — `codex mcp add`; text rendering notes.
- **Cursor & generic** — JSON config; baseline behavior.

Plus a **living compatibility table** in the README (host × feature: structured
content / UI components / elicitation / confirm flow) — updated as hosts evolve,
a genuinely useful open-source artifact others will link to.

## 4. Security rules for embedded UI

- Components render **only manifest-typed data** — never agent-authored HTML/URLs;
  all values escaped; CSP `default-src 'none'` inside templates.
- The bridge exposes only whitelisted actions (paginate, open record, confirm) —
  a component cannot invoke arbitrary tools.
- Confirmation state lives server-side (tokens), so a malicious host/agent can't
  skip the confirm by faking a UI event.
- Redaction remains upstream in the adapter; surface-ui never receives sensitive
  fields at all.

## 5. Build order

| Step | Scope |
|---|---|
| 1 | `outputSchema` in core deriveTools + `structuredContent` + rich markdown in surface-mcp (every host instantly better, incl. Claude Code/Codex) |
| 2 | Two-step confirmation protocol + elicitation in surface-mcp |
| 3 | `packages/surface-ui`: table/record/confirm/denial templates + negotiate + bridge; wire into surface-mcp behind capability detection |
| 4 | ChatGPT Apps SDK adapter path + per-host playbook docs + compatibility table |
| 5 | Console Playground reuses the same components (one design system everywhere) |

Step 1–2 are pure server work with universal payoff; 3–4 add the rich layer where
hosts support it. Console (console-plan.md) and this module share `theme.ts` and
eventually the components themselves — one UI system, three places it appears:
in-host components, owner console, wizard.

## 6. Open questions

1. MCP Apps spec is still stabilizing — ship behind a `ui: experimental` flag in
   the manifest? (lean: yes)
2. React inside components? (lean: no — vanilla TS + templates; components are
   tiny and must stay dependency-free)
3. Do we render owner-console links inside denial cards for non-owner users?
   (lean: only when the caller key is the owner's)
