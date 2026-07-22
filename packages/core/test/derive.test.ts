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

describe("deriveTools outputSchema", () => {
  const tools = deriveTools(manifest);

  it("shapes list output as rows/total/truncated over exposed fields", () => {
    const list = tools.find((t) => t.name === "list_plants")!;
    expect(list.outputSchema.type).toBe("object");
    expect(list.outputSchema.required).toEqual(["rows"]);
    const rows = list.outputSchema.properties.rows as {
      type: string;
      items: { properties: Record<string, unknown>; required: string[] };
    };
    expect(rows.type).toBe("array");
    expect(Object.keys(rows.items.properties)).toEqual(["id", "name", "price"]);
    expect(rows.items.properties.price).toEqual({ type: "number" });
    expect(list.outputSchema.properties.total).toEqual({ type: "number" });
    expect(list.outputSchema.properties.truncated).toEqual({ type: "boolean" });
  });

  it("shapes read output as the exposed fields directly", () => {
    const read = tools.find((t) => t.name === "get_plants")!;
    expect(Object.keys(read.outputSchema.properties)).toEqual(["id", "name"]);
    expect(read.outputSchema.required).toEqual(["id", "name"]);
  });

  it("shapes create/update output as { ok, row }", () => {
    const create = tools.find((t) => t.name === "create_orders")!;
    expect(Object.keys(create.outputSchema.properties)).toEqual(["ok", "row"]);
    expect(create.outputSchema.required).toEqual(["ok"]);
    const row = create.outputSchema.properties.row as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(row.properties)).toEqual(["total"]);

    const update = tools.find((t) => t.name === "update_orders")!;
    expect(Object.keys(update.outputSchema.properties)).toEqual(["ok", "row"]);
  });

  it("maps datetime fields to string with date-time format", () => {
    const m = {
      ...manifest,
      resources: [
        {
          name: "events",
          fields: [
            { name: "id", type: "string" as const },
            { name: "startsAt", type: "datetime" as const },
            { name: "meta", type: "json" as const },
          ],
        },
      ],
      capabilities: {
        events: [
          {
            verb: "list" as const,
            enabled: true,
            exposedFields: ["id", "startsAt", "meta"],
          },
        ],
      },
    };
    const [listEvents] = deriveTools(m);
    const rows = listEvents.outputSchema.properties.rows as {
      items: { properties: Record<string, unknown> };
    };
    expect(rows.items.properties.startsAt).toEqual({
      type: "string",
      format: "date-time",
    });
    expect(rows.items.properties.meta).toEqual({ type: "object" });
  });
});
