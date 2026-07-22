import { describe, it, expect } from "vitest";
import { deriveTools, toolName } from "../src/derive.js";
import type { Manifest } from "../src/types.js";

const manifest: Manifest = {
  version: "v0",
  app: { name: "plantshop" },
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
    {
      name: "orders",
      label: "Orders",
      fields: [
        { name: "id", type: "string" },
        { name: "total", type: "number" },
      ],
    },
  ],
  capabilities: {
    plants: [
      {
        verb: "list",
        enabled: true,
        exposedFields: ["id", "name", "price"],
        guardrails: { maxRowsPerCall: 50 },
      },
      { verb: "read", enabled: true, exposedFields: ["id", "name"] },
      { verb: "create", enabled: false, exposedFields: ["name"] },
    ],
    orders: [
      { verb: "create", enabled: true, exposedFields: ["total"] },
      { verb: "update", enabled: true, exposedFields: ["total"] },
    ],
  },
};

describe("toolName", () => {
  it("names tools by verb and resource", () => {
    expect(toolName("list", "plants")).toBe("list_plants");
    expect(toolName("read", "plants")).toBe("get_plants");
    expect(toolName("create", "orders")).toBe("create_orders");
  });
});

describe("deriveTools", () => {
  const tools = deriveTools(manifest);
  const names = tools.map((t) => t.name);

  it("derives tools only for enabled capabilities", () => {
    expect(names).toContain("list_plants");
    expect(names).toContain("get_plants");
    expect(names).toContain("create_orders");
    expect(names).toContain("update_orders");
    expect(names).not.toContain("create_plants"); // disabled
  });

  it("builds a bounded list input schema with filters over exposed fields", () => {
    const list = tools.find((t) => t.name === "list_plants")!;
    expect(list.inputSchema.properties.limit).toMatchObject({ maximum: 50 });
    const filters = list.inputSchema.properties.filters as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(filters.properties)).toEqual(["id", "name", "price"]);
  });

  it("requires id for read", () => {
    const read = tools.find((t) => t.name === "get_plants")!;
    expect(read.inputSchema.required).toContain("id");
  });

  it("requires values for create and id+values for update", () => {
    const create = tools.find((t) => t.name === "create_orders")!;
    expect(create.inputSchema.required).toEqual(["values"]);
    const update = tools.find((t) => t.name === "update_orders")!;
    expect(update.inputSchema.required).toEqual(["id", "values"]);
  });

  it("carries resource/verb back-references for the executor", () => {
    const list = tools.find((t) => t.name === "list_plants")!;
    expect(list.resource).toBe("plants");
    expect(list.verb).toBe("list");
  });
});
