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

## Still open

- Nothing blocking. `deploy/cloudflare` is intentionally outside the npm
  workspace set, so it has no automated typecheck in the root scripts; it was
  verified manually here. If desired, a follow-up could add it to CI via an
  isolated install step.
