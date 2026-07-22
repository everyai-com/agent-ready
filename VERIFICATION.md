# Verification report

Integration + verification pass over the agent-ready monorepo: reconciling
`packages/surface-mcp` with the real `@agent-ready/core`, checking the
Cloudflare deploy template, and an adversarial review against the PLAN.md
safety model.

## 1. surface-mcp ↔ core reconciliation

`surface-mcp` was originally built against a **guessed** core contract in
`src/core-types.ts`. It has been rewired to the real core:

- Deleted `packages/surface-mcp/src/core-types.ts` (the local shim and its
  `deriveToolsFallback`/`validateManifestFallback`).
- `src/handler.ts` now imports `deriveTools`, `Manifest`, `Identity`,
  `ToolDefinition`, `ToolResult`, `BackendAdapter` from `@agent-ready/core`.
  - `deriveTools` default is now core's real implementation (was a local fallback).
  - `tools/list` maps core `ToolDefinition`s to the MCP wire shape
    (`name`/`description`/`inputSchema`), stripping the internal `resource`/`verb`.
  - `tools/call` looks the tool up by name and dispatches a real
    `ToolCall` (`{ resource, verb, input }`) to `adapter.execute`, instead of the
    old `{ tool, input }` shape.
  - Adapter `ToolResult` is now interpreted: `ok:false` becomes an MCP
    `isError` result; `ok:true` returns `result.rows`.
- `src/index.ts` re-exports the manifest/adapter/tool types from core.
- `package.json`: build/typecheck switched to `tsc -b`; `tsconfig.json` gained a
  project reference to `../core` (mirrors adapter-supabase).
- Tests (`test/handler.test.ts`) adapted to the real manifest shape and core's
  `get_X`/`list_X`/`create_X`/`update_X` naming (core maps `read → get_`).
  All prior coverage retained; two tests added (wire-shape has no internal
  fields; disabled tool never reaches the adapter).

## 2. deploy/cloudflare

- `manifest.json` rewritten from the old guessed shape (`version: "0.1"`,
  per-verb capability map, `table`/`columns`) to the real v0 spec
  (`version: "v0"`, `app`, `resources[].fields[]`,
  `capabilities: Record<resource, Capability[]>`). It now **validates** against
  `validateManifest` (verified: `valid: true`, derives
  `get_plants, list_plants, get_orders, list_orders`).
- `src/index.ts` now calls `validateManifest` at module load and throws on a bad
  manifest (fail-loud at deploy; also resolves the JSON literal-type mismatch).
- `package.json`: added `@agent-ready/core` dependency (now imported directly)
  and `@cloudflare/workers-types` devDependency (referenced by tsconfig but was
  missing).
- Typechecked clean against the real workspace packages (temporary symlink +
  tsconfig; `tsc` exit 0). It is not an npm workspace, so it is not built by the
  root scripts.

## 3. README

- Root `README.md` "Deploy to Cloudflare" button was a `(#)` placeholder; now
  points at
  `https://deploy.workers.cloudflare.com/?url=https://github.com/everyai-com/agent-ready/tree/main/deploy/cloudflare`
  and mentions the `deploy/cloudflare` template path + expected secrets.
- `deploy/cloudflare/README.md` button was already correct (unchanged).
- Package names / commands / file paths in both READMEs match reality.

## 4. Root verification (clean)

| Command             | Result |
|---------------------|--------|
| `npm install`       | ok     |
| `npm run build`     | ok (core, adapter-supabase, surface-mcp) |
| `npm test`          | **51 passed** — core 28, adapter-supabase 11, surface-mcp 12 |
| `npm run typecheck` | ok (all three workspaces) |

## 5. Security review vs PLAN.md §4

