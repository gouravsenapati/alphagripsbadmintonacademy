import "../../dashboard/js/layout.js";
import {
  renderTournamentBrackets,
  renderTournamentCourts,
  renderTournamentOperations,
  renderTournamentResults,
  renderTournamentScoring,
  renderTournamentSetup,
  renderTournaments,
} from "../../dashboard/js/modules/tournaments.js";
import { renderTournamentStaff } from "../../dashboard/js/modules/tournamentStaff.js";

const routes = {
  tournaments: renderTournaments,
  "tournament-setup": renderTournamentSetup,
  "tournament-staff": renderTournamentStaff,
  "tournament-brackets": renderTournamentBrackets,
  "tournament-operations": renderTournamentOperations,
  "tournament-courts": renderTournamentCourts,
  "tournament-scoring": renderTournamentScoring,
  "tournament-results": renderTournamentResults
};

window.navigate = function navigate(route) {
  location.hash = route;
};

function getStoredRole() {
  const token = localStorage.getItem("token");

  if (token) {
    try {
      const payload = token.split(".")[1];
      const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
      const decoded = JSON.parse(atob(normalized));
      const roleFromToken = String(decoded.role || decoded.role_name || "").toLowerCase();

      if (roleFromToken) {
        return roleFromToken;
      }
    } catch (error) {
      // fall back to localStorage role below
    }
  }

  return String(localStorage.getItem("role") || "").toLowerCase();
}

function isParentUser() {
  const access = window.AGPortalAccess;

  if (!access) {
    return getStoredRole().startsWith("parent");
  }

  return access.isParentRole(getStoredRole(), localStorage.getItem("role_id"));
}

function isRefereeOnlyUser() {
  const access = window.AGPortalAccess;

  if (!access) {
    return false;
  }

  return access.isRefereePreferredRole(getStoredRole());
}

function collapseSidebarForMobile() {
  if (window.innerWidth < 1100 && typeof window.closeSidebar === "function") {
    window.closeSidebar();
  }
}

function setActiveNav(route) {
  document.querySelectorAll("[data-route]").forEach((link) => {
    link.classList.toggle("active", link.dataset.route === route);
  });
}

function loadRoute() {
  if (isParentUser()) {
    window.location.replace("/Public/parent/index.html");
    return;
  }

  if (isRefereeOnlyUser()) {
    window.location.replace("/Public/tournament/referee.html");
    return;
  }

  const route = location.hash.replace("#", "") || "tournaments";
  const render = routes[route] || routes.tournaments;
  const resolvedRoute = routes[route] ? route : "tournaments";

  setActiveNav(resolvedRoute);
  render();
  collapseSidebarForMobile();
}

window.addEventListener("hashchange", loadRoute);

loadRoute();
