import { api } from "../services/api.js";
import { bindDebouncedSearch } from "../utils/search.js";

const PLAYER_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const state = {
  players: [],
  categories: [],
  academies: [],
  filters: {
    search: "",
    status: "",
    categoryId: "",
    academyId: ""
  },
  editingPlayerId: null,
  notice: null,
  formValues: getEmptyFormValues(),
  pendingPhotoUpload: null,
  isSubmitting: false
};

function getApp() {
  return document.getElementById("app");
}

function getCurrentRole() {
  return String(localStorage.getItem("role") || "").trim().toLowerCase();
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

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function getEmptyFormValues() {
  return {
    academy_id: "",
    name: "",
    category_id: "",
    dob: "",
    gender: "Male",
    father_name: "",
    mother_name: "",
    contact_number_1: "",
    contact_number_2: "",
    email: "",
    address: "",
    photo_url: "",
    joining_date: getToday(),
    status: "active",
    create_parent_account: false,
    parent_account_name: "",
    parent_account_email: "",
    parent_account_phone: "",
    parent_account_password: ""
  };
}

function getDefaultAcademyId() {
  const storedAcademyId = String(localStorage.getItem("academy_id") || "").trim();

  if (storedAcademyId) {
    return storedAcademyId;
  }

  return state.academies[0] ? String(state.academies[0].id) : "";
}

function buildFormValues(source = {}) {
  const defaults = getEmptyFormValues();

  return {
    ...defaults,
    ...source,
    academy_id: hasText(source.academy_id) ? String(source.academy_id) : getDefaultAcademyId(),
    category_id: hasText(source.category_id) ? String(source.category_id) : defaults.category_id,
    dob: hasText(source.dob) ? String(source.dob).slice(0, 10) : defaults.dob,
    gender: hasText(source.gender) ? source.gender : defaults.gender,
    joining_date: hasText(source.joining_date)
      ? String(source.joining_date).slice(0, 10)
      : defaults.joining_date,
    status: hasText(source.status) ? source.status : defaults.status,
    photo_url: hasText(source.photo_url) ? source.photo_url : ""
  };
}

function buildPayloadFromFormValues() {
  const payload = {
    ...state.formValues,
    academy_id: state.formValues.academy_id ? Number(state.formValues.academy_id) : null,
    category_id: state.formValues.category_id ? Number(state.formValues.category_id) : null
  };

  if (!payload.create_parent_account) {
    payload.parent_account_name = "";
    payload.parent_account_email = "";
    payload.parent_account_phone = "";
    payload.parent_account_password = "";
  }

  return payload;
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

function calculateAge(dob) {
  if (!dob) {
    return "-";
  }

  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDelta = today.getMonth() - birthDate.getMonth();

  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }

  return Number.isNaN(age) ? "-" : String(age);
}

function setNotice(message, tone = "info") {
  state.notice = { message, tone };
}

function clearNotice() {
  state.notice = null;
}

function getCategoryName(categoryId) {
  return (
    state.categories.find((category) => String(category.id) === String(categoryId))?.name ||
    "-"
  );
}

function getAcademyName(academyId) {
  return (
    state.academies.find((academy) => String(academy.id) === String(academyId || ""))?.name ||
    "Current academy"
  );
}

function shouldAllowAcademySelection() {
  return getCurrentRole() === "super_admin";
}

function getVisibleCategories() {
  if (!shouldAllowAcademySelection()) {
    return state.categories;
  }

  if (!state.formValues.academy_id) {
    return [];
  }

  return state.categories.filter(
    (category) => String(category.academy_id || "") === String(state.formValues.academy_id)
  );
}

function getEditingPlayer() {
  return (
    state.players.find((player) => String(player.id) === String(state.editingPlayerId || "")) ||
    null
  );
}

function getPhotoPreviewUrl() {
  return state.pendingPhotoUpload?.preview_url || state.formValues.photo_url || "";
}

function getPhotoStatusText() {
  if (state.pendingPhotoUpload) {
    return `New photo selected: ${state.pendingPhotoUpload.file_name}`;
  }

  if (hasText(state.formValues.photo_url)) {
    return "Saved player photo";
  }

  return "No photo selected yet";
}

function getFilteredPlayers() {
  return state.players.filter((player) => {
    const query = state.filters.search.trim().toLowerCase();

    if (query) {
      const haystack = [
        player.name,
        player.email,
        player.contact_number_1,
        player.contact_number_2,
        player.father_name,
        player.mother_name,
        player.address,
        player.category_name
      ]
        .filter(hasText)
        .join(" ")
        .toLowerCase();

      if (!haystack.includes(query)) {
        return false;
      }
    }

    if (state.filters.status && player.status !== state.filters.status) {
      return false;
    }

    if (
      state.filters.categoryId &&
      String(player.category_id) !== String(state.filters.categoryId)
    ) {
      return false;
    }

    if (
      state.filters.academyId &&
      String(player.academy_id) !== String(state.filters.academyId)
    ) {
      return false;
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
      <button class="btn btn-ghost btn-sm" type="button" data-action="dismiss-player-notice">Dismiss</button>
    </div>
  `;
}

function renderSummaryCards() {
  const activePlayers = state.players.filter((player) => player.status === "active").length;
  const femalePlayers = state.players.filter(
    (player) => String(player.gender || "").toLowerCase() === "female"
  ).length;
  const malePlayers = state.players.filter(
    (player) => String(player.gender || "").toLowerCase() === "male"
  ).length;

  return `
    <section class="card-grid">
      <article class="stat-card">
        <span class="stat-label">Registered Players</span>
        <strong>${escapeHtml(String(state.players.length))}</strong>
        <p>Total academy players available in the current registry.</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Active</span>
        <strong>${escapeHtml(String(activePlayers))}</strong>
        <p>Players currently marked as active in the academy database.</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Girls</span>
        <strong>${escapeHtml(String(femalePlayers))}</strong>
        <p>Female players currently registered.</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Boys</span>
        <strong>${escapeHtml(String(malePlayers))}</strong>
        <p>Male players currently registered.</p>
      </article>
    </section>
  `;
}

function renderAcademyFilter() {
  if (!shouldAllowAcademySelection()) {
    return "";
  }

  return `
    <select id="playerAcademyFilter">
      <option value="">All academies</option>
      ${state.academies
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
  `;
}

function renderCategoryOptions(selectedValue = "") {
  return `
    <option value="">Select category</option>
    ${getVisibleCategories()
      .map(
        (category) => `
          <option value="${category.id}" ${
            String(selectedValue) === String(category.id) ? "selected" : ""
          }>
            ${escapeHtml(category.name)}
          </option>
        `
      )
      .join("")}
  `;
}

function renderAcademyField() {
  if (!shouldAllowAcademySelection()) {
    return `
      <label>Academy
        <input value="${escapeHtml(getAcademyName(state.formValues.academy_id))}" readonly />
      </label>
    `;
  }

  return `
    <label>Academy
      <select name="academy_id" data-field="academy_id" required>
        <option value="">Select academy</option>
        ${state.academies
          .map(
            (academy) => `
              <option value="${academy.id}" ${
                String(state.formValues.academy_id) === String(academy.id) ? "selected" : ""
              }>
                ${escapeHtml(academy.name)}
              </option>
            `
          )
          .join("")}
      </select>
    </label>
  `;
}

function renderPhotoCard() {
  const previewUrl = getPhotoPreviewUrl();

  return `
    <div class="player-photo-card">
      <div class="player-photo-preview">
        ${
          previewUrl
            ? `<img src="${escapeHtml(previewUrl)}" alt="Player photo preview" />`
            : `<div class="player-photo-placeholder">No photo</div>`
        }
      </div>
      <div class="player-photo-meta">
        <p class="eyebrow">Player Photo</p>
        <strong>${escapeHtml(getPhotoStatusText())}</strong>
        <p class="form-help">Upload JPG, PNG, or WEBP up to 5 MB. The file is saved only when you save the player.</p>
      </div>
      <div class="table-actions">
        <label class="btn btn-ghost btn-sm player-photo-upload-trigger" for="playerPhotoFile">
          Choose Photo
        </label>
        <input
          id="playerPhotoFile"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          class="player-photo-input"
        />
        ${
          state.pendingPhotoUpload
            ? `<button class="btn btn-ghost btn-sm" type="button" id="discardPendingPhoto">Discard New Photo</button>`
            : ""
        }
        ${
          !state.pendingPhotoUpload && hasText(state.formValues.photo_url)
            ? `<button class="btn btn-ghost btn-sm" type="button" id="removePlayerPhoto">Remove Photo</button>`
            : ""
        }
      </div>
    </div>
  `;
}

function renderPlayerForm() {
  const player = getEditingPlayer();
  const values = state.formValues;

  return `
    <section class="panel player-form-panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Athlete Registry</p>
          <h3>${player ? `Update ${escapeHtml(player.name)}` : "Register athlete"}</h3>
        </div>
        ${
          player
            ? `<button class="btn btn-ghost btn-sm" type="button" id="resetPlayerForm">New Registration</button>`
            : ""
        }
      </div>
      <form id="playerRegistrationForm" class="stack-form">
        ${renderPhotoCard()}
        <div class="athlete-form-layout">
          <section class="athlete-form-section">
            <div class="athlete-form-section-head">
              <h4>Athlete Profile</h4>
              <p>Core sports identity used across categories, attendance, fitness, and match matrix.</p>
            </div>
            <div class="form-grid">
              ${renderAcademyField()}
              <label>Name
                <input name="name" data-field="name" value="${escapeHtml(values.name)}" required />
              </label>
              <label>Category
                <select name="category_id" data-field="category_id" required>
                  ${renderCategoryOptions(values.category_id)}
                </select>
              </label>
              <label>Date of Birth
                <input name="dob" data-field="dob" type="date" value="${escapeHtml(values.dob)}" required />
              </label>
              <label>Gender
                <select name="gender" data-field="gender" required>
                  <option value="Male" ${values.gender === "Male" ? "selected" : ""}>Male</option>
                  <option value="Female" ${values.gender === "Female" ? "selected" : ""}>Female</option>
                  <option value="Other" ${values.gender === "Other" ? "selected" : ""}>Other</option>
                </select>
              </label>
            </div>
          </section>

          <section class="athlete-form-section">
            <div class="athlete-form-section-head">
              <h4>Guardian Contacts</h4>
              <p>Parent and communication details for the player’s family.</p>
            </div>
            <div class="form-grid">
              <label>Father Name
                <input name="father_name" data-field="father_name" value="${escapeHtml(values.father_name)}" />
              </label>
              <label>Mother Name
                <input name="mother_name" data-field="mother_name" value="${escapeHtml(values.mother_name)}" />
              </label>
              <label>Primary Contact
                <input name="contact_number_1" data-field="contact_number_1" value="${escapeHtml(
                  values.contact_number_1
                )}" required />
              </label>
              <label>Secondary Contact
                <input name="contact_number_2" data-field="contact_number_2" value="${escapeHtml(
                  values.contact_number_2
                )}" />
              </label>
              <label>Family Email
                <input name="email" data-field="email" type="email" value="${escapeHtml(values.email)}" />
              </label>
            </div>
            <label>Address
              <textarea name="address" data-field="address" rows="3">${escapeHtml(values.address)}</textarea>
            </label>
          </section>

          ${
            !player
              ? `
                <section class="athlete-form-section athlete-form-section-accent">
                  <div class="athlete-form-section-head">
                    <h4>Parent Portal Account</h4>
                    <p>Optionally create a parent login now and link it directly to this child.</p>
                  </div>
                  <div class="form-toggle">
                    <label class="checkbox-row">
                      <input
                        type="checkbox"
                        name="create_parent_account"
                        data-field="create_parent_account"
                        ${values.create_parent_account ? "checked" : ""}
                      />
                      <span>Create parent login with this child registration</span>
                    </label>
                  </div>
                  ${
                    values.create_parent_account
                      ? `
                        <div class="form-grid">
                          <label>Parent Name
                            <input
                              name="parent_account_name"
                              data-field="parent_account_name"
                              value="${escapeHtml(values.parent_account_name)}"
                              required
                            />
                          </label>
                          <label>Parent Email
                            <input
                              name="parent_account_email"
                              data-field="parent_account_email"
                              type="email"
                              value="${escapeHtml(values.parent_account_email)}"
                              required
                            />
                          </label>
                          <label>Parent Phone
                            <input
                              name="parent_account_phone"
                              data-field="parent_account_phone"
                              value="${escapeHtml(values.parent_account_phone)}"
                              required
                            />
                          </label>
                          <label>Temporary Password
                            <input
                              name="parent_account_password"
                              data-field="parent_account_password"
                              type="password"
                              value="${escapeHtml(values.parent_account_password)}"
                              minlength="6"
                              required
                            />
                          </label>
                        </div>
                      `
                      : ""
                  }
                </section>
              `
              : ""
          }

          <section class="athlete-form-section athlete-form-section-accent">
            <div class="athlete-form-section-head">
              <h4>Academy Registration</h4>
              <p>Registration status and onboarding details for the current academy roster.</p>
            </div>
            <div class="form-grid">
              <label>Joining Date
                <input
                  name="joining_date"
                  data-field="joining_date"
                  type="date"
                  value="${escapeHtml(values.joining_date)}"
                />
              </label>
              <label>Status
                <select name="status" data-field="status">
                  <option value="active" ${values.status === "active" ? "selected" : ""}>active</option>
                  <option value="inactive" ${values.status === "inactive" ? "selected" : ""}>inactive</option>
                </select>
              </label>
              <label>Photo Source
                <input value="${escapeHtml(values.photo_url || "Managed upload")}" readonly />
              </label>
            </div>
          </section>
        </div>
        <div class="table-actions">
          <button class="btn btn-primary" type="submit" ${state.isSubmitting ? "disabled" : ""}>
            ${
              state.isSubmitting
                ? "Saving..."
                : player
                ? "Update Player"
                : "Register Player"
            }
          </button>
          <button class="btn btn-ghost" type="button" id="clearPlayerForm" ${
            state.isSubmitting ? "disabled" : ""
          }>
            Clear Form
          </button>
          ${
            player
              ? `<button class="btn btn-danger" type="button" id="deletePlayerButton" ${
                  state.isSubmitting ? "disabled" : ""
                }>
                  Delete Player
                </button>`
              : ""
          }
        </div>
      </form>
    </section>
  `;
}

function renderPlayerTable() {
  const players = getFilteredPlayers();

  if (!players.length) {
    return `
      <div class="empty-panel compact">
        <p class="eyebrow">Player Registry</p>
        <h3>No players found</h3>
        <p>Adjust the filters or register a new player to get started.</p>
      </div>
    `;
  }

  return `
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Player</th>
            ${shouldAllowAcademySelection() ? "<th>Academy</th>" : ""}
            <th>Category</th>
            <th>Age / DOB</th>
            <th>Guardian</th>
            <th>Parent Portal</th>
            <th>Academy Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${players
            .map(
              (player) => `
                <tr>
                  <td>
                    <div class="player-name-wrap">
                      <strong class="player-name" title="Hover to preview photo">${escapeHtml(
                        player.name
                      )}</strong>
                      ${
                        hasText(player.photo_url)
                          ? `
                            <div class="player-photo-hover" aria-hidden="true">
                              <img src="${escapeHtml(player.photo_url)}" alt="${escapeHtml(
                                player.name
                              )} photo" />
                            </div>
                          `
                          : ""
                      }
                    </div>
                    <div class="player-table-meta">
                      <span>${escapeHtml(player.gender || "-")}</span>
                      <span>${escapeHtml(player.email || "No email")}</span>
                      <span>${escapeHtml(player.address || "No address")}</span>
                    </div>
                  </td>
                  ${
                    shouldAllowAcademySelection()
                      ? `<td>${escapeHtml(player.academy_name || getAcademyName(player.academy_id))}</td>`
                      : ""
                  }
                  <td>${escapeHtml(player.category_name || getCategoryName(player.category_id))}</td>
                  <td>
                    <strong>${escapeHtml(calculateAge(player.dob))}</strong>
                    <div class="player-table-meta">
                      <span>${escapeHtml(formatDate(player.dob))}</span>
                    </div>
                  </td>
                  <td>
                    <strong>${escapeHtml(player.father_name || player.mother_name || "Guardian not set")}</strong>
                    <div class="player-table-meta">
                      <span>${escapeHtml(player.contact_number_1 || "No primary contact")}</span>
                      <span>${escapeHtml(player.email || "No family email")}</span>
                    </div>
                  </td>
                  <td>
                    ${
                      player.parent_linked
                        ? `<span class="status-pill status-success">Linked</span>
                           <div class="player-table-meta">
                             <span>Parent user #${escapeHtml(player.parent_user_id || "-")}</span>
                           </div>`
                        : `<span class="status-pill status-neutral">Not linked</span>`
                    }
                  </td>
                  <td>
                    <span class="status-pill status-${
                      player.status === "active" ? "success" : "neutral"
                    }">${escapeHtml(player.status || "-")}</span>
                  </td>
                  <td>
                    <div class="table-actions">
                      <button class="btn btn-ghost btn-sm" type="button" data-action="edit-player" data-player-id="${player.id}">
                        Edit
                      </button>
                      <button class="btn btn-danger btn-sm" type="button" data-action="delete-player" data-player-id="${player.id}">
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

function renderPlayerRegistry() {
  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Academy Registry</p>
          <h3>Registered players</h3>
        </div>
      </div>
      <div class="toolbar player-filter-bar">
        <input
          id="playerSearch"
          placeholder="Search by name, phone, email, or guardian"
          value="${escapeHtml(state.filters.search)}"
        />
        ${renderAcademyFilter()}
        <select id="playerStatusFilter">
          <option value="">All statuses</option>
          <option value="active" ${state.filters.status === "active" ? "selected" : ""}>active</option>
          <option value="inactive" ${
            state.filters.status === "inactive" ? "selected" : ""
          }>inactive</option>
        </select>
        <select id="playerCategoryFilter">
          <option value="">All categories</option>
          ${state.categories
            .map(
              (category) => `
                <option value="${category.id}" ${
                  String(state.filters.categoryId) === String(category.id) ? "selected" : ""
                }>
                  ${escapeHtml(category.name)}
                </option>
              `
            )
            .join("")}
        </select>
      </div>
      ${renderPlayerTable()}
    </section>
  `;
}

function renderPlayersPage() {
  const app = getApp();

  if (!app) {
    return;
  }

  app.innerHTML = `
    <section class="page-header">
      <div>
        <p class="eyebrow">Academy Operations</p>
        <h2>Player Registration</h2>
        <p class="hero-copy">
          Maintain athlete profiles, guardian contacts, and academy registration details for the active player roster.
        </p>
      </div>
    </section>
    ${renderNotice()}
    ${renderSummaryCards()}
    <section class="player-workspace-grid">
      ${renderPlayerForm()}
      ${renderPlayerRegistry()}
    </section>
  `;

  bindEvents();
}

function resetForm({ preserveNotice = false } = {}) {
  state.editingPlayerId = null;
  state.formValues = buildFormValues();
  state.pendingPhotoUpload = null;

  if (!preserveNotice) {
    clearNotice();
  }

  renderPlayersPage();
}

function setEditingPlayer(playerId) {
  state.editingPlayerId = playerId;
  state.pendingPhotoUpload = null;
  state.formValues = buildFormValues(getEditingPlayer() || {});
  clearNotice();
  renderPlayersPage();
}

async function loadPlayerRegistry() {
  try {
    const [players, categories, academies] = await Promise.all([
      api.get("/players"),
      api.get("/categories"),
      api.get("/academies")
    ]);

    state.players = players || [];
    state.categories = categories || [];
    state.academies = academies || [];

    if (!state.formValues.academy_id) {
      state.formValues = {
        ...state.formValues,
        academy_id: getDefaultAcademyId()
      };
    }

    if (state.editingPlayerId && !getEditingPlayer()) {
      state.editingPlayerId = null;
      state.formValues = buildFormValues();
      state.pendingPhotoUpload = null;
    }
  } catch (error) {
    setNotice(error.message || "Failed to load player registry", "danger");
  }

  renderPlayersPage();
}

function syncFormStateFromDom() {
  const form = document.getElementById("playerRegistrationForm");

  if (!form) {
    return;
  }

  const formData = new FormData(form);
  const nextValues = {};

  for (const key of Object.keys(getEmptyFormValues())) {
    if (key === "create_parent_account") {
      nextValues[key] = form.querySelector('[name="create_parent_account"]')?.checked || false;
      continue;
    }

    nextValues[key] = String(formData.get(key) ?? "").trim();
  }

  state.formValues = {
    ...state.formValues,
    ...nextValues
  };
}

function handleFieldChange(event) {
  const fieldName = event.target?.dataset?.field;

  if (!fieldName) {
    return;
  }

  const fieldValue =
    event.target.type === "checkbox"
      ? event.target.checked
      : String(event.target.value ?? "");

  state.formValues = {
    ...state.formValues,
    [fieldName]: fieldValue
  };

  if (fieldName === "create_parent_account") {
    if (fieldValue) {
      state.formValues = {
        ...state.formValues,
        parent_account_name:
          state.formValues.parent_account_name ||
          state.formValues.father_name ||
          state.formValues.mother_name ||
          "",
        parent_account_email: state.formValues.parent_account_email || state.formValues.email || "",
        parent_account_phone:
          state.formValues.parent_account_phone ||
          state.formValues.contact_number_1 ||
          state.formValues.contact_number_2 ||
          ""
      };
    } else {
      state.formValues = {
        ...state.formValues,
        parent_account_name: "",
        parent_account_email: "",
        parent_account_phone: "",
        parent_account_password: ""
      };
    }

    renderPlayersPage();
    return;
  }

  if (fieldName === "academy_id") {
    const selectedCategoryStillValid = getVisibleCategories().some(
      (category) => String(category.id) === String(state.formValues.category_id)
    );

    if (!selectedCategoryStillValid) {
      state.formValues = {
        ...state.formValues,
        category_id: ""
      };
    }

    renderPlayersPage();
  }

  if (
    state.formValues.create_parent_account &&
    fieldName === "father_name" &&
    !state.formValues.parent_account_name
  ) {
    state.formValues.parent_account_name = fieldValue;
  }

  if (
    state.formValues.create_parent_account &&
    fieldName === "mother_name" &&
    !state.formValues.parent_account_name
  ) {
    state.formValues.parent_account_name = fieldValue;
  }

  if (
    state.formValues.create_parent_account &&
    fieldName === "email" &&
    !state.formValues.parent_account_email
  ) {
    state.formValues.parent_account_email = fieldValue;
  }

  if (
    state.formValues.create_parent_account &&
    (fieldName === "contact_number_1" || fieldName === "contact_number_2") &&
    !state.formValues.parent_account_phone
  ) {
    state.formValues.parent_account_phone = fieldValue;
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to read the selected photo file"));
    reader.readAsDataURL(file);
  });
}

