import type { PostgrestSwagger } from "../src/swagger.js";

/** A small fake PostgREST swagger document, shaped like Supabase's real one. */
export const fakeSwagger: PostgrestSwagger = {
  swagger: "2.0",
  definitions: {
    plants: {
      required: ["id"],
      properties: {
        id: { type: "integer", format: "bigint", description: "Note:\nPrimary Key." },
        name: { type: "string", format: "text" },
        price: { type: "number", format: "numeric" },
        created_at: { type: "string", format: "timestamp with time zone" },
        metadata: { type: "string", format: "jsonb" },
        is_active: { type: "boolean", format: "boolean" },
      },
    },
    users: {
      required: ["id"],
      properties: {
        id: { type: "string", format: "uuid" },
        email: { type: "string", format: "text" },
        password_hash: { type: "string", format: "text" },
      },
    },
    // A PostgREST RPC definition that must be ignored during introspection.
    "(rpc) do_thing": {
      properties: { arg: { type: "string" } },
    },
  },
};

/** Rows a fake PostgREST GET would return for `plants`. */
export const plantRows = [
  {
    id: 1,
    name: "Fern",
    price: 12.5,
    created_at: "2024-01-01T00:00:00Z",
    metadata: {},
    is_active: true,
  },
  {
    id: 2,
    name: "Cactus",
    price: 8,
    created_at: "2024-02-01T00:00:00Z",
    metadata: {},
    is_active: true,
  },
];

/** Records a single fetch call so tests can assert on the request. */
export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/**
 * Build a fake `fetch` that records calls and returns the given JSON payload.
 * `routes` maps a substring of the URL to the JSON body to return; the first
 * match wins. Unmatched URLs return `[]` with 200.
 */
export function makeFakeFetch(
  routes: Array<{ match: string; status?: number; json: unknown }>,
): { fetchImpl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers as Record<string, string>) ?? {},
      body: init?.body as string | undefined,
    });
    const route = routes.find((r) => url.includes(r.match));
    const status = route?.status ?? 200;
    const json = route ? route.json : [];
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      json: async () => json,
    } as Response;
  }) as typeof fetch;
  return { fetchImpl, calls };
}
