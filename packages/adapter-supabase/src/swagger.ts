/**
 * Parsing of the PostgREST OpenAPI (Swagger 2.0) document that Supabase serves
 * at `GET {url}/rest/v1/`. That document describes every exposed table as a
 * definition whose `properties` are the columns. We translate it into the
 * backend-neutral `Introspection` shape from `@agent-ready/core`.
 */

import type {
  FieldType,
  Introspection,
  IntrospectedColumn,
  IntrospectedTable,
} from "@agent-ready/core";

/** Minimal shape of the bits of the PostgREST swagger we read. */
export interface PostgrestSwagger {
  swagger?: string;
  definitions?: Record<string, SwaggerDefinition>;
}

interface SwaggerDefinition {
  properties?: Record<string, SwaggerProperty>;
  required?: string[];
}

interface SwaggerProperty {
  /** JSON-schema type: "string" | "integer" | "number" | "boolean" | ... */
  type?: string;
  /** Postgres type hint, e.g. "timestamp with time zone", "uuid", "jsonb". */
  format?: string;
  description?: string;
}

/**
 * Map a PostgREST property (json type + postgres format) to our `FieldType`.
 * `format` is the more specific signal (it carries the real Postgres type), so
 * it wins where it disambiguates.
 */
export function toFieldType(prop: SwaggerProperty): FieldType {
  const format = (prop.format ?? "").toLowerCase();
  const type = (prop.type ?? "").toLowerCase();

  if (format.includes("timestamp") || format === "date" || format === "time") {
    return "datetime";
  }
  if (format.includes("json")) return "json";

  switch (type) {
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "string":
      return "string";
    case "object":
    case "array":
      return "json";
    default:
      // uuid, text, etc. come through with type "string"; anything else unknown.
      return type === "" ? "unknown" : "string";
  }
}

/** PostgREST-internal RPC definitions are prefixed like `(rpc) foo`; skip them. */
function isTableDefinition(name: string): boolean {
  return !name.startsWith("(");
}

/**
 * Parse a PostgREST swagger document into an `Introspection`. Row counts are
 * not available from the swagger alone, so `approximateRows` is left undefined
 * (the adapter can fill it in separately if desired).
 */
export function parseSwagger(
  swagger: PostgrestSwagger,
  opts: { backend?: string; appName?: string } = {},
): Introspection {
  const definitions = swagger.definitions ?? {};
  const tables: IntrospectedTable[] = [];

  for (const [name, def] of Object.entries(definitions)) {
    if (!isTableDefinition(name)) continue;
    const props = def.properties ?? {};
    const columns: IntrospectedColumn[] = Object.entries(props).map(
      ([colName, prop]) => ({
        name: colName,
        type: toFieldType(prop),
        nullable: !(def.required ?? []).includes(colName),
      }),
    );
    tables.push({ name, columns });
  }

  return {
    backend: opts.backend ?? "supabase",
    appName: opts.appName,
    tables,
  };
}
