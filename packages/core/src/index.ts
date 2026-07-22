/**
 * `@agent-ready/core` — the capability manifest spec and the pure functions
 * that operate on it. This package has no backend dependencies: adapters
 * produce manifests, surfaces consume them, and everything here is the shared
 * contract in between.
 */

export * from "./types.js";
export { validateManifest, type ValidationResult } from "./validate.js";
export { redactRow, redactRows } from "./redact.js";
export {
  draftManifest,
  isSensitiveResource,
  isSensitiveField,
} from "./draft.js";
export { deriveTools, toolName } from "./derive.js";
