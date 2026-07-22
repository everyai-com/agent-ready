import { describe, it, expect } from "vitest";
import { validateManifest } from "../src/validate.js";
import type { Manifest } from "../src/types.js";

const validManifest: Manifest = {
  version: "v0",
  app: { name: "plantshop", backend: "supabase" },
  resources: [
    {
      name: "plants",
      label: "Plants",
      fields: [
        { name: "id", type: "string" },
        { name: "name", type: "string" },
        { name: "price", type: "number" },
      ],
    },
  ],
  capabilities: {
    plants: [
      { verb: "list", enabled: true, exposedFields: ["id", "name", "price"] },
    ],
  },
};

describe("validateManifest", () => {
  it("accepts a well-formed manifest", () => {
    const res = validateManifest(validManifest);
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
    if (res.ok) expect(res.manifest.app.name).toBe("plantshop");
  });

  it("rejects a non-object", () => {
    expect(validateManifest(null).ok).toBe(false);
    expect(validateManifest("nope").ok).toBe(false);
  });

  it("rejects a wrong version", () => {
    const res = validateManifest({ ...validManifest, version: "v1" });
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes("version"))).toBe(true);
  });

  it("rejects missing app.name", () => {
    const res = validateManifest({ ...validManifest, app: {} });
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes("app.name"))).toBe(true);
  });

  it("rejects capabilities referencing an unknown resource", () => {
    const res = validateManifest({
      ...validManifest,
      capabilities: {
        orders: [{ verb: "list", enabled: true, exposedFields: [] }],
      },
    });
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes("unknown resource"))).toBe(true);
  });

  it("rejects an exposed field that does not exist on the resource", () => {
    const res = validateManifest({
      ...validManifest,
      capabilities: {
        plants: [
          { verb: "list", enabled: true, exposedFields: ["id", "ssn"] },
        ],
      },
    });
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes("not a field"))).toBe(true);
  });

  it("rejects an invalid verb and non-boolean enabled", () => {
    const res = validateManifest({
      ...validManifest,
      capabilities: {
        plants: [{ verb: "destroy", enabled: "yes", exposedFields: [] }],
      },
    });
    expect(res.ok).toBe(false);
    expect(res.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects a bad field type", () => {
    const res = validateManifest({
      ...validManifest,
      resources: [
        { name: "plants", fields: [{ name: "id", type: "uuid" }] },
      ],
      capabilities: {},
    });
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes(".type"))).toBe(true);
  });

  it("rejects duplicate resource names", () => {
    const res = validateManifest({
      ...validManifest,
      resources: [
        { name: "plants", fields: [] },
        { name: "plants", fields: [] },
      ],
      capabilities: {},
    });
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes("duplicated"))).toBe(true);
  });

  it("rejects a bad guardrail value", () => {
    const res = validateManifest({
      ...validManifest,
      capabilities: {
        plants: [
          {
            verb: "list",
            enabled: true,
            exposedFields: ["id"],
            guardrails: { maxRowsPerCall: 0 },
          },
        ],
      },
    });
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes("maxRowsPerCall"))).toBe(true);
  });
});
