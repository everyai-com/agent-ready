import { describe, it, expect } from "vitest";
import { SupabaseAdapter } from "../src/adapter.js";
import type { Manifest } from "@agent-ready/core";
import { makeFakeFetch, plantRows } from "./fixtures.js";

const manifest: Manifest = {
  version: "v0",
  app: { name: "plantshop", backend: "supabase" },
  resources: [
    {
      name: "plants",
      fields: [
        { name: "id", type: "number" },
        { name: "name", type: "string" },
        { name: "price", type: "number" },
        { name: "secret_note", type: "string", sensitive: true },
      ],
    },
  ],
  capabilities: {
    plants: [
      {
        verb: "list",
        enabled: true,
        exposedFields: ["id", "name", "price"],
        guardrails: { maxRowsPerCall: 100 },
      },
      { verb: "read", enabled: true, exposedFields: ["id", "name", "price"] },
      // create is present but disabled: must be refused.
      { verb: "create", enabled: false, exposedFields: ["name", "price"] },
      { verb: "update", enabled: true, exposedFields: ["name", "price"] },
    ],
  },
};

function adapterWith(routes: Parameters<typeof makeFakeFetch>[0]) {
  const { fetchImpl, calls } = makeFakeFetch(routes);
  const adapter = new SupabaseAdapter({
    url: "https://abc.supabase.co",
    serviceKey: "svc-key",
    fetchImpl,
  });
  return { adapter, calls };
}

describe("SupabaseAdapter.execute — list", () => {
  it("selects only allow-listed columns and applies the row cap", async () => {
    const { adapter, calls } = adapterWith([
      { match: "/rest/v1/plants", json: plantRows },
    ]);
    const res = await adapter.execute(
      { resource: "plants", verb: "list", input: { limit: 500 } },
      manifest,
      {},
    );
    expect(res.ok).toBe(true);
    const url = decodeURIComponent(calls[0].url);
    expect(url).toContain("select=id,name,price");
    // Requested 500 but guardrail caps at 100.
    expect(url).toContain("limit=100");
    // Returned rows are redacted (secret_note never present anyway).
    expect(res.rows?.[0]).toEqual({ id: 1, name: "Fern", price: 12.5 });
  });

  it("applies exact-match filters only for exposed fields", async () => {
    const { adapter, calls } = adapterWith([
      { match: "/rest/v1/plants", json: plantRows },
    ]);
    await adapter.execute(
      {
        resource: "plants",
        verb: "list",
        input: { filters: { name: "Fern", secret_note: "x" } },
      },
      manifest,
      {},
    );
    const url = decodeURIComponent(calls[0].url);
    expect(url).toContain("name=eq.Fern");
    expect(url).not.toContain("secret_note");
  });
});

describe("SupabaseAdapter.execute — read", () => {
  it("filters by id and selects allow-listed columns", async () => {
    const { adapter, calls } = adapterWith([
      { match: "/rest/v1/plants", json: [plantRows[0]] },
    ]);
    const res = await adapter.execute(
      { resource: "plants", verb: "read", input: { id: 1 } },
      manifest,
      {},
    );
    expect(res.ok).toBe(true);
    const url = decodeURIComponent(calls[0].url);
    expect(url).toContain("id=eq.1");
    expect(url).toContain("select=id,name,price");
  });
});

describe("SupabaseAdapter.execute — create", () => {
  it("refuses a disabled create capability without any network call", async () => {
    const { adapter, calls } = adapterWith([]);
    const res = await adapter.execute(
      { resource: "plants", verb: "create", input: { values: { name: "New" } } },
      manifest,
      {},
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain("not enabled");
    expect(calls.length).toBe(0);
  });
});

describe("SupabaseAdapter.execute — update", () => {
  it("PATCHes by id with only allow-listed values", async () => {
    const { adapter, calls } = adapterWith([
      { match: "/rest/v1/plants", json: [{ id: 1, name: "Renamed", price: 9 }] },
    ]);
    const res = await adapter.execute(
      {
        resource: "plants",
        verb: "update",
        input: { id: 1, values: { name: "Renamed", secret_note: "nope" } },
      },
      manifest,
      {},
    );
    expect(res.ok).toBe(true);
    expect(calls[0].method).toBe("PATCH");
    const url = decodeURIComponent(calls[0].url);
    expect(url).toContain("id=eq.1");
    // Body must not carry the non-allow-listed secret_note.
    const body = JSON.parse(calls[0].body!);
    expect(body).toEqual({ name: "Renamed" });
  });
});

describe("SupabaseAdapter.execute — unknown resource", () => {
  it("refuses a verb on a resource with no matching enabled capability", async () => {
    const { adapter } = adapterWith([]);
    const res = await adapter.execute(
      { resource: "orders", verb: "list" },
      manifest,
      {},
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain("not enabled");
  });
});
