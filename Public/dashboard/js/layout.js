import { api } from "./services/api.js";

function getSidebar() {
  return document.getElementById("sidebar");
}

function getSessionElements() {
  return {
    chip: document.getElementById("sessionChip"),
    roleLabel: document.getElementById("sessionRoleLabel"),
    name: document.getElementById("sessionName"),
    academy: document.getElementById("sessionAcademy")
  };
}

function humanizeRoleName(roleName) {
  const normalized = String(roleName || "").trim().toLowerCase();

  if (!normalized) {
    return "User";
  }

  return normalized
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getStoredSessionMeta() {
  const access = window.AGPortalAccess;
  const authMeta = access?.getStoredAuthMeta?.() || {};

  return {
    role: authMeta.role || String(localStorage.getItem("role") || "").trim().toLowerCase(),
    name:
      String(localStorage.getItem("name") || "").trim() ||
      String(localStorage.getItem("email") || "").trim() ||
      "Signed-in user",
    academyId: String(localStorage.getItem("academy_id") || "").trim()
  };
}

async function getAcademyScopeLabel(roleName, academyId) {
  if (roleName === "super_admin") {
    return "All academies";
  }

  if (!academyId) {
    return "Academy not assigned";
  }

  try {
    const academies = await api.get("/academies");
    const scopedAcademy = Array.isArray(academies) ? academies[0] : null;

    if (scopedAcademy?.name) {
      return scopedAcademy.name;
    }
  } catch (error) {
    // Fall back to the academy id label below if academy lookup fails.
  }

  return `Academy ID ${academyId}`;
}

async function renderSessionChip() {
  const { chip, roleLabel, name, academy } = getSessionElements();

  if (!chip || !roleLabel || !name || !academy) {
    return;
  }

  const sessionMeta = getStoredSessionMeta();

  roleLabel.textContent = humanizeRoleName(sessionMeta.role);
  name.textContent = sessionMeta.name;
  academy.textContent = await getAcademyScopeLabel(sessionMeta.role, sessionMeta.academyId);
  chip.hidden = false;
}

window.toggleSidebar = function () {
  const sidebar = getSidebar();

  if (!sidebar) {
    return;
  }

  sidebar.classList.toggle("open");
};

window.closeSidebar = function () {
  const sidebar = getSidebar();

  if (!sidebar) {
    return;
  }

  sidebar.classList.remove("open");
};

window.logout = function () {
  localStorage.clear();
  window.location.href = "/Public/login.html";
};

renderSessionChip();
