/**
 * Human-readable capability sheet, derived purely from the manifest — the
 * console has no schema knowledge of its own (console-plan §3).
 */

import type { Capability, CapabilityVerb, Manifest } from "@agent-ready/core";

export interface CapabilityView {
  verb: CapabilityVerb;
  enabled: boolean;
  locked: boolean;
  reason?: string;
  exposedFields: string[];
  guardrails?: Capability["guardrails"];
}

export interface ResourceView {
  name: string;
  label: string;
  description?: string;
  approximateRows?: number;
  capabilities: CapabilityView[];
}

export interface ManifestView {
  app: Manifest["app"];
  mcpUrl?: string;
  resources: ResourceView[];
}

function lockedReason(resourceName: string): string {
  return `${resourceName} is locked: contains sensitive data and requires an explicit unlock.`;
}

/** Build the plain-language capability sheet the Overview screen renders. */
export function buildManifestView(manifest: Manifest, mcpUrl?: string): ManifestView {
  const resources: ResourceView[] = manifest.resources.map((resource) => {
    const caps = manifest.capabilities[resource.name] ?? [];
    return {
      name: resource.name,
      label: resource.label ?? resource.name,
      description: resource.description,
      approximateRows: resource.approximateRows,
      capabilities: caps.map((cap) => ({
        verb: cap.verb,
        enabled: cap.enabled,
        locked: Boolean(cap.locked),
        reason: cap.locked ? lockedReason(resource.label ?? resource.name) : undefined,
        exposedFields: cap.exposedFields,
        guardrails: cap.guardrails,
      })),
    };
  });

  return { app: manifest.app, mcpUrl, resources };
}
