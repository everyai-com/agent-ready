# Security Policy

agent-ready generates a gateway that sits between AI agents and a real product's
real data. We take its security seriously, and we'd rather hear about a problem
privately than have it found for us.

## Threat model

This is the short version of the safety model described in full in
[`PLAN.md`](./PLAN.md) (section 4) and [`docs/manifest-spec.md`](./docs/manifest-spec.md).
It's the lens we use when reviewing any change to `packages/core`,
`packages/adapter-*`, `packages/surface-*`, or `deploy/*`.

**The gateway is a bouncer, not a tunnel.** The generated server never proxies
raw queries. Agents call named tools (`list_plants`, `create_order`) with
schema-validated inputs; only the columns declared in the capability manifest
are ever selected or returned. There is no raw SQL, no arbitrary filter
injection, and no `select *` path from an agent to the database, ever.

**Nothing is exposed by default.** Introspecting a backend is not the same as
exposing it. Every table, column, and action a gateway can touch has to be
explicitly turned on in the manifest. Auth tables, PII, secrets, and payment
data are auto-classified as sensitive and locked behind an extra confirmation
step. The default posture for everything is read-only.

**Agents act as someone, not as God.** v1 uses gateway-level API keys the
owner issues and can revoke per agent. v2 layers in OAuth backed by the app's
own auth (Supabase Auth / Convex Auth), so an agent acts as the authorizing
end user, scoped by that user's own row-level security — never with the raw
service key.

**Writes are a different class of thing from reads.** Write actions are
opt-in per action, not bundled with reads, and can carry guardrails:
`maxRowsPerCall`, `rateLimitPerMinute`, `requiresConfirmation`, value limits.
Destructive operations (delete, bulk update) are off unless explicitly
enabled, and soft-delete is the recommended default.

**All agent input is untrusted input.** The gateway treats every request
from an agent — including tool arguments, headers, and any claims the agent
makes about itself — as untrusted. Prompt-injection-style content arriving
through an agent conversation is not a trust signal; validation and
capability checks happen server-side and never rely on the agent's own
assertions about what it's allowed to do.

**Nothing runs through our infrastructure.** A deployed gateway lives in the
user's own Cloudflare/Vercel/Netlify account, with their own secrets. We
never see backend credentials, and there's no runtime dependency on any
`everyai-com`-operated service. This is what makes the open-source promise
meaningful: you can audit exactly what's deployed, because it's the same
code running on your account.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for a security vulnerability.

Instead, use GitHub's private vulnerability reporting:

1. Go to the [Security tab](https://github.com/everyai-com/agent-ready/security)
   of the `everyai-com/agent-ready` repository.
2. Click **"Report a vulnerability"** to open a private draft security advisory.
3. Include what you found, the affected package/version, reproduction steps,
   and (if you have one) an idea of the impact — e.g. "an agent could read
   locked/sensitive columns" or "a manifest guardrail can be bypassed."

If GitHub private advisories aren't available to you for some reason, email
the maintainers listed in the repository's `MAINTAINERS` file (or open a
minimal public issue asking for a private contact — do not include exploit
details in that issue).

We'll acknowledge reports as promptly as we can, work with you on a fix, and
credit you in the advisory unless you'd prefer otherwise. Please give us a
reasonable window to ship a fix before any public disclosure.

## Scope

In scope: anything in this monorepo — the manifest spec and validation
(`packages/core`), backend adapters (`packages/adapter-*`), surface
generators (`packages/surface-*`), and deploy templates (`deploy/*`) —
particularly anything that could let an agent read or write data outside
what the capability manifest declares, bypass a guardrail, or exfiltrate a
backend credential.

Out of scope: vulnerabilities in Supabase, Convex, Cloudflare, or other
third-party services themselves — please report those to the respective
vendor.
