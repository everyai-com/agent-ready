import type { Manifest } from "@agent-ready/core";
import { deriveTools } from "@agent-ready/core";

export const manifest: Manifest = {
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
        { name: "notes", type: "string" },
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
      { verb: "read", enabled: true, exposedFields: ["id", "name", "price"] },
      { verb: "create", enabled: true, exposedFields: ["name", "price"] },
      { verb: "update", enabled: true, exposedFields: ["name", "price"] },
    ],
  },
};

export const tools = deriveTools(manifest);
export const listPlants = tools.find((t) => t.name === "list_plants")!;
export const getPlants = tools.find((t) => t.name === "get_plants")!;
export const createPlants = tools.find((t) => t.name === "create_plants")!;
export const updatePlants = tools.find((t) => t.name === "update_plants")!;
