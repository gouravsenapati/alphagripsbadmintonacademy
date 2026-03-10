import { api } from "../services/api.js";
import { bindDebouncedSearch } from "../utils/search.js";

const USER_MANAGER_ROLES = new Set(["super_admin", "head_coach", "academy_admin"]);

const state = {
  users: [],
  meta: {
    roles: [],
    academies: [],
    current_role: null,
    current_academy_id: null
  },
  filters: {
    search: "",
    role: "",
    academyId: "",
    status: ""
  },
  editingUserId: null,
  formValues: getEmptyFormValues(),
  notice: null,
  permissionDenied: false,
  isSubmitting: false
};

function getApp() {
  return document.getElementById("app");
}

function getCurrentRole() {
  return String(localStorage.getItem("role") || "").trim().toLowerCase();
}

function canManageUsers() {
  return USER_MANAGER_ROLES.has(getCurrentRole());
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

function clearNotice() {
  state.notice = null;
}

function setNotice(message, tone = "info") {
  state.notice = { message, tone };
}

function getRoleOptions() {
  return Array.isArray(state.meta.roles) ? state.meta.roles : [];
}

function getAcademyOptions() {
  return Array.isArray(state.meta.academies) ? state.meta.academies : [];
}

function getRoleNameById(roleId) {
  return (
    getRoleOptions().find((role) => String(role.id) === String(roleId || ""))?.name || null
  );
}

function getAcademyNameById(academyId) {
  return (
    getAcademyOptions().find((academy) => String(academy.id) === String(academyId || ""))?.name ||
    null
  );
}

function getDefaultRoleId() {
  const roles = getRoleOptions();
  const preferredRole =
    roles.find((role) => String(role.name || "").toLowerCase() === "coach") ||
    roles.find((role) => String(role.name || "").toLowerCase() !== "super_admin") ||
    roles[0];

  return preferredRole ? String(preferredRole.id) : "";
}

function getDefaultAcademyId() {
  if (hasText(state.meta.current_academy_id)) {
    return String(state.meta.current_academy_id);
  }

  const firstAcademy = getAcademyOptions()[0];
  return firstAcademy ? String(firstAcademy.id) : "";
}

function getEmptyFormValues() {
  return {
    name: "",
    email: "",
    phone: "",
    password: "",
    role_id: "",
    academy_id: "",
    status: "active",
    is_active: "true"
  };
}

function getInitializedFormValues(source = {}) {
  const defaults = getEmptyFormValues();

  return {
    ...defaults,
    role_id: hasText(source.role_id) ? String(source.role_id) : getDefaultRoleId(),
    academy_id: hasText(source.academy_id)
      ? String(source.academy_id)
      : getDefaultAcademyId(),
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

function getEditingUser() {
  return state.users.find((user) => String(user.id) === String(state.editingUserId || "")) || null;
}

function resetForm({ preserveNotice = false } = {}) {
  state.editingUserId = null;
  state.formValues = getInitializedFormValues();

  if (!preserveNotice) {
    clearNotice();
  }

  renderUsersPage();
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
        user.academy_name
      ]
        .filter(hasText)
        .join(" ")
        .toLowerCase();

      if (!haystack.includes(query)) {
        return false;
      }
    }

    if (
      state.filters.role &&
      String(user.role_id || "") !== String(state.filters.role)
    ) {
      return false;
    }

    if (
      state.filters.academyId &&
      String(user.academy_id || "") !== String(state.filters.academyId)
    ) {
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
      <button class="btn btn-ghost btn-sm" type="button" data-action="dismiss-user-notice">Dismiss</button>
    </div>
  `;
}

function renderSummaryCards() {
  const totalUsers = state.users.length;
  const enabledUsers = state.users.filter((user) => user.is_active).length;
  const coaches = state.users.filter((user) =>
    ["coach", "head_coach"].includes(String(user.role_name || "").toLowerCase())
  ).length;
  const academiesCovered = new Set(
    state.users.map((user) => String(user.academy_name || "").trim()).filter(Boolean)
  ).size;

  return `
    <section class="card-grid">
      <article class="stat-card">
        <span class="stat-label">Staff Accounts</span>
        <strong>${escapeHtml(String(totalUsers))}</strong>
        <p>Managed login accounts visible in the current academy scope.</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Login Enabled</span>
        <strong>${escapeHtml(String(enabledUsers))}</strong>
        <p>Users who can currently authenticate into AlphaGrips.</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Coaching Team</span>
        <strong>${escapeHtml(String(coaches))}</strong>
        <p>Coach and head coach accounts across the visible scope.</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Academy Scope</span>
        <strong>${escapeHtml(String(academiesCovered || 0))}</strong>
        <p>Distinct academies represented in this staff directory view.</p>
      </article>
    </section>
  `;
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
            ${escapeHtml(role.name)}
          </option>
        `
      )
      .join("")}
  `;
}

function renderAcademyOptions(selectedValue = "", { includeBlank = false } = {}) {
  const options = [];

  if (includeBlank) {
    options.push(`<option value="">No academy</option>`);
  }

  options.push(
    ...getAcademyOptions().map(
      (academy) => `
        <option value="${academy.id}" ${
          String(selectedValue) === String(academy.id) ? "selected" : ""
        }>
          ${escapeHtml(academy.name)}
        </option>
      `
    )
  );

  return options.join("");
}

function shouldAllowAcademySelection() {
  return getCurrentRole() === "super_admin";
}

function isSelectedRoleSuperAdmin() {
  return String(getRoleNameById(state.formValues.role_id) || "").toLowerCase() === "super_admin";
}

function renderAcademyField() {
  const isSuperAdminViewer = shouldAllowAcademySelection();
  const isSuperAdminTarget = isSelectedRoleSuperAdmin();

  if (!isSuperAdminViewer) {
    return `
      <label>Academy
        <input value="${escapeHtml(
          getAcademyNameById(state.formValues.academy_id) || "Current academy"
        )}" readonly />
      </label>
    `;
  }

  return `
    <label>Academy
      <select name="academy_id" data-user-field="academy_id" ${
        isSuperAdminTarget ? "" : "required"
      }>
        ${renderAcademyOptions(state.formValues.academy_id, { includeBlank: isSuperAdminTarget })}
      </select>
    </label>
  `;
}

function renderForm() {
  const editingUser = getEditingUser();
  const values = state.formValues;
  const isSuperAdminTarget = isSelectedRoleSuperAdmin();

  return `
    <section class="panel staff-form-panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Staff Access</p>
          <h3>${editingUser ? `Update ${escapeHtml(editingUser.name || editingUser.email)}` : "Create staff account"}</h3>
        </div>
        ${
          editingUser
            ? `<button class="btn btn-ghost btn-sm" type="button" id="resetUserForm">New User</button>`
            : ""
        }
      </div>
      <form id="userForm" class="stack-form">
        <div class="staff-form-layout">
          <section class="staff-form-section">
            <div class="staff-form-section-head">
              <h4>Identity</h4>
              <p>Name and contact details for the staff member.</p>
            </div>
            <div class="form-grid">
              <label>Name
                <input
                  name="name"
                  data-user-field="name"
                  value="${escapeHtml(values.name)}"
                  required
                />
              </label>
              <label>Email
                <input
                  name="email"
                  data-user-field="email"
                  type="email"
                  value="${escapeHtml(values.email)}"
                  required
                />
              </label>
              <label>Phone
                <input
                  name="phone"
                  data-user-field="phone"
                  value="${escapeHtml(values.phone)}"
                />
              </label>
            </div>
          </section>

          <section class="staff-form-section">
            <div class="staff-form-section-head">
              <h4>Role & Scope</h4>
              <p>Control what this user can manage and which academy they belong to.</p>
            </div>
            <div class="form-grid">
              <label>Role
                <select name="role_id" data-user-field="role_id" required>
                  ${renderRoleOptions(values.role_id)}
                </select>
              </label>
              ${renderAcademyField()}
              <label>Directory Status
                <select name="status" data-user-field="status">
                  <option value="active" ${values.status === "active" ? "selected" : ""}>active</option>
                  <option value="inactive" ${values.status === "inactive" ? "selected" : ""}>inactive</option>
                </select>
              </label>
              <label>Login Access
                <select name="is_active" data-user-field="is_active">
                  <option value="true" ${values.is_active === "true" ? "selected" : ""}>enabled</option>
                  <option value="false" ${values.is_active === "false" ? "selected" : ""}>disabled</option>
                </select>
              </label>
            </div>
          </section>

          <section class="staff-form-section">
            <div class="staff-form-section-head">
              <h4>Credentials</h4>
              <p>Set the password used for sign-in.</p>
            </div>
            <div class="form-grid">
              <label>Password
                <input
                  name="password"
                  data-user-field="password"
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
              : "Set a temporary password now. Staff can use it immediately to log in."
          }
          ${
            isSuperAdminTarget
              ? " Super admin accounts do not need an academy assignment."
              : ""
          }
        </p>
        <div class="table-actions">
          <button class="btn btn-primary" type="submit" ${state.isSubmitting ? "disabled" : ""}>
            ${
              state.isSubmitting
                ? "Saving..."
                : editingUser
                ? "Update User"
                : "Create User"
            }
          </button>
          <button class="btn btn-ghost" type="button" id="clearUserForm" ${
            state.isSubmitting ? "disabled" : ""
          }>
            Clear
          </button>
          ${
            editingUser
              ? `<button class="btn btn-danger" type="button" id="deleteUserButton" ${
                  state.isSubmitting ? "disabled" : ""
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
        <p class="eyebrow">Staff Directory</p>
        <h3>No users found</h3>
        <p>Create a coach, head coach, academy admin, or other staff account to get started.</p>
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
            <th>Academy Scope</th>
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
                    <span class="staff-role-badge">${escapeHtml(user.role_name || "-")}</span>
                  </td>
                  <td>${escapeHtml(user.academy_name || "All academies")}</td>
                  <td>
                    <div class="staff-status-stack">
                      <span class="status-pill ${
                        user.is_active ? "status-success" : "status-neutral"
                      }">${user.is_active ? "login enabled" : "login disabled"}</span>
                      <span>${escapeHtml(user.status || "-")}</span>
                    </div>
                  </td>
                  <td>${escapeHtml(
                    user.created_at
                      ? new Date(user.created_at).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric"
                        })
                      : "-"
                  )}</td>
                  <td>
                    <div class="table-actions">
                      <button class="btn btn-ghost btn-sm" type="button" data-action="edit-user" data-user-id="${user.id}">
                        Edit
                      </button>
                      <button class="btn btn-danger btn-sm" type="button" data-action="delete-user" data-user-id="${user.id}">
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

function renderAccessDenied() {
  return `
    <section class="page-header">
      <div>
        <p class="eyebrow">Staff Administration</p>
        <h2>Users & Staff</h2>
        <p class="hero-copy">
          Manage coach, head coach, academy admin, and support-staff accounts for each academy.
        </p>
      </div>
    </section>
    ${renderNotice()}
    <div class="empty-panel">
      <p class="eyebrow">Access Required</p>
      <h3>You do not have permission to manage users</h3>
      <p>Only super admins and academy management roles can open the staff directory.</p>
    </div>
  `;
}

function renderUsersPage() {
  const app = getApp();

  if (!app) {
    return;
  }

  if (state.permissionDenied) {
    app.innerHTML = renderAccessDenied();
    bindEvents();
    return;
  }

  const isSuperAdminViewer = shouldAllowAcademySelection();

  app.innerHTML = `
    <section class="page-header">
      <div>
        <p class="eyebrow">Staff Administration</p>
        <h2>Users & Staff</h2>
        <p class="hero-copy">
          Create and maintain coach, head coach, academy admin, and support-staff logins inside the correct academy scope.
        </p>
      </div>
    </section>
    ${renderNotice()}
    ${renderSummaryCards()}
    <section class="staff-workspace-grid">
      ${renderForm()}
      <section class="panel staff-directory-panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Staff Directory</p>
            <h3>Managed user accounts</h3>
          </div>
        </div>
        <div class="toolbar player-filter-bar">
          <input
            id="userSearch"
            placeholder="Search by name, email, phone, role, or academy"
            value="${escapeHtml(state.filters.search)}"
          />
          <select id="userRoleFilter">
            <option value="">All roles</option>
            ${getRoleOptions()
              .map(
                (role) => `
                  <option value="${role.id}" ${
                    String(state.filters.role) === String(role.id) ? "selected" : ""
                  }>
                    ${escapeHtml(role.name)}
                  </option>
                `
              )
              .join("")}
          </select>
          ${
            isSuperAdminViewer
              ? `
                <select id="userAcademyFilter">
                  <option value="">All academies</option>
                  ${getAcademyOptions()
                    .map(
                      (academy) => `
                        <option value="${academy.id}" ${
                          String(state.filters.academyId) === String(academy.id) ? "selected" : ""
                        }>
                          ${escapeHtml(academy.name)}
                        </option>
                      `
                    )
                    .join("")}
                </select>
              `
              : ""
          }
          <select id="userStatusFilter">
            <option value="">All login states</option>
            <option value="enabled" ${state.filters.status === "enabled" ? "selected" : ""}>login enabled</option>
            <option value="disabled" ${state.filters.status === "disabled" ? "selected" : ""}>login disabled</option>
          </select>
        </div>
        ${renderTable()}
      </section>
    </section>
  `;

  bindEvents();
}

function syncFormStateFromDom() {
  const form = document.getElementById("userForm");

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
    academy_id: String(formData.get("academy_id") ?? "").trim(),
    status: String(formData.get("status") ?? "active").trim(),
    is_active: String(formData.get("is_active") ?? "true").trim()
  };
}

async function loadUsers() {
  try {
    if (!canManageUsers()) {
      state.permissionDenied = true;
      renderUsersPage();
      return;
    }

    const [meta, users] = await Promise.all([api.get("/users/meta"), api.get("/users")]);

    state.permissionDenied = false;
    state.meta = meta || state.meta;
    state.users = users || [];

    if (!state.formValues.role_id) {
      state.formValues = getInitializedFormValues(state.formValues);
    }

    if (state.editingUserId && !getEditingUser()) {
      state.editingUserId = null;
      state.formValues = getInitializedFormValues();
    }
  } catch (error) {
    if (/permission/i.test(String(error.message || "").toLowerCase())) {
      state.permissionDenied = true;
    } else {
      setNotice(error.message || "Failed to load users", "danger");
    }
  }

  renderUsersPage();
}

function setEditingUser(userId) {
  const user =
    state.users.find((entry) => String(entry.id) === String(userId || "")) || null;

  if (!user) {
    return;
  }

  state.editingUserId = user.id;
  state.formValues = getInitializedFormValues(user);
  clearNotice();
  renderUsersPage();
}

function buildPayload() {
  const selectedRoleName = getRoleNameById(state.formValues.role_id);
  const isSuperAdminTarget = String(selectedRoleName || "").toLowerCase() === "super_admin";
  const payload = {
    name: state.formValues.name.trim(),
    email: state.formValues.email.trim(),
    phone: state.formValues.phone.trim() || null,
    role_id: state.formValues.role_id ? Number(state.formValues.role_id) : null,
    academy_id:
      isSuperAdminTarget && !state.formValues.academy_id
        ? null
        : state.formValues.academy_id
        ? Number(state.formValues.academy_id)
        : null,
    status: state.formValues.status || "active",
    is_active: state.formValues.is_active === "true"
  };

  if (hasText(state.formValues.password)) {
    payload.password = state.formValues.password;
  }

  return payload;
}

async function saveUser(event) {
  event.preventDefault();
  syncFormStateFromDom();
  state.isSubmitting = true;
  clearNotice();
  renderUsersPage();

  try {
    const payload = buildPayload();

    if (!state.editingUserId && !hasText(payload.password)) {
      throw new Error("password is required");
    }

    if (state.editingUserId) {
      await api.put(`/users/${state.editingUserId}`, payload);
      setNotice("User updated successfully", "success");
    } else {
      await api.post("/users", payload);
      setNotice("User created successfully", "success");
    }

    state.isSubmitting = false;
    state.editingUserId = null;
    state.formValues = getInitializedFormValues();
    await loadUsers();
  } catch (error) {
    state.isSubmitting = false;
    setNotice(error.message || "Unable to save user", "danger");
    renderUsersPage();
  }
}

async function deleteUser(userId) {
  const user =
    state.users.find((entry) => String(entry.id) === String(userId || "")) || null;

  if (!user) {
    return;
  }

  if (
    !window.confirm(
      `Delete ${user.name || user.email}?\n\nThis permanently removes the login account.`
    )
  ) {
    return;
  }

  state.isSubmitting = true;
  clearNotice();
  renderUsersPage();

  try {
    await api.delete(`/users/${user.id}`);
    state.isSubmitting = false;

    if (String(state.editingUserId || "") === String(user.id)) {
      state.editingUserId = null;
      state.formValues = getInitializedFormValues();
    }

    setNotice(`User deleted: ${user.name || user.email}`, "success");
    await loadUsers();
  } catch (error) {
    state.isSubmitting = false;
    setNotice(error.message || "Unable to delete user", "danger");
    renderUsersPage();
  }
}

function bindEvents() {
  document
    .querySelector('[data-action="dismiss-user-notice"]')
    ?.addEventListener("click", () => {
      clearNotice();
      renderUsersPage();
    });

  bindDebouncedSearch(document.getElementById("userSearch"), (value) => {
    state.filters.search = value;
    renderUsersPage();
  });

  document.getElementById("userRoleFilter")?.addEventListener("change", (event) => {
    state.filters.role = event.target.value;
    renderUsersPage();
  });

  document.getElementById("userAcademyFilter")?.addEventListener("change", (event) => {
    state.filters.academyId = event.target.value;
    renderUsersPage();
  });

  document.getElementById("userStatusFilter")?.addEventListener("change", (event) => {
    state.filters.status = event.target.value;
    renderUsersPage();
  });

  document.getElementById("clearUserForm")?.addEventListener("click", () => resetForm());
  document.getElementById("resetUserForm")?.addEventListener("click", () => resetForm());
  document.getElementById("deleteUserButton")?.addEventListener("click", () => {
    deleteUser(state.editingUserId);
  });

  document.querySelectorAll("#userForm [data-user-field]").forEach((element) => {
    const eventName =
      element.tagName === "SELECT" || element.tagName === "TEXTAREA" ? "change" : "input";

    element.addEventListener(eventName, () => {
      syncFormStateFromDom();

      if (element.dataset.userField === "role_id") {
        renderUsersPage();
      }
    });
  });

  document.getElementById("userForm")?.addEventListener("submit", saveUser);

  document.querySelectorAll('[data-action="edit-user"]').forEach((button) => {
    button.addEventListener("click", () => {
      setEditingUser(button.dataset.userId || null);
    });
  });

  document.querySelectorAll('[data-action="delete-user"]').forEach((button) => {
    button.addEventListener("click", () => {
      deleteUser(button.dataset.userId || null);
    });
  });
}

export async function renderUsers() {
  renderUsersPage();
  await loadUsers();
}
