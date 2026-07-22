# Agent-Ready — Project Plan

> **Mission:** You have a normal product. Make it usable by AI agents — in one click.
> An open-source toolkit that turns any vibe-coded app (Lovable, Bolt, v0, Claude Code)
> into an agent-accessible product: MCP server, clean API, and CLI — generated from the
> backend the app already has, deployed to the user's own account, safe by default.

---

## 1. The target user

- Built an app with **Lovable, Bolt, v0, or Claude Code** — it works, it's live.
- Frontend deployed to **Netlify / Vercel** (Cloudflare Pages occasionally).
- Backend is **Supabase** (most common) or **Convex** — no custom server, no public
  API, no OpenAPI spec, often limited ability to write backend code.
- Wants their product usable *by* AI agents — agents reading data, taking actions,
  acting on behalf of the app's users.

**What they do NOT have:** an API wrapper, middleware they control, or the skills or
desire to hand-write an MCP server. The toolkit must work from backend credentials alone.

## 2. Core insight

There is no API to wrap — but there IS a backend with all the data and logic:

- **Supabase** → introspectable Postgres schema, RLS policies, auth, edge functions.
- **Convex** → introspectable schema + explicit functions (queries/mutations/actions),
  which map almost 1:1 onto MCP tools.

So the product is an **agent gateway generator**: connect your backend → we introspect
it → you choose what agents may do → we generate and deploy your MCP server + API + CLI.

---

## 3. The user journey (the story we tell)

Told from the user's seat. Five steps, each with a clear "what you have now" so the
user always understands what they've got. Target: **under 5 minutes, zero code.**

### Step 0 — Arrive
Maya built a plant-care marketplace on Lovable (React + Supabase), live on Netlify.
She hears "make your product AI-agent ready" and lands on the wizard (hosted, or she
runs it herself — it's open source).

**Screen says:** "Your app has data and actions. AI agents can't see any of it yet.
In 5 minutes they will — and only the parts you choose."

### Step 1 — Connect your backend
She picks "Supabase," follows a screenshot walkthrough to copy her project URL and
service key, and pastes them in. The wizard is explicit about trust: *"Your key is
used in your browser / your deployment only. It is never sent to our servers."*
(OAuth connect later removes even the copy-paste.)

**What you have now:** the tool can see your app's structure — nothing is exposed yet.

### Step 2 — See your app the way an agent would
The wizard introspects and shows a plain-language map: "You have **Plants** (132),
**Orders** (56), **Sellers** (12), **Users** (89)." No SQL, no jargon. Sensitive
things (users, auth, keys, payment fields) are shown locked with an explanation.

**What you have now:** a picture of your product's nouns and verbs — the first time
most vibe-coders ever see their own schema.

### Step 3 — Choose what agents may do (the capability sheet)
Checkbox UI, verbs per noun: *Agents can… browse plants ✅ / see orders ✅ (only their
own) / place an order ☐ (off by default — writes are opt-in) / touch users 🔒 (locked).*
Every toggle has a one-line consequence: "Turning this on lets any connected agent
create rows in Orders."

The output is a **capability manifest** — one readable JSON file that is the single
source of truth for everything generated. Maya can ignore it; developers can edit it.

**What you have now:** a signed-off contract of exactly what agents can and cannot do.

### Step 4 — One click: deploy YOUR gateway
She picks a host (Cloudflare default; Vercel/Netlify equally supported) and clicks
Deploy. The generated gateway — readable, boring code — deploys to **her** account,
with her keys as secrets there. We keep nothing.

**What you have now:** `https://plantshop-agent.workers.dev` — your own live agent
gateway: an MCP endpoint, a REST API with OpenAPI docs, and an installable CLI.

### Step 5 — Connect to agents & watch it work
Final screen: one-click "Add to Claude" / agent deep links, plus copy-paste config
for anything else. A built-in **test chat** ("ask an agent about your products")
proves it works within the same session — the magic moment.

**What you have now:** your product is used by an AI agent, live, in front of you.

### Step 6 — Live with it (the ongoing journey)
The gateway ships with a minimal dashboard: what agents connected, what they called,
what was denied. One-click **pause all agent access** (kill switch). Schema changed?
The wizard diffs and proposes manifest updates — nothing new is ever exposed silently.

---

## 4. Safety model — "safe by default, explicit by choice"

Safety is the product's spine, not a feature. Five layers:

**Layer 1 — Nothing is exposed by default.**
Introspection ≠ exposure. Every capability is opt-in via the manifest. Auth tables,
user PII, secrets/config, payment data: auto-classified and locked behind an extra
"I understand" step. Default posture: read-only.

**Layer 2 — The gateway is a bouncer, not a tunnel.**
The generated server never proxies raw queries. Agents call named tools
(`list_plants`, `create_order`) whose inputs are schema-validated; only manifest-
declared columns are ever selected or returned (PII filtered at the row level).
No raw SQL, no arbitrary filters, no `select *`.

**Layer 3 — Identity: agents act as someone, not as God.**
- v1: gateway-level API keys the owner issues and revokes per agent.
- v2: **OAuth on the MCP server backed by the app's own auth** (Supabase Auth /
  Convex Auth) — the app's end users authorize an agent, and it acts *as that user*,
  with their RLS-scoped rows. The service key never serves agent traffic directly.

