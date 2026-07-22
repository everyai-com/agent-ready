# The two-step confirmation protocol

Companion to [`docs/host-ui-plan.md`](./host-ui-plan.md) §2.4. This is the
integrator-facing explanation of how `guardrails.requiresConfirmation: true`
behaves at the wire level, for anyone building a client against the MCP
gateway (or reading `@agent-ready/console`'s playground behavior).

## Why

Some hosts have no confirmation UI at all (plain MCP clients, some CLIs).
Rather than trusting the host to ask "are you sure?", the **gateway itself**
never executes a guarded write on the first call — no matter what UI the
caller has. UI-capable hosts layer a nicer dialog on top of this; hosts with
nothing get a working, safe default for free.

## The flow

1. A capability's `guardrails.requiresConfirmation` is `true` in the manifest
   (e.g. `create_order`).
2. The **first** `tools/call` for `create_order` does **not** execute. The
   gateway returns:
   - `content[0].text` — a plain-language preview: "You are about to create a
     **orders** record: - **plant_id:** "abc123" ...".
   - `structuredContent` — `{ preview: <the input you sent>, confirmationToken: "<token>" }`.
   - `isError: false` (this is a normal, successful preview response, not an
     error).
3. `tools/list` additionally exposes a synthetic `confirm_create_order` tool
   whenever `create_order` requires confirmation (and only then — resources
   that don't need confirmation never get a `confirm_*` tool).
4. Call `confirm_create_order` with `{ "confirmationToken": "<token>" }`. The
   gateway verifies the token and, if valid, executes the **original** call
   with the **original**, server-signed input — never values re-supplied at
   confirm time — and returns the normal result shape (markdown +
   `structuredContent`, `isError` reflecting success/failure).

Calling `create_order` (the base tool) any number of times never writes
anything; only a valid `confirm_create_order(token)` does.

## Token properties

- **Single-use.** A token is consumed on first successful verification;
  replaying it is refused with "Confirmation token has already been used."
- **Short-TTL.** Tokens expire 5 minutes after issuance.
- **Bound to the tool.** A token issued for `create_order` will not verify
  against `confirm_create_plant`.
- **Signed.** HMAC-SHA256 over `{ tool, input, exp, nonce }` (WebCrypto). A
  forged or tampered token fails signature verification.
- **Carries its own input.** The token embeds the exact values it was issued
  for; confirming re-executes with those signed values, so a caller can't
  swap in different values between preview and confirm.

## Where the gate lives

The enforcement — "a `requiresConfirmation` capability may not execute
without `identity.confirmed === true`" — lives in **`@agent-ready/core`**
(`executeWithConfirmation` in `src/confirm.ts`), not in either surface. Both
`@agent-ready/surface-mcp` and `@agent-ready/console` call
`executeWithConfirmation` instead of `adapter.execute` directly, so there is
exactly one enforcement path and neither surface can be used to bypass it.
`identity.confirmed` is an internal marker set only by a surface handler
after it has independently verified a `ConfirmationGate` token — it is never
derived from agent- or caller-supplied tool input.

The `@agent-ready/console` Playground does not (yet) implement the two-step
confirm UI: calling a `requiresConfirmation` tool from the playground refuses
with a clear message pointing at this doc, rather than silently no-op'ing or
executing. A future console iteration can add its own confirm step reusing
the same `ConfirmationGate`.

## Deployment note: secrets and multi-isolate

`createMcpHandler({ confirmSecret })` accepts an HMAC secret (e.g. a Worker
secret). If omitted, a random per-instance secret is generated at handler
creation — correct for a single Worker isolate, but it means:

- Tokens issued by one isolate will not verify on another isolate (a
  multi-isolate deployment may see spurious "invalid token" errors for
  requests that land on a different isolate than the one that issued the
  preview).
- Tokens do not survive a redeploy/restart.

For a real deployment with more than one isolate, set `CONFIRM_SECRET` (or
pass `confirmSecret` explicitly) to a stable value.

Single-use enforcement also uses an **in-memory** nonce set scoped to the
handler instance. Same caveat: a multi-isolate deployment needs a shared
store (KV, Durable Object, or similar) to make single-use hold globally —
until then, a token could in principle be replayed once per isolate within
its 5-minute TTL. This is documented, not silently assumed away.
