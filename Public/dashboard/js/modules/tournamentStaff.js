import { tournamentApi } from "../services/tournamentApi.js";

const TOURNAMENT_STAFF_MANAGER_ROLES = new Set([
  "super_admin",
  "academy_admin",
  "head_coach",
  "tournament_admin",
  "tournament_manager"
]);

const ROLE_LABELS = {
  tournament_admin: "Tournament Admin",
  tournament_manager: "Tournament Manager",
  tournament_staff: "Tournament Staff",
  referee: "Referee",
  tournament_referee: "Tournament Referee",
  court_official: "Court Official"
};

const state = {
  tournaments: [],
  selectedTournamentId: readStoredTournamentId(),
  meta: {
    roles: [],
    academy: null,
    tournament: null,
    current_role: null
  },
  users: [],
  filters: {
    search: "",
    role: "",
    status: ""
  },
  formValues: getEmptyFormValues(),
  editingUserId: null,
  loading: false,
  submitting: false,
  notice: null,
  permissionDenied: false
};

function readStoredTournamentId() {
  if (typeof localStorage === "undefined") {
    return "";
  }

  return String(localStorage.getItem("ag_selected_tournament_id") || "").trim();
}

function storeTournamentId(value) {
  if (typeof localStorage === "undefined") {
    return;
  }

  if (value) {
    localStorage.setItem("ag_selected_tournament_id", value);
  } else {
    localStorage.removeItem("ag_selected_tournament_id");
  }
}

function getApp() {
  return document.getElementById("app");
}

function getCurrentRole() {
  const access = window.AGPortalAccess;

  if (access?.getStoredAuthMeta) {
    return String(access.getStoredAuthMeta().role || "").toLowerCase();
  }

  return String(localStorage.getItem("role") || "").toLowerCase();
}