| # | Check | Result | Where enforced / tested |
|---|-------|--------|--------------------------|
| a | `tools/list` exposes only *enabled* capabilities | PASS | `deriveTools` skips `!enabled`; handler test "tools/list reflects only enabled capabilities" |
| b | No `select=*` / raw SQL / arbitrary filters | PASS | adapter always `select=<exposedFields>`; list filters restricted to `exposedFields`; execute test asserts `select=id,name,price` and drops `secret_note` filter |
| c | Sensitive resources (users/auth/payments) locked + disabled by default in `draftManifest` | PASS | `draft.ts` sets `enabled:false, locked:true`; draft test "locks sensitive resources entirely" |
| d | Redaction happens on output | PASS | `redactRows` on every adapter path (defense-in-depth even after column-scoped select); execute test confirms `secret_note` never returned |
| e | Auth rejection returns 401 | PASS | handler returns 401 on missing/invalid bearer; two surface tests |
| f | Disabled/unknown tools refused at `execute()` even if called directly | PASS | adapter re-checks `findEnabledCapability` → `ok:false` ("refuses a disabled create capability without any network call", "unknown resource"); handler also refuses before dispatch |

### Notes / low-severity observations (no fix required)

- An **enabled** capability with an empty `exposedFields` (only reachable via a
  hand-edited manifest — the drafter never emits this for an enabled verb)
  produces `?select=` on PostgREST. Even if the backend returned columns,
  `redactRows` with an empty allow-list strips everything, so no data leaks
  (layer-d redaction is the backstop). Left as-is.
- `packages/core` builds with `tsc -p` while the two dependent packages use
  `tsc -b` with project references; both work because core's tsconfig is
  `composite: true`.

## 6. surface-mcp ↔ surface-ui integration + two-step confirmation (this pass)

`packages/surface-mcp` now consumes `@agent-ready/surface-ui` instead of a
raw `JSON.stringify` of `result.rows`, and implements the two-step
confirmation protocol from `docs/host-ui-plan.md` §2.4 (see
`docs/confirmations.md` for the integrator-facing writeup).

- `package.json` gained `@agent-ready/surface-ui` as a dependency;
  `tsconfig.json` gained a project reference to `../surface-ui`.
  `packages/surface-ui/tsconfig.json` gained `composite: true` (was missing,
  so it could not be referenced by another project's build).
- `tools/list` now includes each tool's `outputSchema` in the wire shape (was
  dropped, even though core already derived it), and, for every capability
  with `guardrails.requiresConfirmation: true`, an additional synthetic
  `confirm_<tool>` tool (input: `{ confirmationToken: string }`).
- `tools/call` for a normal tool now returns `content[0].text =
  renderResultMarkdown(tool, result)` (an honest markdown table/field
  list/error message, not a stringify) and `structuredContent =
  buildStructuredContent(tool, result)`, matching the tool's `outputSchema`.
  `isError` is unchanged in meaning (adapter denials, disabled/unknown tools).
- **Two-step confirmation** (`packages/core/src/confirm.ts`,
  `ConfirmationGate` + `executeWithConfirmation` + `toolRequiresConfirmation`,
  re-exported from core):
  - The first `tools/call` for a `requiresConfirmation` write never reaches
    `adapter.execute`. It returns a preview ("You are about to create…") plus
    `structuredContent: { preview, confirmationToken }`.
  - `confirmationToken` is HMAC-SHA256-signed (WebCrypto) over
    `{ tool, input, exp, nonce }`, single-use (in-memory nonce `Set`),
    5-minute TTL. `createMcpHandler({ confirmSecret })` accepts an explicit
    secret; omitted falls back to a random per-instance secret — documented
    limitation for multi-isolate deployments (does not verify across
    isolates/restarts) in `docs/confirmations.md`.
  - `confirm_<tool>({ confirmationToken })` verifies signature + TTL +
    single-use + tool binding, then executes the **original, server-signed**
    input (not whatever the caller passes to confirm) via
    `executeWithConfirmation(adapter, tool, call, manifest, { ...identity,
    confirmed: true })`.
  - The gate (`executeWithConfirmation`) lives in `@agent-ready/core`, not in
    either surface — see §7(c) for why, and for the console-parity fix that
    made this necessary.
- Tests added to `packages/surface-mcp/test/handler.test.ts`: markdown table
  + `structuredContent` shape on a happy path; `confirm_*` listed only for
  guarded capabilities; preview-not-executed; calling the base tool twice
  never writes; `confirm_*` executes exactly once; reused/forged/expired
  token refused; non-confirmation writes unaffected.
