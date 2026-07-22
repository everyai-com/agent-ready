# Contributing to agent-ready

Thanks for wanting to help. This project is built to be built on — the
capability manifest is a stable, versioned contract specifically so that
backend adapters, surface generators, and deploy targets can be added by
anyone, not just us. See [`PLAN.md`](./PLAN.md) for the full mission and
architecture; this doc is the practical "how do I actually contribute" guide.

## Dev setup

Requirements:

- **Node >= 20**
- **npm** (this is an npm-workspaces monorepo — don't mix in yarn/pnpm lockfiles)

```bash
git clone https://github.com/everyai-com/agent-ready.git
cd agent-ready
npm ci
npm run build
npm test
```

Monorepo layout (see the root README for the full picture):

```
packages/
  core/               manifest spec, validation, tool derivation
  adapter-supabase/   Supabase introspection + PostgREST executors
  surface-mcp/        remote MCP server generator
deploy/
  cloudflare/         one-click Cloudflare Worker template
docs/                 manifest spec, connect-your-agent guide, etc.
examples/             example manifests / demo apps
```

Each package has its own `npm run build` / `npm test`; the root scripts
fan out across workspaces. Run `npm run build --workspace=packages/core`
(etc.) if you only want to iterate on one package.

## How to write a backend adapter

An adapter's job is to turn a real backend into a manifest draft, and later
to actually execute the tools the manifest describes. Every adapter
implements two things:

```ts
interface BackendAdapter {
  /**
   * Connect to the backend with owner-supplied credentials and produce a
   * draft capability manifest: every table/collection, column/field, and
   * relationship the backend exposes, with sensitive fields pre-classified
   * and locked, and everything else defaulted to read-only, opt-in.
   *
   * introspect() must never itself decide to expose anything — it proposes,
   * the owner (via the wizard, or by hand-editing the manifest) disposes.
   */
  introspect(credentials: BackendCredentials): Promise<ManifestDraft>;

  /**
   * Execute one manifest-declared capability (e.g. "list_plants",
   * "create_order") against the backend, given validated input and the
   * calling identity. This is the only path from a tool call to real data —
   * there is no raw-query escape hatch.
   */
  execute(
    tool: CapabilityId,
    input: unknown,
    identity: CallerIdentity
  ): Promise<ToolResult>;
}
```

Guidelines specific to adapters:

- **introspect() is honest, not clever.** Report what's actually in the
  schema. Don't try to guess intent beyond the sensitive-classification
  rules in [`docs/manifest-spec.md`](./docs/manifest-spec.md) — auth
  tables, PII-shaped columns (email, phone, address, password/token
  fields), and payment-shaped fields should come back locked by default;
  everything else comes back read-only and off, ready for the owner to
  opt in.
- **execute() only trusts the manifest.** Validate `input` against the
  capability's declared schema before touching the backend. Never build a
  query from anything the agent sent that isn't a manifest-declared field.
  Enforce guardrails (`maxRowsPerCall`, `rateLimitPerMinute`,
  `requiresConfirmation`) at this layer — don't assume a surface generator
  already did it.
- **No raw SQL / no `select *`.** If your backend's client library makes it
  easy to pass through an arbitrary filter or query string from the agent,
  don't wire that up. Every column returned must be one the manifest
  explicitly declares for that capability.
- **Use the app owner's own scoping where it exists.** For Supabase, prefer
  going through PostgREST with RLS intact over the service-role key when
  you can; for Convex, prefer calling declared functions over bypassing
  them. The service key path should be the fallback, not the default.
- **Write tests against a fixture backend**, not a live account — see
  `packages/adapter-supabase` for the pattern (a seeded local schema, or
  a recorded fixture) so CI doesn't need real credentials.
- Look at `packages/adapter-supabase` as the reference implementation
  before starting a new adapter (Firebase, Airtable, Neon, plain Postgres,
  or your own SaaS are all natural next adapters).

## How to add a surface generator or deploy target

**Surface generators** turn a manifest into something agents actually talk
to. They consume `Manifest` from `packages/core` and emit code/config —
`packages/surface-mcp` (remote MCP server) is the reference. To add one
(GraphQL, an A2A surface, REST/OpenAPI, a CLI):

1. Take a validated `Manifest` as input — don't re-derive capabilities from
   a raw backend schema; that's the adapter's job, and doing it again in
   the surface breaks the "manifest is the single source of truth" rule.
2. Generate boring, readable code. The owner will read and own what you
   generate — prefer explicit generated functions over clever runtime
   metaprogramming where you can.
3. Respect every guardrail declared on a capability (rate limits,
   confirmation mode, row caps) in the generated surface itself; don't
   assume the adapter is the only enforcement point — defense in depth.
4. Add fixtures/tests that generate against an example manifest (see
   `examples/`) and assert on the generated output.

**Deploy targets** are a template plus a one-click / CLI deploy recipe for
a host, following `deploy/cloudflare` as the reference:

1. The template should provision the generated surface with the owner's
   backend credentials stored as *that host's* secrets mechanism — never
   sent to or stored by any `everyai-com`-operated service.
2. Provide both a one-click button flow and a documented manual/CLI path,
   since not everyone can or wants to click a hosted button.
3. Document exactly what gets created (Worker, KV namespace, env vars,
   etc.) so a technical user can audit it before deploying.

## RFC process for manifest-spec changes

The capability manifest (`packages/core`, spec documented in
[`docs/manifest-spec.md`](./docs/manifest-spec.md)) is the API of this whole
project — every adapter, surface, and deploy target depends on its shape
staying stable and well-understood. Changes to it go through an RFC, not a
regular PR:

1. Open a GitHub issue titled `RFC: <short description>` describing the
   problem, the proposed change to the manifest shape, backward
   compatibility (is this a v0 → v1 bump, or additive?), and how existing
   adapters/surfaces would need to change.
2. Leave it open for discussion — at minimum a few days, longer for
   breaking changes — before any implementation PR is opened.
3. Once there's rough consensus, the implementation PR should link back to
   the RFC issue and update `docs/manifest-spec.md` in the same PR as the
   code change. Spec and implementation should never drift.

Non-breaking additions to `packages/core` that don't touch the manifest
shape (bug fixes, new validation error messages, performance work) don't
need an RFC — normal PR review is fine.

## Code style

- **Strict TypeScript.** `strict: true` (see `tsconfig.base.json`), no
  `any` as an escape hatch — if you need it, there's usually a better type.
- **ESM only.** No CommonJS `require`; use `import`/`export` throughout.
- **Boring, readable code.** This project's generated output is meant to
  be read and owned by non-experts, and that bar applies to the toolkit's
  own source too: prefer explicit code over clever abstraction, small
  functions with clear names, and comments that explain *why*, not *what*.
- Run `npm run build` and `npm test` before opening a PR — CI runs the
  same on Node 22.
- Keep PRs scoped to one package/concern where possible; it makes review
  (and later, `git blame`) much easier in a monorepo like this.

## Opening a PR

- Reference an issue or RFC if there is one.
- Include or update tests for the behavior you're changing.
- Update relevant docs in the same PR — especially
  `docs/manifest-spec.md` for anything manifest-shaped.
- Small, focused PRs get reviewed faster than big ones.

Thanks again for contributing — this only works as an ecosystem if it's
easy to build on.
