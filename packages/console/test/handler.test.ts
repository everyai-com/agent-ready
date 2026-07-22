import { describe, expect, it } from "vitest";
import { createConsoleHandler } from "../src/handler.js";
import type {
  BackendAdapter,
  Identity,
  Manifest,
  ToolCall,
  ToolResult,
} from "@agent-ready/core";

const manifest: Manifest = {
  version: "v0",
  app: { name: "plantshop", title: "Plant Shop", backend: "supabase" },
  resources: [
    {
      name: "plants",
      label: "Plants",
      approximateRows: 132,
      fields: [
        { name: "id", type: "string" },
        { name: "name", type: "string" },
      ],
    },
    {
      name: "users",
      label: "Users",
      fields: [{ name: "id", type: "string" }, { name: "email", type: "string", sensitive: true }],
    },
  ],
  capabilities: {
    plants: [
      { verb: "read", enabled: true, exposedFields: ["id", "name"] },
      { verb: "create", enabled: false, exposedFields: [] },
    ],
    users: [{ verb: "read", enabled: false, exposedFields: [], locked: true }],
  },
};

class FakeAdapter implements BackendAdapter {
  calls: ToolCall[] = [];
  async introspect() {
    return { backend: "fake", tables: [] };
  }
  async execute(call: ToolCall, _manifest: Manifest, _identity: Identity): Promise<ToolResult> {
    this.calls.push(call);
    if (call.resource === "plants" && call.verb === "read") {
      return { ok: true, rows: [{ id: "1", name: "Monstera" }] };
    }
    return { ok: false, error: "denied by policy" };
  }
}

function req(path: string, init: RequestInit = {}) {
  return new Request(`https://gateway.example${path}`, init);
}

function cookieFrom(res: Response): string {
  const setCookie = res.headers.get("set-cookie") ?? "";
  return setCookie.split(";")[0];
}

