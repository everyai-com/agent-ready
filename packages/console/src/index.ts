/**
 * `@agent-ready/console` — the Gateway Console: a self-contained owner UI +
 * API served from the same handler/Worker as the MCP gateway.
 */

export { createConsoleHandler, type CreateConsoleHandlerOptions } from "./handler.js";
export { buildManifestView, type ManifestView, type ResourceView, type CapabilityView } from "./manifestView.js";
