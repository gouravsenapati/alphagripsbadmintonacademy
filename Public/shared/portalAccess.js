(function attachPortalAccess(global) {
  const TOURNAMENT_ONLY_ROLES = new Set([
    "tournament_admin",
    "tournament_manager",
    "tournament_staff",
    "referee",
    "tournament_referee",
    "court_official"
  ]);

  const REFEREE_PREFERRED_ROLES = new Set([
    "referee",
    "tournament_referee",
    "court_official"
  ]);

  function normalizeRoleName(roleName) {
    return String(roleName || "").trim().toLowerCase();
  }

  function isParentRole(roleName, roleId) {
    void roleId;
    return normalizeRoleName(roleName).startsWith("parent");
  }

  function isTournamentOnlyRole(roleName) {
    return TOURNAMENT_ONLY_ROLES.has(normalizeRoleName(roleName));
  }

  function isAcademyPortalAllowedRole(roleName, roleId) {
    if (isParentRole(roleName, roleId)) {
      return false;
    }

    return !isTournamentOnlyRole(roleName);
  }

  function isRefereePreferredRole(roleName) {
    return REFEREE_PREFERRED_ROLES.has(normalizeRoleName(roleName));
  }

  function decodeToken(token) {
    try {
      const payload = token.split(".")[1];
      const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
      const decoded = JSON.parse(atob(normalized));
      return {
        role: normalizeRoleName(decoded.role || decoded.role_name),
        roleId: String(decoded.role_id || "").trim()
      };
    } catch (error) {
      return {
        role: "",
        roleId: ""
      };
    }
  }

  function getStoredAuthMeta() {
    const token = localStorage.getItem("token") || "";
    const tokenMeta = token ? decodeToken(token) : { role: "", roleId: "" };

    return {
      token,
      role: tokenMeta.role || normalizeRoleName(localStorage.getItem("role")),
      roleId: tokenMeta.roleId || String(localStorage.getItem("role_id") || "").trim()
    };
  }

  function getPreferredPortal(roleName, roleId) {
    const normalizedRoleName = normalizeRoleName(roleName);

    if (isParentRole(normalizedRoleName, roleId)) {
      return "parent";
    }

    if (isRefereePreferredRole(normalizedRoleName)) {
      return "referee";
    }

    if (isTournamentOnlyRole(normalizedRoleName)) {
      return "tournament";
    }

    return "academy";
  }

  function getPortalUrl(portalName) {
    switch (portalName) {
      case "parent":
        return "/Public/parent/index.html";
      case "referee":
        return "/Public/tournament/referee.html";
      case "tournament":
        return "/Public/tournament/index.html#tournaments";
      case "academy":
      default:
        return "/Public/dashboard/index.html#players";
    }
  }

  global.AGPortalAccess = {
    normalizeRoleName,
    isParentRole,
    isTournamentOnlyRole,
    isAcademyPortalAllowedRole,
    isRefereePreferredRole,
    decodeToken,
    getStoredAuthMeta,
    getPreferredPortal,
    getPortalUrl
  };
})(window);
