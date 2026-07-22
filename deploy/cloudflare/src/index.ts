import { createMcpHandler } from '@agent-ready/surface-mcp';
import { SupabaseAdapter } from '@agent-ready/adapter-supabase';
import { validateManifest } from '@agent-ready/core';
import manifestJson from '../manifest.json' with { type: 'json' };

// Validate the bundled manifest at module load. If it does not conform to the
// capability-manifest spec, fail loud at deploy time rather than serving a
// broken (or unexpectedly permissive) gateway.
const validation = validateManifest(manifestJson);
if (!validation.ok) {
  throw new Error(`Invalid manifest.json:\n- ${validation.errors.join('\n- ')}`);
}
const manifest = validation.manifest;

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  /** Optional. Comma-separated list of bearer tokens allowed to call /mcp. */
  GATEWAY_API_KEY?: string;
}

function landingPage(origin: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>agent-ready gateway</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      max-width: 640px;
      margin: 4rem auto;
      padding: 0 1.5rem;
    }
    h1 { font-size: 1.4rem; }
    code, pre {
      background: color-mix(in srgb, currentColor 8%, transparent);
      border-radius: 6px;
      padding: 0.15em 0.4em;
    }
    pre { padding: 1rem; overflow-x: auto; }
    .status { color: #16a34a; font-weight: 600; }
  </style>
</head>
<body>
  <h1>🟢 <span class="status">Your agent gateway is live</span></h1>
  <p>This is an <a href="https://github.com/everyai-com/agent-ready" target="_blank" rel="noopener">agent-ready</a> MCP gateway, deployed to your own Cloudflare account. It exposes only the capabilities enabled in your <code>manifest.json</code>.</p>
  <h2>Connect an agent</h2>
  <p>MCP endpoint:</p>
  <pre>${origin}/mcp</pre>
  <p>Add it to Claude, Claude Code, or any MCP-compatible client as a remote server at that URL. If you set <code>GATEWAY_API_KEY</code>, send it as <code>Authorization: Bearer &lt;key&gt;</code>.</p>
  <h2>Health check</h2>
  <pre>${origin}/health</pre>
</body>
</html>`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', service: 'agent-ready-gateway' }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.pathname === '/') {
      return new Response(landingPage(url.origin), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }

    if (url.pathname === '/mcp') {
      const adapter = new SupabaseAdapter({
        url: env.SUPABASE_URL,
        serviceKey: env.SUPABASE_SERVICE_KEY,
      });

      const apiKeys = env.GATEWAY_API_KEY
        ? env.GATEWAY_API_KEY.split(',').map((k) => k.trim()).filter(Boolean)
        : undefined;

      const handler = createMcpHandler({ manifest, adapter, apiKeys });
      return handler(request);
    }

    return new Response('Not found', { status: 404 });
  },
};
