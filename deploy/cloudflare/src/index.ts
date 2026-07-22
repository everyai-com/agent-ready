import { createMcpHandler } from '@agent-ready/surface-mcp';
import { createConsoleHandler } from '@agent-ready/console';
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
  /**
   * Optional. Owner password for the Gateway Console (`/` and `/api/console/*`).
   * Unset => the console is disabled and shows a static "set this to enable"
   * page instead of ever being silently open (console-plan §4).
   */
  CONSOLE_PASSWORD?: string;
  /**
   * Optional. HMAC secret for two-step confirmation tokens (docs/confirmations.md).
   * Unset => a random per-isolate secret is used, which works for a single
   * isolate but not across isolates/redeploys. Set a Worker secret for
   * multi-isolate deployments.
   */
  CONFIRM_SECRET?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', service: 'agent-ready-gateway' }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    const adapter = new SupabaseAdapter({
      url: env.SUPABASE_URL,
      serviceKey: env.SUPABASE_SERVICE_KEY,
    });

    if (url.pathname === '/mcp') {
      const apiKeys = env.GATEWAY_API_KEY
        ? env.GATEWAY_API_KEY.split(',').map((k) => k.trim()).filter(Boolean)
        : undefined;

      const handler = createMcpHandler({ manifest, adapter, apiKeys, confirmSecret: env.CONFIRM_SECRET });
      return handler(request);
    }

    if (url.pathname === '/' || url.pathname.startsWith('/api/console/') || url.pathname.startsWith('/console-assets/')) {
      const handler = createConsoleHandler({
        manifest,
        adapter,
        password: env.CONSOLE_PASSWORD,
        mcpUrl: `${url.origin}/mcp`,
      });
      return handler(request);
    }

    return new Response('Not found', { status: 404 });
  },
};
