---
name: Adapter / surface / deploy target proposal
about: Propose a new backend adapter, surface generator, or deploy target
title: "[Adapter] "
labels: adapter
assignees: ''
---

Thanks for thinking about extending agent-ready — this is exactly what the
plugin architecture is for. Fill in whichever section applies.

## What kind of extension is this

- [ ] Backend adapter (e.g. Firebase, Airtable, Neon, plain Postgres, a SaaS)
- [ ] Surface generator (e.g. GraphQL, A2A, a widget)
- [ ] Deploy target (e.g. Fly, Deno Deploy, self-hosted Docker)
- [ ] Policy plugin (guardrails, audit sink, anomaly detection)

## Backend adapter details (if applicable)

- Backend/service name:
- Does it support introspectable schema discovery? How (REST admin API,
  SQL information_schema, SDK reflection, etc.)?
- Does it have a native row/access-control concept (like Supabase RLS)
  your `execute()` could lean on instead of only the service credential?
- Rough sketch of how `introspect()` would map the backend's shape onto
  resources/fields/capabilities (see
  [`docs/manifest-spec.md`](../../docs/manifest-spec.md)).

## Surface generator details (if applicable)

- Target protocol/format:
- Example of what generated output would look like for a small manifest.

## Deploy target details (if applicable)

- Host:
- One-click flow available? (button, CLI, both)
- How are backend secrets stored on this host?

## Are you planning to implement this yourself?

- [ ] Yes, I'd like to open a PR
- [ ] No, flagging it for someone else / discussion first

See [`CONTRIBUTING.md`](../../CONTRIBUTING.md) for the adapter/surface/
deploy-target authoring guides and the plugin interfaces to implement.
