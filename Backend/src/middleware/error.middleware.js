import { normalizeTournamentSchemaError } from "../config/tournamentSchema.js";

export function errorHandler(err, req, res, next) {
  const normalizedError = normalizeTournamentSchemaError(err);

  console.error("ERROR:", normalizedError);

  res.status(normalizedError.statusCode || 500).json({
    error: normalizedError.message || "Internal server error"
  });
}
