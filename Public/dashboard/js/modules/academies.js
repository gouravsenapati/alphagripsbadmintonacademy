import { api } from "../services/api.js";
import { bindDebouncedSearch } from "../utils/search.js";

const state = {
  academies: [],
  staff: [],
  notice: null,
  editingAcademy: null,
  filters: {
    search: ""
  }
};

function getApp() {
  return document.getElementById("app");
}

function getCurrentRole() {
  return String(localStorage.getItem("role") || "").trim().toLowerCase();
}

function isSuperAdmin() {
  return getCurrentRole() === "super_admin";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setNotice(message, tone = "info") {
  state.notice = { message, tone };
}

function clearNotice() {
  state.notice = null;
}

function renderNotice() {
  if (!state.notice) {
    return "";
  }

  return `
    <div class="notice notice-${escapeHtml(state.notice.tone)}">
      <span>${escapeHtml(state.notice.message)}</span>
      <button class="btn btn-ghost btn-sm" type="button" data-action="dismiss-academy-notice">Dismiss</button>
    </div>
  `;
}

function getFilteredAcademies() {
  const query = state.filters.search.trim().toLowerCase();

  if (!query) {
    return state.academies;
  }

  return state.academies.filter((academy) => {
    const haystack = [
      academy.name,
      academy.location,
      academy.address,
      academy.contact_details,
      academy.assigned_manager_name,
      academy.assigned_manager_email
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });
}

function renderManagerOptions(selectedValue = "") {
  const managers = state.staff.filter((user) => {
    const roleName = String(user.role || user.role_name || "").toLowerCase();
    return ["academy_admin", "head_coach"].includes(roleName);
  });

  return `
    <option value="">Select manager</option>
    ${managers
      .map(
        (manager) => `
          <option value="${manager.id}" ${
            String(selectedValue) === String(manager.id) ? "selected" : ""
          }>
            ${escapeHtml(manager.name || "-")} (${escapeHtml(manager.role || manager.role_name || "-")})
          </option>
        `
      )
      .join("")}
  `;
}

function renderCreateForm() {
  if (!isSuperAdmin()) {
    return `
      <section class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Academy Directory</p>
            <h3>Academies</h3>
          </div>
        </div>
        <div class="empty-panel compact">
          <h3>Access restricted</h3>
          <p>Only super admin can create new academies.</p>
        </div>
      </section>
    `;
  }

  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Super Admin</p>
          <h3>Create academy</h3>
        </div>
      </div>
      <form id="academyCreateForm" class="stack-form">
        <label>Academy Name
          <input name="name" required />
        </label>
        <label>Location
          <input name="location" placeholder="City / Area" />
        </label>
        <label>Contact Details
          <textarea name="contact_details" rows="3" placeholder="Phone, email, address notes"></textarea>
        </label>
        <label>Assigned Manager
          <select name="assigned_manager_user_id">
            ${renderManagerOptions("")}
          </select>
        </label>
        <div class="table-actions">
          <button class="btn btn-primary" type="submit">Create Academy</button>
        </div>
      </form>
    </section>
  `;
}

function renderEditForm() {
  if (!isSuperAdmin() || !state.editingAcademy) {
    return "";
  }

  const academy = state.editingAcademy;

  return `
    <section class="panel panel-warn">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Super Admin</p>
          <h3>Edit academy</h3>
        </div>
        <button class="btn btn-ghost btn-sm" type="button" data-action="cancel-academy-edit">Cancel</button>
      </div>
      <form id="academyEditForm" class="stack-form" data-academy-id="${escapeHtml(String(academy.id))}">
        <label>Academy Name
          <input name="name" required value="${escapeHtml(academy.name || "")}" />
        </label>
        <label>Location
          <input name="location" placeholder="City / Area" value="${escapeHtml(academy.location || academy.address || "")}" />
        </label>
        <label>Contact Details
          <textarea name="contact_details" rows="3" placeholder="Phone, email, address notes">${escapeHtml(
            academy.contact_details || ""
          )}</textarea>
        </label>
        <label>Assigned Manager
          <select name="assigned_manager_user_id">
            ${renderManagerOptions(academy.assigned_manager_user_id)}
          </select>
        </label>
        <div class="table-actions">
          <button class="btn btn-primary" type="submit">Save Changes</button>
        </div>
      </form>
    </section>
  `;
}

function renderAcademyList() {
  const academies = getFilteredAcademies();

  if (!academies.length) {
    return `
      <div class="empty-panel compact">
        <p class="eyebrow">Academies</p>
        <h3>No academies found</h3>
        <p>Create an academy to get started.</p>
      </div>
    `;
  }

  return `
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Academy</th>
            <th>Location</th>
            <th>Contact</th>
            <th>Manager</th>
            ${isSuperAdmin() ? "<th>Actions</th>" : ""}
          </tr>
        </thead>
        <tbody>
          ${academies
            .map(
              (academy) => `
                <tr>
                  <td>
                    <strong>${escapeHtml(academy.name || "-")}</strong>
                    <div class="table-subtext">ID ${escapeHtml(String(academy.id))}</div>
                  </td>
                  <td>${escapeHtml(academy.location || academy.address || "-")}</td>
                  <td>${escapeHtml(academy.contact_details || "-")}</td>
                  <td>
                    ${escapeHtml(academy.assigned_manager_name || "-")}
                    ${
                      academy.assigned_manager_email
                        ? `<div class="table-subtext">${escapeHtml(academy.assigned_manager_email)}</div>`
                        : ""
                    }
                  </td>
                  ${
                    isSuperAdmin()
                      ? `<td>
                          <button class="btn btn-ghost btn-sm" type="button" data-action="edit-academy" data-id="${escapeHtml(
                            String(academy.id)
                          )}">Edit</button>
                        </td>`
                      : ""
                  }
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderPage() {
  const app = getApp();

  if (!app) {
    return;
  }

  app.innerHTML = `
    <section class="page-header">
      <div>
        <p class="eyebrow">Academy Setup</p>
        <h2>Academies</h2>
        <p class="hero-copy">Create and manage academy branches. Only super admin can add new academies.</p>
      </div>
    </section>
    ${renderNotice()}
    <section class="player-workspace-grid">
      ${renderCreateForm()}
      ${renderEditForm()}
      <section class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Directory</p>
            <h3>Academy list</h3>
          </div>
        </div>
        <div class="toolbar player-filter-bar">
          <input id="academySearch" placeholder="Search academies, manager, or location" value="${escapeHtml(
            state.filters.search
          )}" />
          <button class="btn btn-ghost" type="button" id="refreshAcademies">Refresh</button>
        </div>
        ${renderAcademyList()}
      </section>
    </section>
  `;

  bindEvents();
}

async function loadData() {
  try {
    const [academies, staff] = await Promise.all([api.get("/academies"), api.get("/users")]);
    state.academies = academies || [];
    state.staff = staff || [];
  } catch (error) {
    setNotice(error.message || "Failed to load academies", "danger");
  }

  renderPage();
}

async function createAcademy(event) {
  event.preventDefault();

  try {
    const form = event.currentTarget;
    const payload = {
      name: String(form.name.value || "").trim(),
      location: String(form.location.value || "").trim(),
      contact_details: String(form.contact_details.value || "").trim(),
      assigned_manager_user_id: form.assigned_manager_user_id.value
        ? Number(form.assigned_manager_user_id.value)
        : null
    };

    await api.post("/academies", payload);
    setNotice("Academy created successfully.", "success");
    await loadData();
  } catch (error) {
    setNotice(error.message || "Unable to create academy", "danger");
    renderPage();
  }
}

async function updateAcademy(event) {
  event.preventDefault();

  try {
    const form = event.currentTarget;
    const academyId = form.dataset.academyId;
    const payload = {
      name: String(form.name.value || "").trim(),
      location: String(form.location.value || "").trim(),
      contact_details: String(form.contact_details.value || "").trim(),
      assigned_manager_user_id: form.assigned_manager_user_id.value
        ? Number(form.assigned_manager_user_id.value)
        : null
    };

    await api.patch(`/academies/${academyId}`, payload);
    setNotice("Academy updated successfully.", "success");
    state.editingAcademy = null;
    await loadData();
  } catch (error) {
    setNotice(error.message || "Unable to update academy", "danger");
    renderPage();
  }
}

function bindEvents() {
  document
    .querySelector('[data-action="dismiss-academy-notice"]')
    ?.addEventListener("click", () => {
      clearNotice();
      renderPage();
    });

  document.getElementById("academyCreateForm")?.addEventListener("submit", createAcademy);
  document.getElementById("academyEditForm")?.addEventListener("submit", updateAcademy);

  document.querySelectorAll('[data-action="edit-academy"]').forEach((button) => {
    button.addEventListener("click", () => {
      const academyId = button.dataset.id;
      state.editingAcademy = state.academies.find((academy) => String(academy.id) === String(academyId)) || null;
      renderPage();
    });
  });

  document.querySelector('[data-action="cancel-academy-edit"]')?.addEventListener("click", () => {
    state.editingAcademy = null;
    renderPage();
  });

  bindDebouncedSearch(document.getElementById("academySearch"), (value) => {
    state.filters.search = value;
    renderPage();
  });

  document.getElementById("refreshAcademies")?.addEventListener("click", () => {
    loadData();
  });
}

export async function renderAcademies() {
  renderPage();
  await loadData();
}