function canManageTournamentStaff() {
  return TOURNAMENT_STAFF_MANAGER_ROLES.has(getCurrentRole());
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function hasText(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function normalizeRoleName(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function formatRoleLabel(value) {
  const normalizedValue = normalizeRoleName(value);

  if (!normalizedValue) {
    return "-";
  }

  return ROLE_LABELS[normalizedValue] || normalizedValue;
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function clearNotice() {
  state.notice = null;
}

function setNotice(message, tone = "info") {
  state.notice = { message, tone };
}

function getEmptyFormValues() {
  return {
    name: "",
    email: "",
    phone: "",
    password: "",
    role_id: "",
    status: "active",
    is_active: "true"
  };
}

function getRoleOptions() {
  return Array.isArray(state.meta.roles) ? state.meta.roles : [];
}

function getDefaultRoleId() {
  const roles = getRoleOptions();
  const preferredRole =
    roles.find((role) => normalizeRoleName(role.name) === "referee") || roles[0];

  return preferredRole ? String(preferredRole.id) : "";
}

function getInitializedFormValues(source = {}) {
  const defaults = getEmptyFormValues();

  return {
    ...defaults,
    role_id: hasText(source.role_id) ? String(source.role_id) : getDefaultRoleId(),
    name: hasText(source.name) ? String(source.name) : defaults.name,
    email: hasText(source.email) ? String(source.email) : defaults.email,
    phone: hasText(source.phone) ? String(source.phone) : defaults.phone,
    password: "",
    status: hasText(source.status) ? String(source.status) : defaults.status,
    is_active:
      source.is_active === false
        ? "false"
        : source.is_active === true
        ? "true"
        : defaults.is_active
  };
}

function getSelectedTournament() {
  return (
    state.tournaments.find(
      (tournament) => String(tournament.id) === String(state.selectedTournamentId || "")
    ) || null
  );
}

function getEditingUser() {
  return (
    state.users.find((user) => String(user.id) === String(state.editingUserId || "")) || null
  );
}

function resetForm({ preserveNotice = false } = {}) {
  state.editingUserId = null;
  state.formValues = getInitializedFormValues();

  if (!preserveNotice) {
    clearNotice();
  }

  renderTournamentStaffPage();
}

function getFilteredUsers() {
  return state.users.filter((user) => {
    const query = state.filters.search.trim().toLowerCase();

    if (query) {
      const haystack = [
        user.name,
        user.email,
        user.phone,
        user.role_name,
        formatRoleLabel(user.role_name)
      ]
        .filter(hasText)
        .join(" ")
        .toLowerCase();

      if (!haystack.includes(query)) {
        return false;
      }
    }

    if (state.filters.role && String(user.role_id || "") !== String(state.filters.role)) {
      return false;
    }

    if (state.filters.status) {
      if (state.filters.status === "enabled" && !user.is_active) {
        return false;
      }

      if (state.filters.status === "disabled" && user.is_active) {
        return false;
      }
    }

    return true;
  });
}

function renderNotice() {
  if (!state.notice) {
    return "";
  }

  return `
    <div class="notice notice-${escapeHtml(state.notice.tone)}">
      <span>${escapeHtml(state.notice.message)}</span>
      <button class="btn btn-ghost btn-sm" type="button" data-action="dismiss-notice">Dismiss</button>
    </div>
  `;
}

function renderAccessDenied() {
  return `
    <section class="page-header">
      <div>
        <p class="eyebrow">Tournament Staff</p>
        <h2>Access restricted</h2>
        <p class="hero-copy">
          Only academy admins, head coaches, super admins, tournament admins, and tournament managers can create tournament-only users.
        </p>
      </div>
    </section>
    <div class="empty-panel">
      <p class="eyebrow">Permission required</p>
      <h3>You cannot manage tournament staff from this account</h3>
      <p>Use a tournament manager or academy admin account to create referee and tournament-only users.</p>
    </div>
  `;
}

function renderLoading() {
  return `
    <section class="page-header">
      <div>
        <p class="eyebrow">Tournament Staff</p>
        <h2>Tournament-only users</h2>
        <p class="hero-copy">Loading tournament staff workspace...</p>
      </div>
    </section>
  `;
}

function renderSummaryCards() {
  const totalUsers = state.users.length;
  const enabledUsers = state.users.filter((user) => user.is_active).length;
  const referees = state.users.filter((user) =>
    ["referee", "tournament_referee", "court_official"].includes(
      normalizeRoleName(user.role_name)
    )
  ).length;
  const managers = state.users.filter((user) =>
    ["tournament_admin", "tournament_manager"].includes(normalizeRoleName(user.role_name))
  ).length;

  return `
    <section class="card-grid">
      <article class="stat-card">
        <span class="stat-label">Tournament Users</span>
        <strong>${escapeHtml(String(totalUsers))}</strong>
        <p>Accounts created only for tournament operations in this academy scope.</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Login Enabled</span>
        <strong>${escapeHtml(String(enabledUsers))}</strong>
        <p>Tournament users who can currently sign in.</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Referee Crew</span>
        <strong>${escapeHtml(String(referees))}</strong>
        <p>Referee, tournament referee, and court official accounts.</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Managers</span>
        <strong>${escapeHtml(String(managers))}</strong>
        <p>Tournament admin and manager accounts available for desk control.</p>
      </article>
    </section>
  `;
}

function renderTournamentOptions() {
  return state.tournaments
    .map(
      (tournament) => `
        <option
          value="${escapeHtml(String(tournament.id))}"
          ${String(state.selectedTournamentId) === String(tournament.id) ? "selected" : ""}
        >
          ${escapeHtml(tournament.tournament_name || "Tournament")} (${escapeHtml(
            tournament.tournament_code || tournament.id
          )})
        </option>
      `
    )
    .join("");
}

function renderRoleOptions(selectedValue = "") {
  return `
    <option value="">Select role</option>
    ${getRoleOptions()
      .map(
        (role) => `
          <option value="${role.id}" ${
            String(selectedValue) === String(role.id) ? "selected" : ""
          }>
            ${escapeHtml(formatRoleLabel(role.name))}
          </option>
        `
      )
      .join("")}
  `;
}

function renderContextPanel() {
  const tournament = state.meta.tournament || getSelectedTournament();
  const academy = state.meta.academy || null;

  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Tournament Scope</p>
          <h3>${escapeHtml(tournament?.tournament_name || "Select a tournament")}</h3>
        </div>
      </div>
      <div class="form-grid">
        <label>Selected Tournament
          <select id="tournamentStaffTournamentSelect">
            <option value="">Select tournament</option>
            ${renderTournamentOptions()}
          </select>
        </label>
        <label>Academy Scope
          <input value="${escapeHtml(academy?.name || "Academy pending")}" readonly />
        </label>
      </div>
      <p class="form-help">
        Create users here only for tournament operations. They will not appear as academy parents and can be kept separate from the main AlphaGrips module.
      </p>
    </section>
  `;
}

function renderForm() {
  const editingUser = getEditingUser();
  const values = state.formValues;

  return `
    <section class="panel staff-form-panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Tournament Access</p>
          <h3>${editingUser ? `Update ${escapeHtml(editingUser.name || editingUser.email)}` : "Create tournament user"}</h3>
        </div>
        ${
          editingUser
            ? `<button class="btn btn-ghost btn-sm" type="button" id="resetTournamentStaffForm">New User</button>`
            : ""
        }
      </div>
      <form id="tournamentStaffForm" class="stack-form">
        <div class="staff-form-layout">
          <section class="staff-form-section">
            <div class="staff-form-section-head">
              <h4>Identity</h4>
              <p>Name and contact details for the tournament account.</p>
            </div>
            <div class="form-grid">
              <label>Name
                <input name="name" value="${escapeHtml(values.name)}" required />
              </label>
              <label>Email
                <input name="email" type="email" value="${escapeHtml(values.email)}" required />
              </label>
              <label>Phone
                <input name="phone" value="${escapeHtml(values.phone)}" />
              </label>
            </div>
          </section>

          <section class="staff-form-section">
            <div class="staff-form-section-head">
              <h4>Role & Access</h4>
              <p>Assign a tournament-only role for this account.</p>
            </div>
            <div class="form-grid">
              <label>Role
                <select name="role_id" required>
                  ${renderRoleOptions(values.role_id)}
                </select>
              </label>
              <label>Directory Status
                <select name="status">
                  <option value="active" ${values.status === "active" ? "selected" : ""}>active</option>
                  <option value="inactive" ${values.status === "inactive" ? "selected" : ""}>inactive</option>
                </select>
              </label>
              <label>Login Access
                <select name="is_active">
                  <option value="true" ${values.is_active === "true" ? "selected" : ""}>enabled</option>
                  <option value="false" ${values.is_active === "false" ? "selected" : ""}>disabled</option>
                </select>
              </label>
            </div>
          </section>

          <section class="staff-form-section">
            <div class="staff-form-section-head">
              <h4>Credentials</h4>
              <p>Set the sign-in password for this tournament account.</p>
            </div>
            <div class="form-grid">
              <label>Password
                <input
                  name="password"
                  type="password"
                  value="${escapeHtml(values.password)}"
                  ${editingUser ? "" : "required"}
                />
              </label>
            </div>
          </section>
        </div>
        <p class="form-help">
          ${
            editingUser
              ? "Leave password blank to keep the current password unchanged."
              : "Set a temporary password now so the referee or tournament staff member can log in immediately."
          }
        </p>
        <div class="table-actions">
          <button class="btn btn-primary" type="submit" ${state.submitting ? "disabled" : ""}>
            ${state.submitting ? "Saving..." : editingUser ? "Update User" : "Create User"}
          </button>
          <button class="btn btn-ghost" type="button" id="clearTournamentStaffForm" ${
            state.submitting ? "disabled" : ""
          }>
            Clear
          </button>
          ${
            editingUser
              ? `<button class="btn btn-danger" type="button" id="deleteTournamentStaffButton" ${
                  state.submitting ? "disabled" : ""
                }>
                  Delete User
                </button>`
              : ""
          }
        </div>
      </form>
    </section>
  `;
}

function renderTable() {
  const users = getFilteredUsers();

  if (!users.length) {
    return `
      <div class="empty-panel compact">
        <p class="eyebrow">Tournament Directory</p>
        <h3>No tournament users found</h3>
        <p>Create referee, court official, or tournament desk accounts for the selected tournament academy.</p>
      </div>
    `;
  }

  return `
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Staff Member</th>
            <th>Role</th>
            <th>Access</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${users
            .map(
              (user) => `
                <tr>
                  <td>
                    <strong>${escapeHtml(user.name || "Unnamed user")}</strong>
                    <div class="staff-user-meta">
                      <span>${escapeHtml(user.email || "No email")}</span>
                      <span>${escapeHtml(user.phone || "No phone")}</span>
                    </div>
                  </td>
                  <td>
                    <span class="staff-role-badge">${escapeHtml(formatRoleLabel(user.role_name))}</span>
                  </td>
                  <td>
                    <div class="staff-status-stack">
                      <span class="status-pill ${
                        user.is_active ? "status-success" : "status-neutral"
                      }">${user.is_active ? "login enabled" : "login disabled"}</span>
                      <span>${escapeHtml(user.status || "-")}</span>
                    </div>
                  </td>
                  <td>${escapeHtml(formatDate(user.created_at))}</td>
                  <td>
                    <div class="table-actions">
                      <button
                        class="btn btn-ghost btn-sm"
                        type="button"
                        data-action="edit-user"
                        data-user-id="${escapeHtml(String(user.id))}"
                      >
                        Edit
                      </button>
                      <button
                        class="btn btn-danger btn-sm"
                        type="button"
                        data-action="delete-user"
                        data-user-id="${escapeHtml(String(user.id))}"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderDirectoryPanel() {
  return `
    <section class="panel staff-directory-panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Tournament Directory</p>
          <h3>Managed tournament users</h3>
        </div>
      </div>
      <div class="toolbar player-filter-bar">
        <input
          id="tournamentStaffSearch"
          placeholder="Search by name, email, phone, role"
          value="${escapeHtml(state.filters.search)}"
        />
        <select id="tournamentStaffRoleFilter">
          <option value="">All roles</option>
          ${getRoleOptions()
            .map(
              (role) => `
                <option value="${role.id}" ${
                  String(state.filters.role) === String(role.id) ? "selected" : ""
                }>
                  ${escapeHtml(formatRoleLabel(role.name))}
                </option>
              `
            )
            .join("")}
        </select>
        <select id="tournamentStaffStatusFilter">
          <option value="">All login states</option>
          <option value="enabled" ${state.filters.status === "enabled" ? "selected" : ""}>login enabled</option>
          <option value="disabled" ${state.filters.status === "disabled" ? "selected" : ""}>login disabled</option>
        </select>
      </div>
      ${renderTable()}
    </section>
  `;
}

function renderEmptyTournamentSelection() {
  return `
    <section class="page-header">
      <div>
        <p class="eyebrow">Tournament Staff</p>
        <h2>Tournament-only users</h2>
        <p class="hero-copy">Choose a tournament to manage referee and tournament-only logins.</p>
      </div>
    </section>
    ${renderNotice()}
    ${renderContextPanel()}
    <div class="empty-panel">
      <p class="eyebrow">No tournament selected</p>
      <h3>Select a tournament first</h3>
      <p>Pick a tournament above to create referee, court official, and other tournament-only accounts.</p>
    </div>
  `;
}

function renderPage() {
  const app = getApp();

  if (!app) {
    return;
  }

  if (state.permissionDenied) {
    app.innerHTML = renderAccessDenied();
    bindEvents();
    return;
  }

  if (state.loading) {
    app.innerHTML = renderLoading();
    return;
  }

  if (!state.selectedTournamentId || !getSelectedTournament()) {
    app.innerHTML = renderEmptyTournamentSelection();
    bindEvents();
    return;
  }

  app.innerHTML = `
    <section class="page-header">
      <div>
        <p class="eyebrow">Tournament Staff</p>
        <h2>Tournament-only users</h2>
        <p class="hero-copy">
          Create referee, court official, and tournament desk accounts that stay scoped to the selected tournament academy.
        </p>
      </div>
    </section>
    ${renderNotice()}
    ${renderContextPanel()}
    ${renderSummaryCards()}
    <section class="staff-workspace-grid">
      ${renderForm()}
      ${renderDirectoryPanel()}
    </section>
  `;

  bindEvents();
}

async function loadTournaments() {
  const tournaments = await tournamentApi.listTournaments();
  state.tournaments = Array.isArray(tournaments) ? tournaments : [];

  if (
    state.selectedTournamentId &&
    state.tournaments.some(
      (tournament) => String(tournament.id) === String(state.selectedTournamentId)
    )
  ) {
    return;
  }

  state.selectedTournamentId = state.tournaments[0]?.id || "";
  storeTournamentId(state.selectedTournamentId);
}

async function loadTournamentStaffData() {
  if (!state.selectedTournamentId) {
    state.meta = {
      roles: [],
      academy: null,
      tournament: null,
      current_role: null
    };
    state.users = [];
    return;
  }

  const [meta, users] = await Promise.all([
    tournamentApi.getTournamentStaffMeta(state.selectedTournamentId),
    tournamentApi.listTournamentStaff(state.selectedTournamentId)
  ]);

  state.meta = meta || state.meta;
  state.users = Array.isArray(users) ? users : [];
  state.formValues = getInitializedFormValues(state.formValues);
}

async function refreshWorkspace() {
  state.loading = true;
  renderPage();

  try {
    await loadTournaments();

    if (canManageTournamentStaff()) {
      await loadTournamentStaffData();
      state.permissionDenied = false;
    } else {
      state.permissionDenied = true;
    }
  } catch (error) {
    if (String(error.message || "").toLowerCase().includes("permission")) {
      state.permissionDenied = true;
    } else {
      setNotice(error.message || "Failed to load tournament staff", "danger");
    }
  } finally {
    state.loading = false;
    renderPage();
  }
}

function syncFormStateFromDom() {
  const form = document.getElementById("tournamentStaffForm");

  if (!form) {
    return;
  }

  const formData = new FormData(form);
  state.formValues = {
    ...state.formValues,
    name: String(formData.get("name") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
    role_id: String(formData.get("role_id") ?? "").trim(),
    status: String(formData.get("status") ?? "active").trim(),
    is_active: String(formData.get("is_active") ?? "true").trim()
  };
}

async function handleSubmit(event) {
  event.preventDefault();
  syncFormStateFromDom();
  state.submitting = true;
  clearNotice();
  renderPage();

  try {
    const payload = {
      tournament_id: state.selectedTournamentId,
      ...state.formValues
    };

    if (state.editingUserId) {
      await tournamentApi.updateTournamentStaff(state.editingUserId, payload);
      setNotice("Tournament user updated successfully", "success");
    } else {
      await tournamentApi.createTournamentStaff(payload);
      setNotice("Tournament user created successfully", "success");
    }

    state.formValues = getInitializedFormValues();
    state.editingUserId = null;
    await loadTournamentStaffData();
  } catch (error) {
    setNotice(error.message || "Failed to save tournament user", "danger");
  } finally {
    state.submitting = false;
    renderPage();
  }
}

function loadUserIntoForm(userId) {
  const user = state.users.find((entry) => String(entry.id) === String(userId));

  if (!user) {
    return;
  }

  state.editingUserId = user.id;
  state.formValues = getInitializedFormValues(user);
  clearNotice();
  renderPage();
}

async function handleDelete(userId) {
  const user = state.users.find((entry) => String(entry.id) === String(userId));

  if (!user) {
    return;
  }

  const confirmed = window.confirm(
    `Delete ${user.name || user.email || "this tournament user"}?`
  );

  if (!confirmed) {
    return;
  }

  try {
    await tournamentApi.deleteTournamentStaff(user.id, state.selectedTournamentId);

    if (String(state.editingUserId || "") === String(user.id)) {
      state.editingUserId = null;
      state.formValues = getInitializedFormValues();
    }

    setNotice("Tournament user deleted successfully", "success");
    await loadTournamentStaffData();
  } catch (error) {
    setNotice(error.message || "Failed to delete tournament user", "danger");
  } finally {
    renderPage();
  }
}

function bindEvents() {
  document
    .getElementById("tournamentStaffTournamentSelect")
    ?.addEventListener("change", async (event) => {
      state.selectedTournamentId = event.target.value;
      storeTournamentId(state.selectedTournamentId);
      state.editingUserId = null;
      state.formValues = getInitializedFormValues();
      await refreshWorkspace();
    });

  document.getElementById("tournamentStaffForm")?.addEventListener("submit", handleSubmit);

  document
    .getElementById("resetTournamentStaffForm")
    ?.addEventListener("click", () => resetForm());

  document
    .getElementById("clearTournamentStaffForm")
    ?.addEventListener("click", () => resetForm());

  document
    .getElementById("deleteTournamentStaffButton")
    ?.addEventListener("click", () => {
      if (state.editingUserId) {
        handleDelete(state.editingUserId);
      }
    });

  document
    .querySelector('[data-action="dismiss-notice"]')
    ?.addEventListener("click", () => {
      clearNotice();
      renderPage();
    });

  document.getElementById("tournamentStaffSearch")?.addEventListener("input", (event) => {
    state.filters.search = event.target.value;
    renderPage();
  });

  document
    .getElementById("tournamentStaffRoleFilter")
    ?.addEventListener("change", (event) => {
      state.filters.role = event.target.value;
      renderPage();
    });

  document
    .getElementById("tournamentStaffStatusFilter")
    ?.addEventListener("change", (event) => {
      state.filters.status = event.target.value;
      renderPage();
    });

  document.querySelectorAll('[data-action="edit-user"]').forEach((button) => {
    button.addEventListener("click", () => {
      loadUserIntoForm(button.dataset.userId);
    });
  });

  document.querySelectorAll('[data-action="delete-user"]').forEach((button) => {
    button.addEventListener("click", () => {
      handleDelete(button.dataset.userId);
    });
  });
}

export async function renderTournamentStaff() {
  await refreshWorkspace();
}