async function handlePhotoSelection(event) {
  const [file] = event.target.files || [];

  if (!file) {
    return;
  }

  if (!ALLOWED_PHOTO_TYPES.has(file.type)) {
    setNotice("Only JPG, PNG, and WEBP files can be uploaded for player photos", "danger");
    renderPlayersPage();
    return;
  }

  if (file.size > PLAYER_PHOTO_MAX_BYTES) {
    setNotice("Player photo must be 5 MB or smaller", "danger");
    renderPlayersPage();
    return;
  }

  try {
    const dataUrl = await readFileAsDataUrl(file);
    const dataBase64 = dataUrl.split(",")[1] || "";

    state.pendingPhotoUpload = {
      file_name: file.name,
      content_type: file.type,
      data_base64: dataBase64,
      preview_url: dataUrl
    };
    clearNotice();
  } catch (error) {
    setNotice(error.message || "Unable to prepare player photo", "danger");
  }

  renderPlayersPage();
}

async function uploadPendingPhoto(playerId, academyId) {
  if (!state.pendingPhotoUpload) {
    return null;
  }

  return api.post("/players/photo-upload", {
    academy_id: academyId,
    player_id: playerId,
    file_name: state.pendingPhotoUpload.file_name,
    content_type: state.pendingPhotoUpload.content_type,
    data_base64: state.pendingPhotoUpload.data_base64
  });
}

