import { describe, it, expect } from "vitest";
import {
  draftManifest,
  isSensitiveField,
  isSensitiveResource,
} from "../src/draft.js";
import { validateManifest } from "../src/validate.js";
import type { Introspection } from "../src/types.js";

const introspection: Introspection = {
  backend: "supabase",
  appName: "plantshop",
  tables: [
    {
      name: "plants",
      approximateRows: 132,
      columns: [
        { name: "id", type: "string" },
        { name: "name", type: "string" },
        { name: "price", type: "number" },
      ],
    },
    {
      name: "users",
      approximateRows: 89,
      columns: [
        { name: "id", type: "string" },
        { name: "email", type: "string" },
        { name: "password_hash", type: "string" },
      ],
    },
  ],
};

describe("sensitive classification", () => {
  it("classifies sensitive resource names", () => {
    expect(isSensitiveResource("users")).toBe(true);
    expect(isSensitiveResource("auth_tokens")).toBe(true);
    expect(isSensitiveResource("payments")).toBe(true);
    expect(isSensitiveResource("plants")).toBe(false);
  });

  it("classifies sensitive field names", () => {
    expect(isSensitiveField("password_hash")).toBe(true);
    expect(isSensitiveField("email")).toBe(true);
    expect(isSensitiveField("access_token")).toBe(true);
    expect(isSensitiveField("name")).toBe(false);
  });
});

describe("draftManifest", () => {
  const manifest = draftManifest(introspection);

  it("produces a valid manifest", () => {
    expect(validateManifest(manifest).ok).toBe(true);
  });

  it("enables read/list on non-sensitive resources with non-sensitive fields", () => {
    const list = manifest.capabilities.plants.find((c) => c.verb === "list")!;
    expect(list.enabled).toBe(true);
    expect(list.locked).toBe(false);
    expect(list.exposedFields).toEqual(["id", "name", "price"]);
  });

  it("always drafts writes disabled", () => {
    const create = manifest.capabilities.plants.find((c) => c.verb === "create")!;
    const update = manifest.capabilities.plants.find((c) => c.verb === "update")!;
    expect(create.enabled).toBe(false);
    expect(update.enabled).toBe(false);
  });

  it("locks sensitive resources entirely", () => {
    const caps = manifest.capabilities.users;
    expect(caps.every((c) => c.enabled === false)).toBe(true);
    expect(caps.every((c) => c.locked === true)).toBe(true);
  });

  it("flags sensitive fields on resources", () => {
    const users = manifest.resources.find((r) => r.name === "users")!;
    const email = users.fields.find((f) => f.name === "email")!;
    expect(email.sensitive).toBe(true);
  });

  it("sets a default maxRowsPerCall guardrail on list", () => {
    const list = manifest.capabilities.plants.find((c) => c.verb === "list")!;
    expect(list.guardrails?.maxRowsPerCall).toBe(100);
  });
});
