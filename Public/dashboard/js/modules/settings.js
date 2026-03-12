import { api } from "../services/api.js";

const MODULES = [
  { route: "players", label: "Players" },
  { route: "academies", label: "Academies" },
  { route: "users", label: "Staff" },
  { route: "categories", label: "Categories" },
  { route: "fee-plans", label: "Fee Plans" },
  { route: "invoices", label: "Invoices" },
  { route: "payments", label: "Payments" },
  { route: "receipts", label: "Receipts" },
  { route: "batches", label: "Batches" },
  { route: "player-batches", label: "Batch Assignments" },
  { route: "attendance", label: "Attendance" },
  { route: "fitness", label: "Fitness" },
  { route: "match-matrix", label: "Match Matrix" },
  { route: "player-match-log", label: "Player Match Log" },
  { route: "rankings", label: "Rankings" },
  { route: "coach-dashboard", label: "Coach Dashboard" },
  { route: "settings", label: "Settings" }
];

const ROLES = [
  { value: "super_admin", label: "Super Admin" },
  { value: "academy_admin", label: "Academy Admin" },
  { value: "head_coach", label: "Head Coach" },
  { value: "coach", label: "Coach" }
];

const state = {
  notice: null,
  accessRole: "head_coach",
  accessMap: loadAccessMap(),
  isSavingPassword: false
};

function getApp() {
  return document.getElementById("app");
}

function setNotice(message, tone = "info") {
  state.notice = { message, tone };
}

function clearNotice() {
  state.notice = null;
}

function loadAccessMap() {
  try {
    const raw = localStorage.getItem("module_access_map");
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    return {};
  }
}

function persistAccessMap() {
  localStorage.setItem("module_access_map", JSON.stringify(state.accessMap));
}

function getRoleAccess(role) {
  if (Array.isArray(state.accessMap[role])) {
    return state.accessMap[role];
  }

  return MODULES.map((module) => module.route);
}

function renderNotice() {
  if (!state.notice) {
    return "";
  }

  return `
    <div class="notice notice-${state.notice.tone}">
      <span>${state.notice.message}</span>
      <button class="btn btn-ghost btn-sm" type="button" data-action="dismiss-settings-notice">Dismiss</button>
    </div>
  `;
}

function renderThemeCard() {
  const currentTheme = localStorage.getItem("theme") || "light";

  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Appearance</p>
          <h3>Theme</h3>
        </div>
      </div>
      <div class="settings-row">
        <div>
          <strong>Current theme</strong>
          <p class="form-help">Switch between light and dark layouts.</p>
        </div>
        <div class="settings-actions">
          <button class="btn ${currentTheme === "light" ? "btn-primary" : "btn-ghost"}" type="button" data-action="set-theme" data-theme="light">Light</button>
          <button class="btn ${currentTheme === "dark" ? "btn-primary" : "btn-ghost"}" type="button" data-action="set-theme" data-theme="dark">Dark</button>
        </div>
      </div>
    </section>
  `;
}

function renderPasswordCard() {
  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Security</p>
          <h3>Password reset</h3>
        </div>
      </div>
      <form id="passwordResetForm" class="stack-form">
        <label>Current Password
          <input name="current_password" type="password" required />
        </label>
        <label>New Password
          <input name="new_password" type="password" minlength="6" required />
        </label>
        <label>Confirm New Password
          <input name="confirm_password" type="password" minlength="6" required />
        </label>
        <div class="table-actions">
          <button class="btn btn-primary" type="submit" ${state.isSavingPassword ? "disabled" : ""}>
            ${state.isSavingPassword ? "Saving..." : "Update Password"}
          </button>
        </div>
      </form>
    </section>
  `;
}

function renderAccessControlCard() {
  const access = new Set(getRoleAccess(state.accessRole));

  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Access Control</p>
          <h3>Module visibility (UI)</h3>
        </div>
      </div>
      <div class="settings-row">
        <div>
          <strong>Role</strong>
          <p class="form-help">Choose a role and toggle which modules appear in navigation.</p>
        </div>
        <div class="settings-actions">
          <select id="accessRoleSelect">
            ${ROLES.map(
              (role) => `
                <option value="${role.value}" ${state.accessRole === role.value ? "selected" : ""}>
                  ${role.label}
                </option>
              `
            ).join("")}
          </select>
        </div>
      </div>
      <div class="settings-grid">
        ${MODULES.map(
          (module) => `
            <label class="checkbox-row">
              <input
                type="checkbox"
                data-action="toggle-module"
                data-role="${state.accessRole}"
                data-module="${module.route}"
                ${access.has(module.route) ? "checked" : ""}
              />
              <span>${module.label}</span>
            </label>
          `
        ).join("")}
      </div>
      <p class="form-help">These settings update the left navigation for this device only.</p>
    </section>
  `;
}

function renderSettingsPage() {
  const app = getApp();

  if (!app) {
    return;
  }

  app.innerHTML = `
    <section class="page-header">
      <div>
        <p class="eyebrow">System Preferences</p>
        <h2>Settings</h2>
        <p class="hero-copy">Theme, security, and module access controls for this console.</p>
      </div>
    </section>
    ${renderNotice()}
    <section class="settings-grid-wrap">
      ${renderThemeCard()}
      ${renderPasswordCard()}
      ${renderAccessControlCard()}
    </section>
  `;

  bindEvents();
}

async function handlePasswordReset(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const currentPassword = String(form.current_password.value || "");
  const newPassword = String(form.new_password.value || "");
  const confirmPassword = String(form.confirm_password.value || "");

  if (newPassword !== confirmPassword) {
    setNotice("New password and confirmation do not match", "danger");
    renderSettingsPage();
    return;
  }

  state.isSavingPassword = true;
  clearNotice();
  renderSettingsPage();

  try {
    await api.post("/users/password", {
      current_password: currentPassword,
      new_password: newPassword
    });
    state.isSavingPassword = false;
    setNotice("Password updated successfully", "success");
    renderSettingsPage();
  } catch (error) {
    state.isSavingPassword = false;
    setNotice(error.message || "Unable to update password", "danger");
    renderSettingsPage();
  }
}

function bindEvents() {
  document.querySelector('[data-action="dismiss-settings-notice"]')?.addEventListener("click", () => {
    clearNotice();
    renderSettingsPage();
  });

  document.getElementById("passwordResetForm")?.addEventListener("submit", handlePasswordReset);

  document.querySelectorAll('[data-action="set-theme"]').forEach((button) => {
    button.addEventListener("click", () => {
      window.setTheme?.(button.dataset.theme);
      renderSettingsPage();
    });
  });

  document.getElementById("accessRoleSelect")?.addEventListener("change", (event) => {
    state.accessRole = event.target.value;
    renderSettingsPage();
  });

  document.querySelectorAll('[data-action="toggle-module"]').forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const role = checkbox.dataset.role;
      const moduleName = checkbox.dataset.module;
      const current = new Set(getRoleAccess(role));

      if (checkbox.checked) {
        current.add(moduleName);
      } else {
        current.delete(moduleName);
      }

      state.accessMap[role] = Array.from(current);
      persistAccessMap();
      if (typeof window.syncNavVisibility === "function") {
        window.syncNavVisibility();
      }
      renderSettingsPage();
    });
  });
}

export function renderSettings() {
  renderSettingsPage();
}
