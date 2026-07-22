import { describe, it, expect } from "vitest";
import { redactRow, redactRows } from "../src/redact.js";
import type { Capability } from "../src/types.js";

const cap: Capability = {
  verb: "list",
  enabled: true,
  exposedFields: ["id", "name"],
};

describe("redactRow", () => {
  it("keeps only allow-listed fields", () => {
    const row = { id: "1", name: "Fern", password: "secret", ssn: "x" };
    expect(redactRow(row, cap)).toEqual({ id: "1", name: "Fern" });
  });

  it("omits allow-listed fields absent from the row (no undefined keys)", () => {
    const out = redactRow({ id: "1" }, cap);
    expect(out).toEqual({ id: "1" });
    expect("name" in out).toBe(false);
  });

  it("returns empty object when nothing is allow-listed", () => {
    const out = redactRow({ id: "1", name: "x" }, {
      ...cap,
      exposedFields: [],
    });
    expect(out).toEqual({});
  });

  it("redactRows maps over a list", () => {
    const rows = [
      { id: "1", name: "A", secret: "s" },
      { id: "2", name: "B", secret: "s" },
    ];
    expect(redactRows(rows, cap)).toEqual([
      { id: "1", name: "A" },
      { id: "2", name: "B" },
    ]);
  });
});
