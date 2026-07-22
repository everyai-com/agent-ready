/**
 * `@agent-ready/surface-ui` — turns a manifest-derived tool + its result
 * into per-host renderings: markdown (universal fallback), structured JSON
 * (matching the tool's `outputSchema`), and a self-contained HTML table
 * component (MCP Apps / Apps SDK groundwork). See docs/host-ui-plan.md §2.
 */

export { renderResultMarkdown } from "./render/markdown.js";
export { buildStructuredContent } from "./render/structured.js";
export { renderTableHtml } from "./render/html/table.js";
export { theme, type Theme, type ColorScale } from "./theme.js";
