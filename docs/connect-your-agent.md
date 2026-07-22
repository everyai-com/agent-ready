# Connect your agent

Once your gateway is deployed (see the [root README](../README.md) for the
5-minute journey), you have a live URL like:

```
https://plantshop-agent.workers.dev
```

That URL serves a remote MCP endpoint (streamable HTTP), plus a REST API
and OpenAPI docs as later surfaces come online. This page covers connecting
the MCP endpoint to Claude and to any other MCP-speaking agent.

Every capability an agent can see through this connection is exactly what
you enabled in your capability manifest — nothing more. See
[`docs/manifest-spec.md`](./manifest-spec.md) if you want to know precisely
what's exposed, and [`SECURITY.md`](../SECURITY.md) for the safety model
behind it.

## Claude.ai — custom connector

1. In claude.ai, go to **Settings → Connectors**.
2. Click **Add custom connector**.
3. Paste your gateway's MCP URL, e.g. `https://plantshop-agent.workers.dev/mcp`.
4. Give it a name (e.g. "Plant Shop") and save.
5. If your gateway requires an API key (v1 identity model — see
   [`SECURITY.md`](../SECURITY.md)), you'll be prompted for it here; paste
   the key you issued from your gateway's dashboard.
6. Start a new chat, open the connector picker, and enable it for that
   conversation.

Claude will now see exactly the tools your manifest enables — e.g.
`list_plants`, `get_order`, `create_order` — each described with the
guardrails you set (row limits, confirmation requirements, etc.).

## Claude Code — CLI

```bash
claude mcp add --transport http plant-shop https://plantshop-agent.workers.dev/mcp
```

If your gateway requires an API key, pass it as a header:

```bash
claude mcp add --transport http plant-shop https://plantshop-agent.workers.dev/mcp \
  --header "Authorization: Bearer <your-gateway-api-key>"
```

Verify it's connected:

```bash
claude mcp list
```

Then start `claude` and ask it something your manifest allows — e.g. "list
the plants under $20."

## Generic MCP config (any MCP-compatible agent)

Most other MCP clients (desktop agent apps, custom harnesses, other
IDE integrations) accept a JSON config block along these lines:

```jsonc
{
  "mcpServers": {
    "plant-shop": {
      "url": "https://plantshop-agent.workers.dev/mcp",
      "transport": "http",
      "headers": {
        "Authorization": "Bearer <your-gateway-api-key>"
      }
    }
  }
}
```

- `url` — your gateway's MCP endpoint (from the deploy step).
- `transport` — `"http"` (streamable HTTP); this is a remote server, not a
  local stdio process, so there's nothing to install beyond the client
  itself.
- `headers.Authorization` — omit this whole block if your gateway doesn't
  require an API key yet (e.g. a first read-only test deploy); include it
  once you've issued a key from your gateway's dashboard.

Consult your specific agent platform's docs for exactly where this config
block goes — the shape above is the common denominator across MCP clients.

## Proving it works

Before wiring up a real agent, use the built-in test chat on your gateway's
final setup screen ("ask an agent about your products") — it exercises the
same MCP endpoint you just connected, so if it works there, it'll work in
Claude or any other client.

## Revoking access

Every API key is issued and revocable per agent from your gateway's
dashboard. If you ever want to cut off all agent access at once, the
dashboard's kill switch pauses the gateway entirely — no code changes,
no redeploy. See [`PLAN.md`](../PLAN.md) section 4 (Layer 5) for details.
