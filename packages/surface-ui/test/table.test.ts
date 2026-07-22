import { describe, it, expect } from "vitest";
import type { ToolResult } from "@agent-ready/core";
import { renderTableHtml } from "../src/render/html/table.js";
import { listPlants } from "./fixtures.js";

describe("renderTableHtml", () => {
  it("is self-contained: no external resources", () => {
    const result: ToolResult = { ok: true, rows: [] };
    const html = renderTableHtml(listPlants, result);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/\bsrc=["']https?:/i);
  });

  it("has no inline event-handler attributes", () => {
    const result: ToolResult = { ok: true, rows: [] };
    const html = renderTableHtml(listPlants, result);
    expect(html).not.toMatch(/\son\w+\s*=/i);
    expect(html).toContain("addEventListener");
  });

  it("inlines the bootstrap data as window.__AGENT_READY_DATA__", () => {
    const result: ToolResult = {
      ok: true,
      rows: [{ id: "1", name: "Monstera", price: 25 }],
      total: 1,
    };
    const html = renderTableHtml(listPlants, result);
    expect(html).toContain("window.__AGENT_READY_DATA__");
    expect(html).toContain('"columns":["id","name","price"]');
    expect(html).toContain('"Monstera"');
    expect(html).toContain('"total":1');
  });

  it("escapes HTML injection attempts in row values so they cannot break out of the script block", () => {
    const malicious = '</script><img src=x onerror=alert(1)>';
    const result: ToolResult = {
      ok: true,
      rows: [{ id: "1", name: malicious, price: 1 }],
    };
    const html = renderTableHtml(listPlants, result);
    // The raw closing-script-tag sequence must never appear verbatim.
    expect(html).not.toContain("</script><img");
    // It should appear only in its escaped form inside the JSON payload.
    expect(html).toContain("\\u003c/script\\u003e");
    expect(html).toContain("onerror=alert(1)");
    // And the data still round-trips as valid JSON once unescaped by JS.
    const match = html.match(/window\.__AGENT_READY_DATA__ = (.*);/);
    expect(match).not.toBeNull();
  });

  it("never renders values via innerHTML — only textContent, so a value like <b>hi</b> stays literal text at runtime", () => {
    const html = renderTableHtml(listPlants, { ok: true, rows: [] });
    expect(html).not.toMatch(/\.innerHTML/);
    expect(html).toContain(".textContent");
  });

  it("shows a truncation note field for the client script to render when truncated", () => {
    const result: ToolResult = {
      ok: true,
      rows: [{ id: "1", name: "Monstera", price: 25 }],
      total: 132,
    };
    const html = renderTableHtml(listPlants, result);
    expect(html).toContain('"total":132');
    expect(html).toContain("Showing \" + rows.length + \" of \" + data.total");
  });

  it("renders an empty payload for a failed result rather than leaking rows", () => {
    const result: ToolResult = { ok: false, error: "denied" };
    const html = renderTableHtml(listPlants, result);
    expect(html).toContain('"rows":[]');
  });
});
