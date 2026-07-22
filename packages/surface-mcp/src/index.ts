export { createMcpHandler } from './handler.js';
export type { CreateMcpHandlerOptions } from './handler.js';
// The manifest/adapter/tool contract lives in @agent-ready/core — re-exported
// here so consumers of the MCP surface have a single import if they want it.
export type {
  BackendAdapter,
  Identity,
  Manifest,
  ToolCall,
  ToolDefinition,
  ToolResult,
} from '@agent-ready/core';
export { toolRequiresConfirmation } from '@agent-ready/core';
