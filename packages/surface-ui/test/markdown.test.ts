import { describe, it, expect } from "vitest";
import type { ToolResult } from "@agent-ready/core";
import { renderResultMarkdown } from "../src/render/markdown.js";
import { listPlants, getPlants, createPlants, updatePlants } from "./fixtures.js";

describe("renderResultMarkdown — list", () => {
  it("renders an honest table with headers from exposed fields", () => {
    const result: ToolResult = {
      ok: true,
      rows: [
        { id: "1", name: "Monstera", price: 25 },
        { id: "2", name: "Pothos", price: 12 },
      ],
    };
    const md = renderResultMarkdown(listPlants, result);
    expect(md).toContain("| id | name | price |");
    expect(md).toContain("| 1 | Monstera | 25 |");
    expect(md).toContain("| 2 | Pothos | 12 |");
  });

  it("shows a 'Showing N of M' note when truncated", () => {
    const result: ToolResult = {
      ok: true,
      rows: [{ id: "1", name: "Monstera", price: 25 }],
      total: 132,
    };
    const md = renderResultMarkdown(listPlants, result);
    expect(md).toContain("_Showing 1 of 132._");
  });

  it("shows a truncated note without a total", () => {
    const result: ToolResult = {
      ok: true,
      rows: [{ id: "1", name: "Monstera", price: 25 }],
      truncated: true,
    };
    const md = renderResultMarkdown(listPlants, result);
    expect(md).toContain("_Showing 1 of more._");
  });

  it("renders an empty-state line for zero rows", () => {
    const result: ToolResult = { ok: true, rows: [] };
    const md = renderResultMarkdown(listPlants, result);
    expect(md).toBe("No plants found.");
  });

  it("truncates long cell values", () => {
    const long = "x".repeat(200);
    const result: ToolResult = {
      ok: true,
      rows: [{ id: "1", name: long, price: 1 }],
    };
    const md = renderResultMarkdown(listPlants, result);
    const nameCellMatch = md.match(/\| 1 \| (.+?) \| 1 \|/);
    expect(nameCellMatch).not.toBeNull();
    expect(nameCellMatch![1].length).toBeLessThan(70);
    expect(nameCellMatch![1].endsWith("…")).toBe(true);
  });

  it("escapes pipes and markdown-significant characters in cell values", () => {
    const result: ToolResult = {
      ok: true,
      rows: [{ id: "1", name: "Fun | Plant `x`", price: 1 }],
    };
    const md = renderResultMarkdown(listPlants, result);
    expect(md).toContain("Fun \\| Plant \\`x\\`");
  });
});

describe("renderResultMarkdown — read", () => {
  it("renders a labeled field list", () => {
    const result: ToolResult = {
      ok: true,
      rows: [{ id: "1", name: "Monstera", price: 25 }],
    };
    const md = renderResultMarkdown(getPlants, result);
    expect(md).toContain("**id:** 1");
    expect(md).toContain("**name:** Monstera");
    expect(md).toContain("**price:** 25");
  });

  it("handles no row found", () => {
    const result: ToolResult = { ok: true, rows: [] };
    const md = renderResultMarkdown(getPlants, result);
    expect(md).toBe("No plants found.");
  });
});

describe("renderResultMarkdown — create/update", () => {
  it("renders a one-line success summary for create", () => {
    const result: ToolResult = {
      ok: true,
      rows: [{ id: "9", name: "Fern", price: 8 }],
    };
    const md = renderResultMarkdown(createPlants, result);
    expect(md).toBe("Created plants (id: 9).");
  });

  it("renders a one-line success summary for update", () => {
    const result: ToolResult = {
      ok: true,
      rows: [{ id: "9", name: "Fern", price: 9 }],
    };
    const md = renderResultMarkdown(updatePlants, result);
    expect(md).toBe("Updated plants (id: 9).");
  });
});

describe("renderResultMarkdown — errors and denials", () => {
  it("renders a plain-language message, never a stack trace", () => {
    const result: ToolResult = {
      ok: false,
      error: "capability 'create_plants' is disabled",
    };
    const md = renderResultMarkdown(createPlants, result);
    expect(md).toBe(
      "Could not complete **create_plants**: capability 'create_plants' is disabled",
    );
    expect(md).not.toMatch(/at .*:\d+:\d+/); // no stack-trace-looking lines
  });

  it("falls back to a generic message when no error text is given", () => {
    const result: ToolResult = { ok: false };
    const md = renderResultMarkdown(listPlants, result);
    expect(md).toBe("Could not complete **list_plants**.");
  });
});