async function persistPlayer(event) {
  event.preventDefault();
  syncFormStateFromDom();

  const basePayload = buildPayloadFromFormValues();
  const wasEditing = Boolean(state.editingPlayerId);
  const actionLabel = wasEditing ? "updated" : "registered";
  const hadPendingPhoto = Boolean(state.pendingPhotoUpload);

  state.isSubmitting = true;
  clearNotice();
  renderPlayersPage();

  try {
    let player = null;

    if (wasEditing) {
      player = await api.put(`/players/${state.editingPlayerId}`, basePayload);
    } else {
      player = await api.post("/players", basePayload);
    }

    if (state.pendingPhotoUpload) {
      try {
        const upload = await uploadPendingPhoto(
          player.id,
          player.academy_id || basePayload.academy_id
        );

        player = await api.put(`/players/${player.id}`, {
          ...basePayload,
          photo_url: upload.photo_url
        });
      } catch (uploadError) {
        state.isSubmitting = false;
        state.editingPlayerId = player.id;
        state.formValues = buildFormValues(player);
        state.pendingPhotoUpload = null;
        setNotice(
          `Player ${actionLabel}, but photo upload failed: ${uploadError.message}`,
          "danger"
        );
        await loadPlayerRegistry();
        return;
      }
    }

    state.isSubmitting = false;
    state.editingPlayerId = null;
    state.formValues = buildFormValues();
    state.pendingPhotoUpload = null;
    setNotice(
      hadPendingPhoto
        ? player.parent_account_created
          ? `Player ${actionLabel} successfully with photo and parent account created`
          : `Player ${actionLabel} successfully with photo`
        : player.parent_account_created
        ? `Player ${actionLabel} successfully and parent account created`
        : `Player ${actionLabel} successfully`,
      "success"
    );
    await loadPlayerRegistry();
  } catch (error) {
    state.isSubmitting = false;
    setNotice(error.message || "Unable to save player", "danger");
    renderPlayersPage();
  }
}

