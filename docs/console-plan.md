# Gateway Console — UI Plan

> Status: planned, not built. Companion to [PLAN.md](../PLAN.md) (sections 3–4).
> Problem: today a deployed gateway is a URL that returns JSON. The owner can't *see*
> what they created, can't try it, and can't tell what agents are doing with it.
> For vibe-coders, the UI is the product experience — this closes that gap.

## 1. What it is

A small web console **built into every deployed gateway** — same Worker, no second
deployment, no extra cost. Routes:

```
/            → Gateway Console (static UI, served as Worker assets)
/mcp         → MCP endpoint (unchanged)
/api/console → console's own backend endpoints (owner-authed)
/health      → unchanged
```

The one-click deploy story is unchanged; the click now ends on a real screen
("Your product is agent-ready") instead of raw JSON.

## 2. Screens (v1 → v3)

### v1 — See it and try it (no storage required)

**Overview** — the capability sheet, human-readable:
- "Your product is agent-ready" hero with the gateway URL.
- Nouns/verbs exposed (read/list/create/update chips), locked items shown locked
  with the why ("users is locked: contains personal data").
- Connect box: one-click "Add to Claude" link, copy-paste snippets per client
  (claude.ai connector, `claude mcp add --transport http`, Cursor, generic JSON).

**Playground** — the killer feature:
- Tool picker (from `deriveTools(manifest)`), form generated from each tool's JSON
  schema — no JSON typing, ever. Inputs get typed widgets (text, number, date).
- Run → results as a friendly table; "raw" toggle reveals the actual MCP
  request/response for the curious. Empty states explain what an agent would do.
- Denied calls render the denial reason exactly as an agent would receive it —
  teaching the safety model by showing it.

### v2 — Trust surfaces (adds storage binding)

**Activity** — every agent call: time, agent/key, tool, allowed/denied, row count
(never row *contents* — logs must not become a data leak). Filters; live tail.
**Kill switch** — one-click "Pause all agent access" banner-level control, plus
per-key revoke.
**Connections** — issue/revoke named API keys ("Claude — Maya's laptop"), each with
its ready-made config snippet.

### v3 — In-conversation UX (MCP-native)

- Map the manifest's `requiresConfirmation` guardrail onto **MCP elicitation**, so
  the agent's user gets a real confirm dialog inside the agent conversation before
  a write executes.
- Explore MCP embedded/interactive UI resources as hosts adopt them (render a
  result table inside Claude, not just text).

## 3. Architecture

- **Pattern:** one Worker serving static UI + API + MCP (the callcraft pattern:
  Hono-style router, React/Vite UI as Worker static assets).
- **UI stack:** Preact + Vite (small bundle; the console must not bloat the
  template), TypeScript, no component-library dependency. Design bar: real product
  taste — clean, warm, zero "default AI dashboard" look. Dark/light.
- **Packages:**
  - `packages/console` — the UI app + a `createConsoleHandler({manifest, adapter,
    store?})` that serves it and its `/api/console/*` endpoints. Deploy templates
    compose it next to `createMcpHandler`.
  - Storage interface `ConsoleStore` (activity events, keys, paused flag) with a
    KV implementation first (zero-migration), D1 optional later.
- **Manifest stays the single source of truth:** every screen renders from the
  manifest + deriveTools — the console has no schema knowledge of its own.

## 4. Security model for the console itself

The console is an admin surface — it must not become the vulnerability:

- **Owner auth required** for everything except a minimal public "this is an
  agent gateway" page. v1: `CONSOLE_PASSWORD` secret → session cookie (httpOnly,
  SameSite=Lax, signed). No password set → console disabled, not open.
- Playground calls execute through the same `adapter.execute()` path as agents —
  same manifest checks, same redaction. The console gets no privileged data path.
- Activity log stores metadata only (tool, verdict, count, timestamp, key id) —
  never row contents or inputs containing user data.
- Kill switch state checked in the MCP handler before dispatch; fail-closed.
- CSP on console responses; no external assets (fully self-contained, like the
  rest of the generated code).

## 5. Callcraft's role

1. **Architecture donor** — the Worker + static-React pattern and its design
   discipline set the bar for the console.
2. **First dogfood customer (after v1)** — callcraft is the exact target profile:
   a live Cloudflare product (Hono + D1 + R2) with no MCP. Making it agent-ready
   requires a **D1/Worker backend adapter** (`packages/adapter-d1`) — which also
   unlocks every other Cloudflare-native app. Its security rules (scoped queries
   only, no transcript text in logs) are the perfect stress test for the
   capability + redaction model.

## 6. Build order & effort

| Step | Scope | Needs |
|---|---|---|
| 1 | `packages/console` v1: Overview + Playground + connect snippets; wire into `deploy/cloudflare` | no storage |
| 2 | Activity + kill switch + key manager | KV binding in template, `ConsoleStore` |
| 3 | Elicitation-backed write confirmations | MCP elicitation support in surface-mcp |
| 4 | `packages/adapter-d1` + dogfood on callcraft | separate track, can parallel step 2 |

Verification per step mirrors v0.1.0: parallel build agents → adversarial
verify agent (build/tests/security checklist) → ship.

## 7. Open questions (decide before building)

1. Console auth v1: password secret (simple, works today) vs. Cloudflare Access
   (nicer, but assumes CF-specific setup) — leaning password, Access documented
   as an option.
2. Bundle strategy: prebuilt console assets shipped in the npm package (simple for
   users) vs. built at deploy time (fresher, slower) — leaning prebuilt.
3. Does the Playground allow write-tools when writes are enabled? Leaning yes but
   behind the same `requiresConfirmation` UX, so owners feel the guardrails.
