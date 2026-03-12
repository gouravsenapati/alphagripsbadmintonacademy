import { env } from "./env.js";

const INVALID_SCHEMA_REGEX = /invalid schema:\s*([a-z0-9_]+)/i;

export function isInvalidTournamentSchemaError(error) {
  const message = error?.message || "";
  return INVALID_SCHEMA_REGEX.test(message);
}

export function buildTournamentSchemaAccessError(schemaName = env.TOURNAMENT_SCHEMA) {
  const error = new Error(
    `Tournament schema "${schemaName}" is not available through Supabase Data API. Add "${schemaName}" to Exposed schemas and Extra search path in Supabase > Integrations > Data API > Settings, save, and retry.`
  );
  error.statusCode = 503;
  error.code = "TOURNAMENT_SCHEMA_UNAVAILABLE";
  return error;
}

export function normalizeTournamentSchemaError(error) {
  if (isInvalidTournamentSchemaError(error)) {
    return buildTournamentSchemaAccessError();
  }

  return error;
}
