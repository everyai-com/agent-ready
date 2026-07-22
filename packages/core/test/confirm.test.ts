import { describe, expect, it, vi } from "vitest";
import {
  ConfirmationGate,
  executeWithConfirmation,
  toolRequiresConfirmation,
} from "../src/confirm.js";
import type { BackendAdapter, Manifest, ToolCall, ToolResult } from "../src/types.js";

const manifest: Manifest = {
  version: "v0",
  app: { name: "plantshop" },
  resources: [{ name: "orders", fields: [{ name: "id", type: "string" }] }],
  capabilities: {
    orders: [
      {
        verb: "create",
        enabled: true,
        exposedFields: ["id"],
        guardrails: { requiresConfirmation: true },
      },
      { verb: "read", enabled: true, exposedFields: ["id"] },
    ],
  },
};

class FakeAdapter implements BackendAdapter {
  calls: ToolCall[] = [];
  async introspect() {
    return { backend: "fake", tables: [] };
  }
  async execute(call: ToolCall): Promise<ToolResult> {
    this.calls.push(call);
    return { ok: true, rows: [{ id: "1" }] };
  }
}

describe("toolRequiresConfirmation", () => {
  it("is true only for the guarded capability", () => {
    expect(toolRequiresConfirmation(manifest, "orders", "create")).toBe(true);
    expect(toolRequiresConfirmation(manifest, "orders", "read")).toBe(false);
  });
});

describe("executeWithConfirmation", () => {
  it("refuses to execute a guarded write without identity.confirmed", async () => {
    const adapter = new FakeAdapter();
    const result = await executeWithConfirmation(
      adapter,
      { resource: "orders", verb: "create", name: "create_orders" },
      { resource: "orders", verb: "create", input: {} },
      manifest,
      {},
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/requires confirmation/i);
    expect(adapter.calls).toHaveLength(0);
  });

  it("executes once identity.confirmed is true", async () => {
    const adapter = new FakeAdapter();
    const result = await executeWithConfirmation(
      adapter,
      { resource: "orders", verb: "create", name: "create_orders" },
      { resource: "orders", verb: "create", input: {} },
      manifest,
      { confirmed: true },
    );
    expect(result.ok).toBe(true);
    expect(adapter.calls).toHaveLength(1);
  });

  it("does not gate a capability without requiresConfirmation", async () => {
    const adapter = new FakeAdapter();
    const result = await executeWithConfirmation(
      adapter,
      { resource: "orders", verb: "read", name: "get_orders" },
      { resource: "orders", verb: "read", input: {} },
      manifest,
      {},
    );
    expect(result.ok).toBe(true);
    expect(adapter.calls).toHaveLength(1);
  });
});

describe("ConfirmationGate", () => {
  it("issues a token that verifies for the same tool and returns the signed input", async () => {
    const gate = new ConfirmationGate("test-secret");
    const token = await gate.issueToken("create_orders", { values: { name: "Monstera" } });
    const result = await gate.verify(token, "create_orders");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.input).toEqual({ values: { name: "Monstera" } });
  });

  it("refuses a token verified against the wrong tool", async () => {
    const gate = new ConfirmationGate("test-secret");
    const token = await gate.issueToken("create_orders", {});
    const result = await gate.verify(token, "create_plants");
    expect(result.ok).toBe(false);
  });

  it("refuses a forged token (bad signature)", async () => {
    const gate = new ConfirmationGate("test-secret");
    const token = await gate.issueToken("create_orders", {});
    const [payload] = token.split(".");
    const forged = `${payload}.not-a-real-signature`;
    const result = await gate.verify(forged, "create_orders");
    expect(result.ok).toBe(false);
  });

  it("refuses a token signed with a different secret", async () => {
    const issuer = new ConfirmationGate("secret-a");
    const verifier = new ConfirmationGate("secret-b");
    const token = await issuer.issueToken("create_orders", {});
    const result = await verifier.verify(token, "create_orders");
    expect(result.ok).toBe(false);
  });

  it("refuses an expired token", async () => {
    vi.useFakeTimers();
    try {
      const gate = new ConfirmationGate("test-secret");
      const token = await gate.issueToken("create_orders", {});
      vi.advanceTimersByTime(6 * 60 * 1000);
      const result = await gate.verify(token, "create_orders");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/expired/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a reused (already-consumed) token", async () => {
    const gate = new ConfirmationGate("test-secret");
    const token = await gate.issueToken("create_orders", {});
    const first = await gate.verify(token, "create_orders");
    expect(first.ok).toBe(true);
    const second = await gate.verify(token, "create_orders");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/already been used/i);
  });

  it("refuses a malformed token", async () => {
    const gate = new ConfirmationGate("test-secret");
    const result = await gate.verify("not-a-token", "create_orders");
    expect(result.ok).toBe(false);
  });
});