async function handleDeletePlayer(playerId) {
  const player =
    state.players.find((entry) => String(entry.id) === String(playerId || "")) || null;

  if (!player) {
    setNotice("Player not found", "danger");
    renderPlayersPage();
    return;
  }

  const confirmed = window.confirm(
    `Delete ${player.name} from the academy registry?\n\nThis will be blocked automatically if the player is already linked to tournament registrations.`
  );

  if (!confirmed) {
    return;
  }

  state.isSubmitting = true;
  clearNotice();
  renderPlayersPage();

  try {
    await api.delete(`/players/${player.id}`);

    state.isSubmitting = false;

    if (String(state.editingPlayerId || "") === String(player.id)) {
      state.editingPlayerId = null;
      state.formValues = buildFormValues();
      state.pendingPhotoUpload = null;
    }

    setNotice(`Player deleted successfully: ${player.name}`, "success");
    await loadPlayerRegistry();
  } catch (error) {
    state.isSubmitting = false;
    setNotice(error.message || "Unable to delete player", "danger");
    renderPlayersPage();
  }
}

function bindEvents() {
  document
    .querySelector('[data-action="dismiss-player-notice"]')
    ?.addEventListener("click", () => {
      clearNotice();
      renderPlayersPage();
    });

  bindDebouncedSearch(document.getElementById("playerSearch"), (value) => {
    state.filters.search = value;
    renderPlayersPage();
  });

  document.getElementById("playerStatusFilter")?.addEventListener("change", (event) => {
    state.filters.status = event.target.value;
    renderPlayersPage();
  });

  document.getElementById("playerCategoryFilter")?.addEventListener("change", (event) => {
    state.filters.categoryId = event.target.value;
    renderPlayersPage();
  });

  document.getElementById("playerAcademyFilter")?.addEventListener("change", (event) => {
    state.filters.academyId = event.target.value;
    renderPlayersPage();
  });

  document.getElementById("clearPlayerForm")?.addEventListener("click", () => resetForm());
  document.getElementById("resetPlayerForm")?.addEventListener("click", () => resetForm());
  document.getElementById("discardPendingPhoto")?.addEventListener("click", () => {
    state.pendingPhotoUpload = null;
    clearNotice();
    renderPlayersPage();
  });
  document.getElementById("removePlayerPhoto")?.addEventListener("click", () => {
    state.pendingPhotoUpload = null;
    state.formValues = {
      ...state.formValues,
      photo_url: ""
    };
    clearNotice();
    renderPlayersPage();
  });
  document.getElementById("deletePlayerButton")?.addEventListener("click", () => {
    handleDeletePlayer(state.editingPlayerId);
  });

  document
    .querySelectorAll("#playerRegistrationForm [data-field]")
    .forEach((element) => {
      const eventName =
        element.tagName === "SELECT" || element.tagName === "TEXTAREA" ? "change" : "input";

      element.addEventListener(eventName, handleFieldChange);
    });

  document.getElementById("playerPhotoFile")?.addEventListener("change", handlePhotoSelection);

  document.getElementById("playerRegistrationForm")?.addEventListener("submit", persistPlayer);

  document.querySelectorAll('[data-action="edit-player"]').forEach((button) => {
    button.addEventListener("click", () => {
      setEditingPlayer(button.dataset.playerId || null);
    });
  });

  document.querySelectorAll('[data-action="delete-player"]').forEach((button) => {
    button.addEventListener("click", () => {
      handleDeletePlayer(button.dataset.playerId || null);
    });
  });
}

export async function renderPlayers() {
  renderPlayersPage();
  await loadPlayerRegistry();
}
