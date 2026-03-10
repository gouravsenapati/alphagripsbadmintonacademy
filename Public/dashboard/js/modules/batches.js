import { api } from "../services/api.js";
import { bindDebouncedSearch } from "../utils/search.js";

const state = {
  batches: [],
  filters: {
    search: ""
  },
  editingBatchId: null,
  formValues: {
    name: "",
    capacity: ""
  },
  notice: null
};

function getApp() {
  return document.getElementById("app");
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

function getEditingBatch() {
  return state.batches.find((batch) => String(batch.id) === String(state.editingBatchId || "")) || null;
}

function getFilteredBatches() {
  const query = state.filters.search.trim().toLowerCase();

  if (!query) {
    return state.batches;
  }

  return state.batches.filter((batch) =>
    `${batch.name || ""} ${batch.capacity || ""}`.toLowerCase().includes(query)
  );
}

function renderNotice() {
  if (!state.notice) {
    return "";
  }

  return `
    <div class="notice notice-${escapeHtml(state.notice.tone)}">
      <span>${escapeHtml(state.notice.message)}</span>
      <button class="btn btn-ghost btn-sm" type="button" data-action="dismiss-batch-notice">Dismiss</button>
    </div>
  `;
}

function renderSummary() {
  const activeBatches = state.batches.filter(
    (batch) => Number(batch.active_assignment_count || 0) > 0
  ).length;
  const assignedPlayers = state.batches.reduce(
    (sum, batch) => sum + Number(batch.active_assignment_count || 0),
    0
  );
  const totalSessions = state.batches.reduce(
    (sum, batch) => sum + Number(batch.session_count || 0),
    0
  );

  return `
    <section class="card-grid">
      <article class="stat-card">
        <span class="stat-label">Batches</span>
        <strong>${escapeHtml(String(state.batches.length))}</strong>
        <p>Total training batches configured for the academy.</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Active Batches</span>
        <strong>${escapeHtml(String(activeBatches))}</strong>
        <p>Batches with at least one active player assignment.</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Assigned Players</span>
        <strong>${escapeHtml(String(assignedPlayers))}</strong>
        <p>Current active player-to-batch assignments.</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Sessions Logged</span>
        <strong>${escapeHtml(String(totalSessions))}</strong>
        <p>Training sessions already created for attendance tracking.</p>
      </article>
    </section>
  `;
}

function renderForm() {
  const editing = getEditingBatch();

  return `
    <section class="panel player-form-panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Batch Setup</p>
          <h3>${editing ? "Update batch" : "Create batch"}</h3>
        </div>
        ${
          editing
            ? `<button class="btn btn-ghost btn-sm" type="button" id="resetBatchForm">New Batch</button>`
            : ""
        }
      </div>
      <form id="batchForm" class="stack-form">
        <label>Batch Name
          <input name="name" value="${escapeHtml(state.formValues.name)}" required />
        </label>
        <label>Capacity
          <input name="capacity" type="number" min="1" value="${escapeHtml(state.formValues.capacity)}" />
        </label>
        <div class="table-actions">
          <button class="btn btn-primary" type="submit">${editing ? "Update Batch" : "Create Batch"}</button>
          <button class="btn btn-ghost" type="button" id="clearBatchForm">Clear</button>
          ${
            editing
              ? `<button class="btn btn-danger" type="button" id="deleteBatchButton">Delete</button>`
              : ""
          }
        </div>
      </form>
    </section>
  `;
}

function renderTable() {
  const batches = getFilteredBatches();

  if (!batches.length) {
    return `
      <div class="empty-panel compact">
        <p class="eyebrow">Batches</p>
        <h3>No batches found</h3>
        <p>Create training batches so players can be grouped and attendance can be tracked.</p>
      </div>
    `;
  }

  return `
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Batch</th>
            <th>Capacity</th>
            <th>Players</th>
            <th>Sessions</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${batches
            .map(
              (batch) => `
                <tr>
                  <td><strong>${escapeHtml(batch.name)}</strong></td>
                  <td>${escapeHtml(batch.capacity || "-")}</td>
                  <td>${escapeHtml(String(batch.active_assignment_count || 0))}</td>
                  <td>${escapeHtml(String(batch.session_count || 0))}</td>
                  <td>
                    <div class="table-actions">
                      <button class="btn btn-ghost btn-sm" type="button" data-action="edit-batch" data-id="${batch.id}">Edit</button>
                      <button class="btn btn-danger btn-sm" type="button" data-action="delete-batch" data-id="${batch.id}">Delete</button>
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

function renderPage() {
  const app = getApp();

  if (!app) {
    return;
  }

  app.innerHTML = `
    <section class="page-header">
      <div>
        <p class="eyebrow">Academy Structure</p>
        <h2>Batches</h2>
        <p class="hero-copy">
          Manage training batches, their capacity, and the operating groups used for player assignments and attendance.
        </p>
      </div>
    </section>
    ${renderNotice()}
    ${renderSummary()}
    <section class="player-workspace-grid">
      ${renderForm()}
      <section class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Batch Registry</p>
            <h3>Configured batches</h3>
          </div>
        </div>
        <div class="toolbar player-filter-bar">
          <input id="batchSearch" placeholder="Search batches" value="${escapeHtml(
            state.filters.search
          )}" />
        </div>
        ${renderTable()}
      </section>
    </section>
  `;

  bindEvents();
}

function resetForm() {
  state.editingBatchId = null;
  state.formValues = {
    name: "",
    capacity: ""
  };
  clearNotice();
  renderPage();
}

async function loadBatches() {
  try {
    state.batches = (await api.get("/batches")) || [];

    if (state.editingBatchId && !getEditingBatch()) {
      resetForm();
      return;
    }
  } catch (error) {
    setNotice(error.message || "Failed to load batches", "danger");
  }

  renderPage();
}

async function saveBatch(event) {
  event.preventDefault();

  try {
    const payload = {
      name: event.currentTarget.name.value.trim(),
      capacity: event.currentTarget.capacity.value.trim()
        ? Number(event.currentTarget.capacity.value)
        : null
    };

    if (state.editingBatchId) {
      await api.put(`/batches/${state.editingBatchId}`, payload);
      setNotice("Batch updated successfully", "success");
    } else {
      await api.post("/batches", payload);
      setNotice("Batch created successfully", "success");
    }

    resetForm();
    await loadBatches();
  } catch (error) {
    state.formValues = {
      name: event.currentTarget.name.value.trim(),
      capacity: event.currentTarget.capacity.value.trim()
    };
    setNotice(error.message || "Unable to save batch", "danger");
    renderPage();
  }
}

async function deleteBatch(batchId) {
  const batch = state.batches.find((entry) => String(entry.id) === String(batchId || "")) || null;

  if (!batch) {
    return;
  }

  if (!window.confirm(`Delete batch "${batch.name}"?`)) {
    return;
  }

  try {
    await api.delete(`/batches/${batch.id}`);

    if (String(state.editingBatchId || "") === String(batch.id)) {
      resetForm();
    }

    setNotice(`Batch deleted: ${batch.name}`, "success");
    await loadBatches();
  } catch (error) {
    setNotice(error.message || "Unable to delete batch", "danger");
    renderPage();
  }
}

function bindEvents() {
  document
    .querySelector('[data-action="dismiss-batch-notice"]')
    ?.addEventListener("click", () => {
      clearNotice();
      renderPage();
    });

  bindDebouncedSearch(document.getElementById("batchSearch"), (value) => {
    state.filters.search = value;
    renderPage();
  });

  document.getElementById("batchForm")?.addEventListener("submit", saveBatch);
  document.getElementById("clearBatchForm")?.addEventListener("click", resetForm);
  document.getElementById("resetBatchForm")?.addEventListener("click", resetForm);
  document.getElementById("deleteBatchButton")?.addEventListener("click", () => {
    deleteBatch(state.editingBatchId);
  });

  document.querySelectorAll('[data-action="edit-batch"]').forEach((button) => {
    button.addEventListener("click", () => {
      state.editingBatchId = button.dataset.id || null;
      const batch = getEditingBatch();
      state.formValues = {
        name: batch?.name || "",
        capacity: batch?.capacity ? String(batch.capacity) : ""
      };
      clearNotice();
      renderPage();
    });
  });

  document.querySelectorAll('[data-action="delete-batch"]').forEach((button) => {
    button.addEventListener("click", () => {
      deleteBatch(button.dataset.id || null);
    });
  });
}

export async function renderBatches() {
  renderPage();
  await loadBatches();
}
