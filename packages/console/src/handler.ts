/**
 * `createConsoleHandler` — the Gateway Console (console-plan §1–4).
 *
 * Serves the owner UI (`/`), its static assets (`/console-assets/*`), and its
 * own API (`/api/console/*`) from a single fetch handler meant to sit next to
 * `createMcpHandler` in the same Worker/deployment. No build step: the UI is
 * hand-written HTML/CSS/vanilla JS, self-contained, CSP `default-src 'self'`
 * compatible (assets are same-origin routes, not inline).
 */

import {
  deriveTools as coreDeriveTools,
  executeWithConfirmation,
  toolRequiresConfirmation,
  type BackendAdapter,
  type CapabilityVerb,
  type Identity,
  type Manifest,
  type ToolDefinition,
} from "@agent-ready/core";

import {
  clearSessionCookieHeader,
  createSessionToken,
  isAuthenticated,
  sessionCookieHeader,
  verifyPassword,
} from "./auth.js";
import { CONSOLE_CSS, CONSOLE_JS, LOGIN_JS } from "./assets.js";
import { buildManifestView } from "./manifestView.js";
import { consoleAppPage, disabledPage, loginPage } from "./pages.js";

export interface CreateConsoleHandlerOptions {
  manifest: Manifest;
  adapter: BackendAdapter;
  /** Owner password (v1 auth, console-plan §4). Omit to disable the console. */
  password?: string;
  /** MCP endpoint URL shown in connect snippets. Falls back to `<origin>/mcp`. */
  mcpUrl?: string;
  /** Injectable for tests. Defaults to `@agent-ready/core`'s `deriveTools`. */
  deriveTools?: (manifest: Manifest) => ToolDefinition[];
}

function html(body: string, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'self'",
      ...extraHeaders,
    },
  });
}

function asset(body: string, contentType: string): Response {
  return new Response(body, {
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=300",
    },
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

/** Creates the console fetch handler. */
export function createConsoleHandler(
  options: CreateConsoleHandlerOptions,
): (request: Request) => Promise<Response> {
  const { manifest, adapter, password } = options;
  const deriveTools = options.deriveTools ?? coreDeriveTools;

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const secure = isSecureRequest(request);
    const mcpUrl = options.mcpUrl ?? `${url.origin}/mcp`;

    // Static assets: no secrets in them, always servable so the login/app
    // pages that reference them work whether or not the console is enabled.
    if (path === "/console-assets/app.css") return asset(CONSOLE_CSS, "text/css; charset=utf-8");
    if (path === "/console-assets/app.js") return asset(CONSOLE_JS, "text/javascript; charset=utf-8");
    if (path === "/console-assets/login.js") return asset(LOGIN_JS, "text/javascript; charset=utf-8");

    const consoleEnabled = typeof password === "string" && password.length > 0;

    // --- API ---------------------------------------------------------
    if (path.startsWith("/api/console/")) {
      if (!consoleEnabled) return json({ ok: false, error: "console disabled" }, 403);

      if (path === "/api/console/login" && request.method === "POST") {
        let body: { password?: string } = {};
        try {
          body = (await request.json()) as { password?: string };
        } catch {
          return json({ ok: false, error: "invalid JSON" }, 400);
        }
        if (typeof body.password !== "string" || !verifyPassword(body.password, password!)) {
          return json({ ok: false, error: "unauthorized" }, 401);
        }
        const token = await createSessionToken(password!);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
            "set-cookie": sessionCookieHeader(token, secure),
          },
        });
      }

      if (path === "/api/console/logout" && request.method === "POST") {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
            "set-cookie": clearSessionCookieHeader(secure),
          },
        });
      }

      const authed = await isAuthenticated(request, password!);
      if (!authed) return json({ ok: false, error: "unauthorized" }, 401);

      if (path === "/api/console/manifest-view" && request.method === "GET") {
        return json({ ok: true, view: buildManifestView(manifest, mcpUrl) });
      }

      if (path === "/api/console/tools" && request.method === "GET") {
        const tools = deriveTools(manifest).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          outputSchema: t.outputSchema,
          resource: t.resource,
          verb: t.verb,
        }));
        return json({ ok: true, tools });
      }

      if (path === "/api/console/run" && request.method === "POST") {
        let body: { tool?: string; input?: Record<string, unknown> } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ ok: false, error: "invalid JSON" }, 400);
        }
        const toolName = body.tool;
        if (!toolName || typeof toolName !== "string") {
          return json({ ok: false, error: "missing tool" }, 400);
        }
        // Same lookup + execution path an agent gets: only tools derived
        // from enabled capabilities exist; nothing privileged here.
        const tools = deriveTools(manifest);
        const tool = tools.find((t) => t.name === toolName);
        if (!tool) {
          return json({ ok: false, error: `Unknown or disabled tool: ${toolName}` });
        }
        const identity: Identity = { agentId: "console-playground" };
        // Same enforcement path an agent gets: requiresConfirmation writes
        // are gated in @agent-ready/core (`executeWithConfirmation`), not
        // re-implemented here, so the console cannot bypass it by calling
        // adapter.execute directly. The playground does not (yet) implement
        // the two-step confirm UI, so a guarded write simply refuses with a
        // clear message instead of silently no-op'ing.
        if (toolRequiresConfirmation(manifest, tool.resource, tool.verb as CapabilityVerb)) {
          return json({
            ok: false,
            error: `"${tool.name}" requires confirmation and cannot be run from the console playground yet. Use the MCP two-step confirmation protocol (docs/confirmations.md) instead.`,
          });
        }
        try {
          const result = await executeWithConfirmation(
            adapter,
            tool,
            {
              resource: tool.resource,
              verb: tool.verb as CapabilityVerb,
              input: body.input ?? {},
            },
            manifest,
            identity,
          );
          return json(result);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return json({ ok: false, error: message });
        }
      }

      return json({ ok: false, error: "not found" }, 404);
    }

    // --- UI ------------------------------------------------------------
    if (path === "/") {
      if (!consoleEnabled) return html(disabledPage());

      const authed = await isAuthenticated(request, password!);
      if (!authed) return html(loginPage());

      const view = buildManifestView(manifest, mcpUrl);
      return html(consoleAppPage(view, mcpUrl, manifest.app.title ?? manifest.app.name));
    }

    return new Response("Not found", { status: 404 });
  };
}
