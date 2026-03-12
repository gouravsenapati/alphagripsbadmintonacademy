const TOURNAMENT_ONLY_ROLE_NAMES = new Set([
  "tournament_admin",
  "tournament_manager",
  "tournament_staff",
  "referee",
  "tournament_referee",
  "court_official"
]);

function normalizeRoleName(roleName) {
  return String(roleName || "").trim().toLowerCase();
}

export function getRoleName(req) {
  return normalizeRoleName(req.user?.role || req.user?.role_name);
}

export function isParentRoleName(roleName) {
  return normalizeRoleName(roleName).startsWith("parent");
}

export function isTournamentOnlyRoleName(roleName) {
  return TOURNAMENT_ONLY_ROLE_NAMES.has(normalizeRoleName(roleName));
}

export function isAcademyPortalAllowedRoleName(roleName) {
  const normalizedRoleName = normalizeRoleName(roleName);

  if (!normalizedRoleName) {
    return false;
  }

  if (isParentRoleName(normalizedRoleName)) {
    return false;
  }

  if (isTournamentOnlyRoleName(normalizedRoleName)) {
    return false;
  }

  return true;
}

export function requireAcademyPortalAccess(req, res, next) {
  const roleName = getRoleName(req);

  if (isAcademyPortalAllowedRoleName(roleName)) {
    next();
    return;
  }

  if (isParentRoleName(roleName)) {
    return res.status(403).json({
      error: "Parent accounts can only access the parent portal"
    });
  }

  if (isTournamentOnlyRoleName(roleName)) {
    return res.status(403).json({
      error: "Tournament-only accounts cannot access the academy module"
    });
  }

  return res.status(403).json({
    error: "Access denied"
  });
}