**Layer 4 — Writes are a different class of thing.**
Reads and writes are never bundled. Writes are per-action opt-in, with optional
guardrails per action: rate limits, value limits ("orders ≤ $100"), confirmation
mode (agent must present a confirm step), and dry-run. Destructive ops (delete,
bulk update) are off unless explicitly enabled, and soft-delete is preferred.

**Layer 5 — Observability and the kill switch.**
Every call logged (who/what/when/allowed-or-denied) in the user's own deployment.
Dashboard + one-click global pause + per-agent revoke. Prompt-injection stance:
the gateway treats every agent request as untrusted input — validation and
capability checks happen server-side, never trusting the agent's claims.

**Trust architecture (why users can believe us):** open source and auditable;
deploys to *your* account; your keys never touch our servers; generated code is
readable; no runtime dependency on our infrastructure. The hosted wizard is a
convenience, not a requirement — everything runs self-hosted.

---

## 5. Architecture & extensibility — built to be built on

Everything flows from one artifact: the **capability manifest** (open JSON-schema
spec, versioned, documented). Backends produce it; surfaces and hosts consume it.
That contract is what makes the ecosystem pluggable:

```
                    ┌──────────────┐
  backend adapters →│  CAPABILITY  │→ surface generators (MCP / API / CLI / …)
 (Supabase, Convex, │   MANIFEST   │→ deploy targets (CF / Vercel / Netlify / …)
  Firebase, custom) │  (open spec) │→ policy plugins (guardrails, audit, …)
                    └──────────────┘
```

Monorepo:

```
core/                 manifest spec + introspection framework + codegen engine
adapters/
  backend-supabase/   schema/RLS introspection, PostgREST executors
  backend-convex/     function discovery, convex client executors
surfaces/
  mcp/                remote MCP server generator (streamable HTTP, OAuth-ready)
  api/                REST + OpenAPI generator
  cli/                CLI generator
deploy/
  cloudflare/  vercel/  netlify/     templates + one-click deploy buttons
wizard/               the web app (itself deployable anywhere)
docs/                 docs site + per-builder guides (Lovable/Bolt/v0/Claude Code)
```

**Extension points (each a documented plugin interface):**
- **Backend adapters** — implement `introspect() → manifest draft` +
  `execute(tool, input, identity)`. Community adds Firebase, Airtable, Neon,
  Postgres-direct, or their own SaaS.
- **Surface generators** — consume a manifest, emit a surface. Someone could add
  GraphQL, an A2A surface, or a widget.
- **Deploy targets** — a template + button/CLI recipe per host. Fly, Deno Deploy,
  self-hosted Docker are obvious community additions.
- **Policy plugins** — guardrails, audit sinks, anomaly detection.
- **Agent directories** — "connect" deep-link integrations for any agent platform,
  not just ours.

Design rules: generated code is boring and readable (users own it); adapters are
plugins, core stays thin; the manifest spec is the API — stable and versioned.

**Governance for real openness:** Apache-2.0; public RFC process for manifest-spec
changes; CONTRIBUTING + adapter-authoring guide from day one; example "toy adapter"
repo as the template for contributors.

---

## 6. Positioning & differentiation

- Supabase/Convex official MCP servers target **developers managing their project**
  (run SQL, edit schema). Ours is the opposite: **production-facing, capability-
  scoped, end-user-safe** — agents *using* the product, not administering it.
- OpenAPI→MCP converters (Stainless, Speakeasy, …) require an API; our users don't
  have one. We start from the backend itself.
- Tagline: **"Make your product AI-agent ready."** The safety story is the moat:
  the obvious shortcut (pipe an agent straight into the DB) is a disaster; we're
  the safe path that's also the easy path.

## 7. Roadmap

**Phase 1 — prove the loop (MVP)**
- Supabase adapter, read-only; minimal wizard; manifest v0; MCP surface;
  Deploy-to-Cloudflare; "Add to Claude" connect + built-in test chat.
- End-to-end demo with a real Lovable app. Apache-2.0, public repo.

**Phase 2 — writes, identity, more hosts**
- Write actions + guardrails; gateway API keys → OAuth via app auth;
  Convex adapter; Vercel + Netlify deploy targets; audit log + kill switch.

**Phase 3 — full trio + builders**
- REST/OpenAPI + CLI surfaces from the same manifest; `npx agent-ready init`;
  schema-drift diffing; plugin interfaces documented + toy adapter repo.

**Phase 4 — ecosystem**
- Registry/gallery of agent-ready apps; community adapters; per-builder guides;
  hosted wizard; RFC process for the manifest spec.

## 8. Riskiest assumptions (validate first)

1. Schema introspection alone yields genuinely useful agent tools with zero user
   input. → Test on one real Lovable+Supabase app before building the wizard.
2. Non-technical users can safely find/paste a service key. → Screenshot-guided UI
   per builder, or OAuth connect; test with a real vibe-coder.
3. One-click deploy is truly smooth for someone with no Cloudflare account.
   → Dry-run the button flow from a fresh account.
4. The capability wizard is understandable to non-developers. → The plain-language
   noun/verb framing is the bet; usability-test the checkbox screen early.
