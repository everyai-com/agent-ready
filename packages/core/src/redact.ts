/**
 * Row-level redaction. The gateway must never hand an agent a column the
 * manifest did not allow-list, even if the backend returned extra data. This is
 * the last line of defense (Layer 2 in the safety model).
 */

import type { Capability } from "./types.js";

/**
 * Return a copy of `row` containing only the fields on the capability's
 * `exposedFields` allow-list. Fields present on the allow-list but absent from
 * the row are simply omitted (not set to undefined). Everything else is dropped.
 */
export function redactRow(
  row: Record<string, unknown>,
  capability: Capability,
): Record<string, unknown> {
  const allowed = new Set(capability.exposedFields);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    if (allowed.has(key)) {
      out[key] = row[key];
    }
  }
  return out;
}

/** Convenience: redact a list of rows against one capability. */
export function redactRows(
  rows: Array<Record<string, unknown>>,
  capability: Capability,
): Array<Record<string, unknown>> {
  return rows.map((r) => redactRow(r, capability));
}
