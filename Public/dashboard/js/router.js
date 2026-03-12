import "./layout.js";
import { renderAcademies } from "./modules/academies.js";
import { renderPlayers } from "./modules/players.js";
import { renderUsers } from "./modules/users.js";
import { renderCategories } from "./modules/categories.js";
import { renderBatches } from "./modules/batches.js";
import { renderPlayerBatches } from "./modules/playerBatches.js";
import { renderAttendance } from "./modules/attendance.js";
import { renderFitness } from "./modules/fitness.js";
import { renderMatchMatrix } from "./modules/matchMatrix.js";
import { renderPlayerMatchLog } from "./modules/playerMatchLog.js";
import { renderFeePlans } from "./modules/feePlans.js";
import { renderInvoices } from "./modules/invoices.js";
import { renderPayments } from "./modules/payments.js";
import { renderReceipts } from "./modules/receipts.js";
import { renderRankings } from "./modules/rankings.js";

const USER_MANAGER_ROLES = new Set(["super_admin", "head_coach", "academy_admin"]);

const routes = {
  dashboard: renderPlayers,
  players: renderPlayers,
  academies: renderAcademies,
  users: renderUsers,
  categories: renderCategories,
  batches: renderBatches,
  "player-batches": renderPlayerBatches,
  attendance: renderAttendance,
  fitness: renderFitness,
  "match-matrix": renderMatchMatrix,
  "player-match-log": renderPlayerMatchLog,
  rankings: renderRankings,
  "fee-plans": renderFeePlans,
  invoices: renderInvoices,
  payments: renderPayments,
  receipts: renderReceipts
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
      const roleIdFromToken = String(decoded.role_id || "");

      if (roleFromToken || roleIdFromToken) {
        localStorage.setItem("role_id", roleIdFromToken);
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

function isTournamentOnlyUser() {
  const access = window.AGPortalAccess;

  if (!access) {
    return false;
  }

  return access.isTournamentOnlyRole(getStoredRole());
}

function collapseSidebarForMobile() {
  if (window.innerWidth < 1100 && typeof window.closeSidebar === "function") {
    window.closeSidebar();
  }
}

function canManageUsers() {
  return USER_MANAGER_ROLES.has(getStoredRole());
}

function syncNavVisibility() {
  const showUsers = canManageUsers();

  document.querySelectorAll("[data-manager-only]").forEach((link) => {
    link.hidden = !showUsers;
  });
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

   if (isTournamentOnlyUser()) {
    const access = window.AGPortalAccess;
    const targetPortal = access.isRefereePreferredRole(getStoredRole()) ? "referee" : "tournament";
    window.location.replace(access.getPortalUrl(targetPortal));
    return;
  }

  syncNavVisibility();

  const requestedRoute = decodeURIComponent(location.hash.replace(/^#/, "")).trim() || "players";
  const route = requestedRoute;
  const render = routes[route] || routes.players;
  const resolvedRoute =
    route === "dashboard" || !routes[route] ? "players" : route;

  setActiveNav(resolvedRoute);
  render();
  collapseSidebarForMobile();
}

window.addEventListener("hashchange", loadRoute);

loadRoute();