async function login(handler: (r: Request) => Promise<Response>, password: string) {
  const res = await handler(
    req("/api/console/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    }),
  );
  return cookieFrom(res);
}

describe("createConsoleHandler — auth gating", () => {
  it("serves the disabled page when no password is configured", async () => {
    const handler = createConsoleHandler({ manifest, adapter: new FakeAdapter() });
    const res = await handler(req("/"));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Console disabled");
  });

  it("returns 403 from the console API when no password is configured", async () => {
    const handler = createConsoleHandler({ manifest, adapter: new FakeAdapter() });
    const res = await handler(req("/api/console/tools"));
    expect(res.status).toBe(403);
  });

  it("serves a login page when a password is configured but no session exists", async () => {
    const handler = createConsoleHandler({ manifest, adapter: new FakeAdapter(), password: "hunter2" });
    const res = await handler(req("/"));
    const body = await res.text();
    expect(body).toContain("login-form");
  });

  it("rejects a wrong password with 401", async () => {
    const handler = createConsoleHandler({ manifest, adapter: new FakeAdapter(), password: "hunter2" });
    const res = await handler(
      req("/api/console/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "wrong" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("accepts the correct password and sets a session cookie", async () => {
    const handler = createConsoleHandler({ manifest, adapter: new FakeAdapter(), password: "hunter2" });
    const res = await handler(
      req("/api/console/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "hunter2" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
    expect(res.headers.get("set-cookie")).toContain("SameSite=Lax");
  });

  it("a valid session cookie authorizes subsequent API calls", async () => {
    const handler = createConsoleHandler({ manifest, adapter: new FakeAdapter(), password: "hunter2" });
    const cookie = await login(handler, "hunter2");
    const res = await handler(req("/api/console/tools", { headers: { cookie } }));
    expect(res.status).toBe(200);
  });

  it("an unauthenticated API call is rejected with 401", async () => {
    const handler = createConsoleHandler({ manifest, adapter: new FakeAdapter(), password: "hunter2" });
    const res = await handler(req("/api/console/manifest-view"));
    expect(res.status).toBe(401);
  });

  it("serves the app shell once authenticated", async () => {
    const handler = createConsoleHandler({ manifest, adapter: new FakeAdapter(), password: "hunter2" });
    const cookie = await login(handler, "hunter2");
    const res = await handler(req("/", { headers: { cookie } }));
    const body = await res.text();
    expect(body).toContain("Playground");
    expect(body).toContain("Overview");
  });
});

describe("createConsoleHandler — manifest-view", () => {
  it("shapes the capability sheet with locked reasons and enabled chips", async () => {
    const handler = createConsoleHandler({ manifest, adapter: new FakeAdapter(), password: "hunter2" });
    const cookie = await login(handler, "hunter2");
    const res = await handler(req("/api/console/manifest-view", { headers: { cookie } }));
    const body = await res.json();
    expect(body.ok).toBe(true);
    const plants = body.view.resources.find((r: { name: string }) => r.name === "plants");
    const users = body.view.resources.find((r: { name: string }) => r.name === "users");
    expect(plants.capabilities.find((c: { verb: string }) => c.verb === "read").enabled).toBe(true);
    expect(users.capabilities[0].locked).toBe(true);
    expect(users.capabilities[0].reason).toContain("locked");
    expect(body.view.mcpUrl).toContain("/mcp");
  });

  it("responses carry Cache-Control: no-store", async () => {
    const handler = createConsoleHandler({ manifest, adapter: new FakeAdapter(), password: "hunter2" });
    const cookie = await login(handler, "hunter2");
    const res = await handler(req("/api/console/manifest-view", { headers: { cookie } }));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("createConsoleHandler — tools listing", () => {
  it("lists only enabled-capability tools, same as deriveTools", async () => {
    const handler = createConsoleHandler({ manifest, adapter: new FakeAdapter(), password: "hunter2" });
    const cookie = await login(handler, "hunter2");
    const res = await handler(req("/api/console/tools", { headers: { cookie } }));
    const body = await res.json();
    const names = body.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("get_plants");
    expect(names).not.toContain("create_plants");
    expect(names).not.toContain("get_users");
  });
});

describe("createConsoleHandler — run", () => {
  it("happy path executes through adapter.execute with no privileged path", async () => {
    const adapter = new FakeAdapter();
    const handler = createConsoleHandler({ manifest, adapter, password: "hunter2" });
    const cookie = await login(handler, "hunter2");
    const res = await handler(
      req("/api/console/run", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ tool: "get_plants", input: { id: "1" } }),
      }),
    );
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.rows[0].name).toBe("Monstera");
    expect(adapter.calls).toEqual([{ resource: "plants", verb: "read", input: { id: "1" } }]);
  });

  it("denies unknown/disabled tools before touching the adapter", async () => {
    const adapter = new FakeAdapter();
    const handler = createConsoleHandler({ manifest, adapter, password: "hunter2" });
    const cookie = await login(handler, "hunter2");
    const res = await handler(
      req("/api/console/run", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ tool: "create_plants", input: {} }),
      }),
    );
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Unknown or disabled tool");
    expect(adapter.calls).toHaveLength(0);
  });

  it("surfaces adapter denials in plain language", async () => {
    const adapter = new FakeAdapter();
    const manifestWithUsersRead: Manifest = {
      ...manifest,
      capabilities: {
        ...manifest.capabilities,
        users: [{ verb: "read", enabled: true, exposedFields: ["id"] }],
      },
    };
    const handler = createConsoleHandler({ manifest: manifestWithUsersRead, adapter, password: "hunter2" });
    const cookie = await login(handler, "hunter2");
    const res = await handler(
      req("/api/console/run", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ tool: "get_users", input: { id: "1" } }),
      }),
    );
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("denied");
  });

  it("refuses a requiresConfirmation write directly, without ever calling the adapter (console cannot bypass the gate)", async () => {
    const adapter = new FakeAdapter();
    const manifestWithGuardedCreate: Manifest = {
      ...manifest,
      capabilities: {
        ...manifest.capabilities,
        plants: [
          ...manifest.capabilities.plants,
          {
            verb: "create",
            enabled: true,
            exposedFields: ["id", "name"],
            guardrails: { requiresConfirmation: true },
          },
        ],
      },
    };
    const handler = createConsoleHandler({ manifest: manifestWithGuardedCreate, adapter, password: "hunter2" });
    const cookie = await login(handler, "hunter2");
    const res = await handler(
      req("/api/console/run", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ tool: "create_plants", input: { values: { name: "Fern" } } }),
      }),
    );
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/requires confirmation/i);
    expect(adapter.calls).toHaveLength(0);
  });
});

describe("createConsoleHandler — HTML escaping", () => {
  it("the app shell never echoes unescaped request data (API is JSON-only, no HTML echo endpoints)", async () => {
    const adapter = new FakeAdapter();
    const handler = createConsoleHandler({ manifest, adapter, password: "hunter2" });
    const cookie = await login(handler, "hunter2");
    const res = await handler(
      req("/api/console/run", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ tool: "<script>alert(1)</script>", input: {} }),
      }),
    );
    const contentType = res.headers.get("content-type") ?? "";
    expect(contentType).toContain("application/json");
    const body = await res.json();
    expect(body.error).toContain("<script>");
    // JSON-encoded, never rendered as HTML by this endpoint.
    expect(contentType).not.toContain("text/html");
  });

  it("manifest data with HTML-special characters is escaped in the rendered app shell", async () => {
    const evilManifest: Manifest = {
      ...manifest,
      app: { ...manifest.app, title: '<img src=x onerror=alert(1)>' },
    };
    const handler = createConsoleHandler({ manifest: evilManifest, adapter: new FakeAdapter(), password: "hunter2" });
    const cookie = await login(handler, "hunter2");
    const res = await handler(req("/", { headers: { cookie } }));
    const body = await res.text();
    expect(body).not.toContain("<img src=x onerror=alert(1)>");
    expect(body).toContain("&lt;img");
  });
});