- Tests added to `packages/core/test/confirm.test.ts`: `toolRequiresConfirmation`,
  `executeWithConfirmation` gate on/off, `ConfirmationGate` issue/verify
  (happy path, wrong tool, forged signature, wrong secret, expired, reused,
  malformed).

## 7. Adversarial review (this pass)

| # | Check | Result | Where enforced / tested |
|---|-------|--------|--------------------------|
| a | Console `/api/console/run` truly goes through the same manifest/capability checks as an agent (disabled tool refused) | PASS (pre-existing) | `deriveTools` lookup before execute; console test "denies unknown/disabled tools before touching the adapter" |
| b | Markdown/HTML renderers escape injection attempts | PASS (pre-existing, re-verified) | `surface-ui` `markdown.ts` escapes `\|`, `` ` ``, newlines, backslashes per cell (`escapeMarkdown`); `table.ts` HTML template only ever writes values via `textContent`, JSON bootstrap data is escaped for `<script>` context (`escapeForScript`: `<`,`>`,`&`,U+2028,U+2029); `console`'s `escapeHtml` covers `& < > " '`. Covered by `surface-ui/test/markdown.test.ts`, `table.test.ts`. |
| c | Confirmation cannot be bypassed; console parity | **FIXED** (was a real gap) | Originally `console`'s `/api/console/run` called `adapter.execute` directly — a `requiresConfirmation` write called from the console playground would have executed immediately, bypassing the two-step protocol enforced in surface-mcp. Fixed by moving the enforcement into **`@agent-ready/core`**'s `executeWithConfirmation`, and routing both `surface-mcp`'s `tools/call` and `console`'s `/api/console/run` through it. The console does not implement a confirm UI yet, so a guarded write now refuses cleanly (`"... requires confirmation and cannot be run from the console playground yet ..."`) instead of silently executing. Tested: `console/test/handler.test.ts` — "refuses a requiresConfirmation write directly, without ever calling the adapter"; `surface-mcp/test/handler.test.ts` — full confirmation-protocol suite (§6). |
| d | No sensitive fields in any rendered output | PASS (pre-existing) | Redaction happens upstream in the adapter (`redactRows`) before any row reaches `surface-ui` or `console`'s render layer; `outputSchema`/`exposedFields` used by both renderers never include non-exposed fields, so sensitive columns are structurally absent, not merely hidden. |

## 8. deploy/cloudflare (this pass)

- Added the missing `@agent-ready/surface-ui` symlink under
  `deploy/cloudflare/node_modules/@agent-ready/` (the established
  hand-symlink approach from §2/§8 above) — needed once `surface-mcp` gained
  a real dependency on it.
- Wired an optional `CONFIRM_SECRET` env var through to
  `createMcpHandler({ confirmSecret })` in `deploy/cloudflare/src/index.ts`.
- `npx tsc --noEmit` in `deploy/cloudflare`: **clean**, against the updated
  `surface-mcp`/`core`/`surface-ui` API.

## 9. Root verification (this pass)

| Command             | Result |
|---------------------|--------|
| `npm install`       | ok |
| `npm run build`     | ok (adapter-supabase, console, core, surface-mcp, surface-ui) |
| `npm test`          | **116 passed** — core 43, adapter-supabase 11, surface-mcp 20, surface-ui 25, console 17 |
| `npm run typecheck` | ok (all five workspaces) |
| `deploy/cloudflare` `tsc --noEmit` | ok (manual, not an npm workspace — see §8) |

## Still open

- `deploy/cloudflare` is intentionally outside the npm workspace set, so it
  has no automated typecheck in the root scripts; verified manually here and
  in §8. A follow-up could add it to CI via an isolated install step.
- The Gateway Console playground does not implement a two-step confirm UI —
  guarded writes refuse there rather than completing via a confirm dialog
  (see §6/§7c, `docs/confirmations.md`). Low priority: the console is an
  owner-only debugging tool, not the primary agent-facing surface.
- `ConfirmationGate`'s per-instance random secret and in-memory nonce set are
  correct for a single Worker isolate only; multi-isolate deployments need an
  explicit `confirmSecret`/`CONFIRM_SECRET` and, eventually, a shared
  single-use store (documented in `docs/confirmations.md`, not silently
  assumed away).
