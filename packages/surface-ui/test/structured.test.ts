import { describe, it, expect } from "vitest";
import type { ToolResult } from "@agent-ready/core";
import { buildStructuredContent } from "../src/render/structured.js";
import { listPlants, getPlants, createPlants, updatePlants } from "./fixtures.js";

describe("buildStructuredContent — list", () => {
  it("matches the list outputSchema shape and strips non-exposed fields", () => {
    const result: ToolResult = {
      ok: true,
      rows: [{ id: "1", name: "Monstera", price: 25, secret: "nope" }],
      total: 1,
    };
    const content = buildStructuredContent(listPlants, result);
    expect(content).toEqual({
      rows: [{ id: "1", name: "Monstera", price: 25 }],
      total: 1,
    });
  });

  it("carries truncated flag when present", () => {
    const result: ToolResult = {
      ok: true,
      rows: [{ id: "1", name: "Monstera", price: 25 }],
      truncated: true,
    };
    const content = buildStructuredContent(listPlants, result);
    expect(content.truncated).toBe(true);
  });
});

describe("buildStructuredContent — read", () => {
  it("returns the exposed fields directly", () => {
    const result: ToolResult = {
      ok: true,
      rows: [{ id: "1", name: "Monstera", price: 25, secret: "nope" }],
    };
    const content = buildStructuredContent(getPlants, result);
    expect(content).toEqual({ id: "1", name: "Monstera", price: 25 });
  });
});

describe("buildStructuredContent — create/update", () => {
  it("returns { ok, row } for create", () => {
    const result: ToolResult = {
      ok: true,
      rows: [{ id: "9", name: "Fern", price: 8 }],
    };
    const content = buildStructuredContent(createPlants, result);
    expect(content).toEqual({ ok: true, row: { name: "Fern", price: 8 } });
  });

  it("returns { ok: true } with no row when none is given", () => {
    const result: ToolResult = { ok: true };
    const content = buildStructuredContent(updatePlants, result);
    expect(content).toEqual({ ok: true });
  });
});

describe("buildStructuredContent — errors", () => {
  it("returns { ok: false, error }", () => {
    const result: ToolResult = { ok: false, error: "denied" };
    const content = buildStructuredContent(listPlants, result);
    expect(content).toEqual({ ok: false, error: "denied" });
  });
});
