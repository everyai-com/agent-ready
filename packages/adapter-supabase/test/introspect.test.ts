import { describe, it, expect } from "vitest";
import { parseSwagger, toFieldType } from "../src/swagger.js";
import { SupabaseAdapter } from "../src/adapter.js";
import { draftManifest } from "@agent-ready/core";
import { fakeSwagger, makeFakeFetch } from "./fixtures.js";

describe("toFieldType", () => {
  it("maps postgres formats to normalized types", () => {
    expect(toFieldType({ type: "integer", format: "bigint" })).toBe("number");
    expect(toFieldType({ type: "number", format: "numeric" })).toBe("number");
    expect(toFieldType({ type: "boolean" })).toBe("boolean");
    expect(toFieldType({ type: "string", format: "text" })).toBe("string");
    expect(
      toFieldType({ type: "string", format: "timestamp with time zone" }),
    ).toBe("datetime");
    expect(toFieldType({ type: "string", format: "jsonb" })).toBe("json");
    expect(toFieldType({})).toBe("unknown");
  });
});

describe("parseSwagger", () => {
  const intro = parseSwagger(fakeSwagger, { appName: "plantshop" });

  it("skips rpc definitions and keeps tables", () => {
    const names = intro.tables.map((t) => t.name);
    expect(names).toEqual(["plants", "users"]);
  });

  it("parses columns with normalized types", () => {
    const plants = intro.tables.find((t) => t.name === "plants")!;
    expect(plants.columns).toContainEqual({
      name: "created_at",
      type: "datetime",
      nullable: true,
    });
    expect(plants.columns).toContainEqual({
      name: "id",
      type: "number",
      nullable: false,
    });
  });

  it("carries backend + appName through", () => {
    expect(intro.backend).toBe("supabase");
    expect(intro.appName).toBe("plantshop");
  });
});

describe("SupabaseAdapter.introspect", () => {
  it("fetches the openapi doc and yields an introspection that drafts safely", async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      { match: "/rest/v1/", json: fakeSwagger },
    ]);
    const adapter = new SupabaseAdapter({
      url: "https://abc.supabase.co/",
      serviceKey: "svc-key",
      appName: "plantshop",
      fetchImpl,
    });
    const intro = await adapter.introspect();
    expect(intro.tables.map((t) => t.name)).toEqual(["plants", "users"]);

    // The request carried the apikey + bearer auth headers.
    expect(calls[0].url).toBe("https://abc.supabase.co/rest/v1/");
    expect(calls[0].headers.apikey).toBe("svc-key");
    expect(calls[0].headers.Authorization).toBe("Bearer svc-key");

    // And the draft locks the sensitive `users` table.
    const manifest = draftManifest(intro);
    expect(manifest.capabilities.users.every((c) => c.locked)).toBe(true);
    expect(
      manifest.capabilities.plants.find((c) => c.verb === "list")!.enabled,
    ).toBe(true);
  });
});
