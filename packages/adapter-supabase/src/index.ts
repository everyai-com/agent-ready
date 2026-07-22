/**
 * `@agent-ready/adapter-supabase` — a `BackendAdapter` for Supabase, built on
 * PostgREST introspection and REST execution over plain `fetch`.
 */

export { SupabaseAdapter, type SupabaseAdapterOptions } from "./adapter.js";
export { parseSwagger, toFieldType, type PostgrestSwagger } from "./swagger.js";
