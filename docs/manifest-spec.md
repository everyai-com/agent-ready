# Capability manifest — v0 spec

The capability manifest is the single source of truth for an agent-ready
gateway. A backend adapter produces a draft of it by introspecting a real
backend; the owner edits it (by hand, or through the wizard's checkbox UI);
and every surface generator (MCP, REST, CLI) and every deploy target
consumes the same manifest to produce a gateway. Nothing is exposed to an
agent that isn't declared here.

This document describes the **v0** shape. It is a plain JSON document —
readable without tooling, diffable in a PR, and safe for a non-technical
owner to skim even if they never open it directly.

Changes to this spec go through the RFC process described in
[`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Top level

```jsonc
{
  "manifestVersion": "0",
  "app": {
    "name": "Maya's Plant Shop",
    "backend": "supabase"
  },
  "resources": [ /* see below */ ],
  "defaults": {
    "sensitiveLocked": true,
    "writesEnabled": false
  }
}
```

| Field | Meaning |
|---|---|
| `manifestVersion` | Spec version this document conforms to. Surface/adapter code checks this before trusting the shape. |
| `app.name` | Human-readable app name, shown in the wizard and in generated tool descriptions. |
| `app.backend` | Which adapter produced/executes this manifest (`"supabase"`, `"convex"`, ...). |
| `resources` | The nouns of the product — tables/collections and what agents may do with each. |
| `defaults` | Global posture. In v0 these are always `sensitiveLocked: true` and `writesEnabled: false` — safe by default is not optional. |

## Resources

A **resource** is one noun in the product — a table, collection, or entity
group. Each resource declares its fields and the capabilities (verbs)
available on it.

```jsonc
{
  "id": "plants",
  "label": "Plants",
  "source": { "table": "plants" },
  "sensitive": false,
  "fields": [ /* see below */ ],
  "capabilities": { /* see below */ }
}
```

| Field | Meaning |
|---|---|
| `id` | Stable, machine-readable identifier. Used to derive tool names (`list_plants`). Never changes once agents depend on it — renaming a resource is a breaking manifest change. |
| `label` | Plain-language name shown in the wizard's noun/verb screen and in generated docs. |
| `source` | Where this resource comes from in the backend (table name, Convex module, etc.) — adapter-specific shape. |
| `sensitive` | Whether the *resource as a whole* is auto-classified sensitive (see below). A sensitive resource's capabilities default to locked and require an explicit "I understand" step to enable. |
| `fields` | The columns/properties on this resource and their own classification. |
| `capabilities` | The verbs agents may perform on this resource, each individually opt-in. |

### Fields

```jsonc
{ "name": "id", "type": "uuid", "sensitive": false }
{ "name": "email", "type": "text", "sensitive": true, "reason": "pii" }
{ "name": "service_role_notes", "type": "text", "sensitive": true, "reason": "secret" }
```

| Field | Meaning |
|---|---|
| `name` | Column/property name as it exists in the backend. |
| `type` | Backend type, carried through so generated tool schemas are accurate (`uuid`, `text`, `integer`, `timestamptz`, `boolean`, `jsonb`, ...). |
| `sensitive` | Whether this individual field is locked, independent of whether the resource itself is sensitive. A non-sensitive resource can still have individual sensitive columns (e.g. `orders.buyer_email`). |
| `reason` | Why it was auto-classified sensitive: `"pii"`, `"auth"`, `"secret"`, or `"payment"`. Shown to the owner so the lock makes sense instead of feeling arbitrary. |

Only fields explicitly listed (and not `sensitive: true` while still
locked) are ever selected or returned by a generated tool. A capability
cannot reach into a column that isn't declared on its resource — this is
what "only manifest-declared columns are ever selected or returned" (see
[`SECURITY.md`](../SECURITY.md)) means concretely.

### Sensitive classification

During introspection, an adapter auto-classifies:

- **Auth tables** (`auth.*`, `users`, session/token tables) → resource-level
  `sensitive: true`, `reason: "auth"`.
- **PII-shaped fields** (email, phone, physical address, full name adjacent
  to auth) → field-level `sensitive: true`, `reason: "pii"`.
- **Secrets/config** (API keys, service-role artifacts, webhook secrets) →
  `sensitive: true`, `reason: "secret"`.
- **Payment data** (card numbers, bank details, payment-processor tokens) →
  `sensitive: true`, `reason: "payment"`.

Sensitive resources and fields start **locked**: no capability that touches
them can be turned on without the owner passing through an explicit
confirmation step in the wizard (or, editing by hand, setting `sensitive`
to `false` deliberately). Locking is conservative on purpose — a
false-positive lock costs the owner one extra click; a false-negative would
expose real user data.

## Capabilities

A resource's `capabilities` object declares which verbs are enabled, each
with its own guardrails. Every capability is opt-in; an absent capability
means agents cannot do that at all.

```jsonc
"capabilities": {
  "list": {
    "enabled": true,
    "fields": ["id", "name", "price_cents", "seller_id"],
    "guardrails": { "maxRowsPerCall": 50 }
  },
  "read": {
    "enabled": true,
    "fields": ["id", "name", "description", "price_cents", "seller_id", "photo_url"]
  },
  "create": {
    "enabled": false
  },
  "update": {
    "enabled": false
  }
}
```

| Capability | Meaning |
|---|---|
| `list` | Return multiple rows, optionally filtered/paginated. Read-class. |
| `read` | Return a single row by id. Read-class. |
| `create` | Insert a new row. Write-class — **off by default**, must be explicitly enabled. |
| `update` | Modify an existing row. Write-class — **off by default**, must be explicitly enabled. |

v0 intentionally does not include `delete` or bulk-update as first-class
capabilities — per the safety model, destructive operations are treated as
an even more restricted case than ordinary writes and are not part of the
default capability vocabulary. An adapter/surface that wants to support
deletion should model it as a `create`-class capability on a `deleted_at`
soft-delete field, not as raw row deletion.

Each capability entry:

| Field | Meaning |
|---|---|
| `enabled` | Whether agents can invoke this verb at all. Reads default to available-but-still-must-be-turned-on in the wizard; writes default to `false` and are visually distinguished as "off by default — writes are opt-in." |
| `fields` | Which fields this specific capability may read or write — a subset of the resource's `fields`, and never including a field marked `sensitive: true` unless the owner has explicitly unlocked it. |
| `guardrails` | Optional limits, see below. |

### Guardrails

Guardrails attach to an individual capability, not the whole resource —
`orders.create` can carry different limits than `orders.list`.

```jsonc
"guardrails": {
  "maxRowsPerCall": 25,
  "rateLimitPerMinute": 10,
  "requiresConfirmation": true,
  "maxValueCents": 10000
}
```

| Guardrail | Applies to | Meaning |
|---|---|---|
| `maxRowsPerCall` | `list` | Hard cap on rows returned in one call, enforced server-side regardless of what the agent requests. |
| `rateLimitPerMinute` | any | Max invocations of this specific capability per calling identity per minute. |
| `requiresConfirmation` | write capabilities | The agent must present a confirmation step (a human-in-the-loop pattern at the surface level) before the call executes for real; supports a dry-run response first. |
| `maxValueCents` (or other domain-specific value caps) | write capabilities on numeric fields | Refuses the call if a declared value field exceeds the cap — e.g. "orders ≤ $100." Adapters/surfaces may define additional value-shaped guardrails; this is the pattern, not an exhaustive list. |

Guardrails are enforced by the backend adapter's `execute()` (see
[`CONTRIBUTING.md`](../CONTRIBUTING.md)) and, defensively, again by the
surface generator — never only by the agent-facing description text.

## Locked defaults, summarized

- `defaults.sensitiveLocked` is always `true` in v0: sensitive
  resources/fields start locked and need an explicit unlock.
- `defaults.writesEnabled` is always `false` in v0: `create`/`update` start
  disabled on every resource, regardless of sensitivity.
- Introspection produces a **draft**; it never itself flips these
  defaults. Only an explicit owner action — through the wizard checkboxes,
  or a hand-edit to the JSON — turns a capability on.

## Full example: Maya's plant shop

This is the manifest for the plant-care marketplace from the project story
in [`PLAN.md`](../PLAN.md) — a Supabase backend with `plants`, `orders`,
`sellers`, and `users` tables. It reflects a reasonable Step 3 outcome:
browsing is on, orders are readable (scoped to the caller), placing an
order is on with guardrails, and the `users` table stays locked.

```jsonc
{
  "manifestVersion": "0",
  "app": {
    "name": "Maya's Plant Shop",
    "backend": "supabase"
  },
  "resources": [
    {
      "id": "plants",
      "label": "Plants",
      "source": { "table": "plants" },
      "sensitive": false,
      "fields": [
        { "name": "id", "type": "uuid", "sensitive": false },
        { "name": "name", "type": "text", "sensitive": false },
        { "name": "description", "type": "text", "sensitive": false },
        { "name": "price_cents", "type": "integer", "sensitive": false },
        { "name": "photo_url", "type": "text", "sensitive": false },
        { "name": "seller_id", "type": "uuid", "sensitive": false },
        { "name": "created_at", "type": "timestamptz", "sensitive": false }
      ],
      "capabilities": {
        "list": {
          "enabled": true,
          "fields": ["id", "name", "price_cents", "photo_url", "seller_id"],
          "guardrails": { "maxRowsPerCall": 50 }
        },
        "read": {
          "enabled": true,
          "fields": ["id", "name", "description", "price_cents", "photo_url", "seller_id", "created_at"]
        },
        "create": { "enabled": false },
        "update": { "enabled": false }
      }
    },
    {
      "id": "sellers",
      "label": "Sellers",
      "source": { "table": "sellers" },
      "sensitive": false,
      "fields": [
        { "name": "id", "type": "uuid", "sensitive": false },
        { "name": "shop_name", "type": "text", "sensitive": false },
        { "name": "bio", "type": "text", "sensitive": false },
        { "name": "contact_email", "type": "text", "sensitive": true, "reason": "pii" }
      ],
      "capabilities": {
        "list": {
          "enabled": true,
          "fields": ["id", "shop_name"],
          "guardrails": { "maxRowsPerCall": 50 }
        },
        "read": {
          "enabled": true,
          "fields": ["id", "shop_name", "bio"]
        },
        "create": { "enabled": false },
        "update": { "enabled": false }
      }
    },
    {
      "id": "orders",
      "label": "Orders",
      "source": { "table": "orders" },
      "sensitive": false,
      "fields": [
        { "name": "id", "type": "uuid", "sensitive": false },
        { "name": "plant_id", "type": "uuid", "sensitive": false },
        { "name": "buyer_id", "type": "uuid", "sensitive": false },
        { "name": "buyer_email", "type": "text", "sensitive": true, "reason": "pii" },
        { "name": "quantity", "type": "integer", "sensitive": false },
        { "name": "total_cents", "type": "integer", "sensitive": false },
        { "name": "status", "type": "text", "sensitive": false },
        { "name": "shipping_address", "type": "text", "sensitive": true, "reason": "pii" },
        { "name": "created_at", "type": "timestamptz", "sensitive": false }
      ],
      "capabilities": {
        "list": {
          "enabled": true,
          "fields": ["id", "plant_id", "quantity", "total_cents", "status", "created_at"],
          "guardrails": { "maxRowsPerCall": 25, "rateLimitPerMinute": 30 }
        },
        "read": {
          "enabled": true,
          "fields": ["id", "plant_id", "quantity", "total_cents", "status", "created_at"]
        },
        "create": {
          "enabled": true,
          "fields": ["plant_id", "quantity"],
          "guardrails": {
            "rateLimitPerMinute": 5,
            "requiresConfirmation": true,
            "maxValueCents": 10000
          }
        },
        "update": { "enabled": false }
      }
    },
    {
      "id": "users",
      "label": "Users",
      "source": { "table": "users" },
      "sensitive": true,
      "reason": "auth",
      "fields": [
        { "name": "id", "type": "uuid", "sensitive": false },
        { "name": "email", "type": "text", "sensitive": true, "reason": "pii" },
        { "name": "hashed_password", "type": "text", "sensitive": true, "reason": "auth" },
        { "name": "stripe_customer_id", "type": "text", "sensitive": true, "reason": "payment" }
      ],
      "capabilities": {
        "list": { "enabled": false },
        "read": { "enabled": false },
        "create": { "enabled": false },
        "update": { "enabled": false }
      }
    }
  ],
  "defaults": {
    "sensitiveLocked": true,
    "writesEnabled": false
  }
}
```

Notice what this manifest does and doesn't allow: agents can browse and
read plants and sellers, list and read orders (with row caps and rate
limits), and place a new order within a guardrailed value cap that requires
a confirmation step. The `users` resource stays fully locked — sensitive by
default, every capability off — exactly the outcome Step 3 of the wizard
walkthrough in [`PLAN.md`](../PLAN.md) describes.
