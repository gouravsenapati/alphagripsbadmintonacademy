import { api } from "../services/api.js";
import { bindDebouncedSearch } from "../utils/search.js";

const state = {
  assignments: [],
  players: [],
  batches: [],
  filters: {
    search: "",
    status: "",
    batchId: ""
  },
  editingAssignmentId: null,
  formValues: {
    player_id: "",
    batch_id: "",
    status: "active"
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

function getEditingAssignment() {
  return (
    state.assignments.find(
      (assignment) => String(assignment.id) === String(state.editingAssignmentId || "")
    ) || null
  );
}

function renderNotice() {
  if (!state.notice) {
    return "";
  }

  return `
    <div class="notice notice-${escapeHtml(state.notice.tone)}">
      <span>${escapeHtml(state.notice.message)}</span>
      <button class="btn btn-ghost btn-sm" type="button" data-action="dismiss-assignment-notice">Dismiss</button>
    </div>
  `;
}

function renderPlayerOptions() {
  return `
    <option value="">Select player</option>
    ${state.players
      .map(
        (player) => `
          <option value="${player.id}" ${
            String(state.formValues.player_id) === String(player.id) ? "selected" : ""
          }>
            ${escapeHtml(player.name)}${player.category_name ? ` · ${escapeHtml(player.category_name)}` : ""}
          </option>
        `
      )
      .join("")}
  `;
}

function renderBatchOptions(includeAllOption = false, selectedValue = state.formValues.batch_id) {
  return `
    ${includeAllOption ? `<option value="">All batches</option>` : `<option value="">Select batch</option>`}
    ${state.batches
      .map(
        (batch) => `
          <option value="${batch.id}" ${
            String(selectedValue) === String(batch.id) ? "selected" : ""
          }>
            ${escapeHtml(batch.name)}
          </option>
        `
      )
      .join("")}
  `;
}

function getFilteredAssignments() {
  const query = state.filters.search.trim().toLowerCase();

  return state.assignments.filter((assignment) => {
    if (query) {
      const haystack = [
        assignment.player_name,
        assignment.batch_name,
        assignment.player_contact_number_1,
        assignment.category_name
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (!haystack.includes(query)) {
        return false;
      }
    }

    if (state.filters.status && assignment.status !== state.filters.status) {
      return false;
    }

    if (state.filters.batchId && String(assignment.batch_id) !== String(state.filters.batchId)) {
      return false;
    }

    return true;
  });
}

function renderSummary() {
  const activeAssignments = state.assignments.filter(
    (assignment) => assignment.status === "active"
  ).length;
  const inactiveAssignments = state.assignments.length - activeAssignments;
  const coveredBatches = new Set(
    state.assignments.filter((assignment) => assignment.status === "active").map((assignment) => assignment.batch_id)
  ).size;

  return `
    <section class="card-grid">
      <article class="stat-card">
        <span class="stat-label">Assignment History</span>
        <strong>${escapeHtml(String(state.assignments.length))}</strong>
        <p>Total player-to-batch links currently tracked.</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Active</span>
        <strong>${escapeHtml(String(activeAssignments))}</strong>
        <p>Players currently active inside their assigned batches.</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Inactive</span>
        <strong>${escapeHtml(String(inactiveAssignments))}</strong>
        <p>Assignments kept for history but not currently active.</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Covered Batches</span>
        <strong>${escapeHtml(String(coveredBatches))}</strong>
        <p>Batches with at least one active player assignment.</p>
      </article>
    </section>
  `;
}

function renderForm() {
  const editing = getEditingAssignment();
  const editingAssignment = getEditingAssignment();
  const isEditingActive = editingAssignment?.status === "active";

  return `
    <section class="panel player-form-panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Player Movement</p>
          <h3>${editing ? "Update or move player" : "Assign or move player"}</h3>
        </div>
        ${
          editing
            ? `<button class="btn btn-ghost btn-sm" type="button" id="resetAssignmentForm">New Assignment</button>`
            : ""
        }
      </div>
      <form id="assignmentForm" class="stack-form">
        <p class="form-help">
          Active assignments are treated as the player's current batch. Saving a player into a different active batch will automatically archive the previous active assignment and keep the new one as current.
        </p>
        <label>Player
          <select name="player_id" ${editing ? "disabled" : ""} required>
            ${renderPlayerOptions()}
          </select>
        </label>
        <label>Batch
          <select name="batch_id" required>
            ${renderBatchOptions(false)}
          </select>
        </label>
        <label>Status
          <select name="status">
            <option value="active" ${state.formValues.status === "active" ? "selected" : ""}>active</option>
            <option value="inactive" ${state.formValues.status === "inactive" ? "selected" : ""}>inactive</option>
          </select>
        </label>
        ${
          isEditingActive
            ? `<p class="field-note">Changing the batch while keeping status active will move this player and preserve the old batch as inactive history.</p>`
            : ""
        }
        <div class="table-actions">
          <button class="btn btn-primary" type="submit">${editing ? "Save Assignment" : "Create Assignment"}</button>
          <button class="btn btn-ghost" type="button" id="clearAssignmentForm">Clear</button>
          ${
            editing
              ? `<button class="btn btn-danger" type="button" id="deleteAssignmentButton">Delete</button>`
              : ""
          }
        </div>
      </form>
    </section>
  `;
}

function renderTable() {
  const assignments = getFilteredAssignments().sort((left, right) => {
    const leftWeight = left.status === "active" ? 0 : 1;
    const rightWeight = right.status === "active" ? 0 : 1;

    if (leftWeight !== rightWeight) {
      return leftWeight - rightWeight;
    }

    return String(left.player_name || "").localeCompare(String(right.player_name || ""));
  });

  if (!assignments.length) {
    return `
      <div class="empty-panel compact">
        <p class="eyebrow">Batch Assignments</p>
        <h3>No assignments found</h3>
        <p>Assign players to batches so attendance can be marked session by session.</p>
      </div>
    `;
  }

  return `
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>Batch</th>
            <th>Status</th>
            <th>Current</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${assignments
            .map(
              (assignment) => `
                <tr>
                  <td>
                    <strong>${escapeHtml(assignment.player_name || "-")}</strong>
                    <div class="player-table-meta">
                      <span>${escapeHtml(assignment.category_name || "-")}</span>
                      <span>${escapeHtml(assignment.player_contact_number_1 || "No contact")}</span>
                    </div>
                  </td>
                  <td>
                    <strong>${escapeHtml(assignment.batch_name || "-")}</strong>
                    <div class="player-table-meta">
                      <span>Capacity: ${escapeHtml(assignment.batch_capacity || "-")}</span>
                    </div>
                  </td>
                  <td>
                    <span class="status-pill status-${
                      assignment.status === "active" ? "success" : "neutral"
                    }">${escapeHtml(assignment.status || "-")}</span>
                  </td>
                  <td>
                    ${
                      assignment.status === "active"
                        ? `<span class="status-pill status-accent">Current Batch</span>`
                        : `<span class="status-pill status-neutral">History</span>`
                    }
                  </td>
                  <td>
                    <div class="table-actions">
                      <button class="btn btn-ghost btn-sm" type="button" data-action="edit-assignment" data-id="${assignment.id}">Edit</button>
                      <button class="btn btn-danger btn-sm" type="button" data-action="delete-assignment" data-id="${assignment.id}">Delete</button>
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
        <p class="eyebrow">Academy Operations</p>
        <h2>Batch Assignments</h2>
        <p class="hero-copy">
          Connect academy players to training batches and keep one active batch per player so attendance and future training flow stay aligned.
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
            <p class="eyebrow">Assignment Registry</p>
            <h3>Player-batch links</h3>
          </div>
        </div>
        <div class="toolbar player-filter-bar">
          <input id="assignmentSearch" placeholder="Search player, batch, or category" value="${escapeHtml(
            state.filters.search
          )}" />
          <select id="assignmentStatusFilter">
            <option value="">All statuses</option>
            <option value="active" ${state.filters.status === "active" ? "selected" : ""}>active</option>
            <option value="inactive" ${state.filters.status === "inactive" ? "selected" : ""}>inactive</option>
          </select>
          <select id="assignmentBatchFilter">
            ${renderBatchOptions(true, state.filters.batchId)}
          </select>
        </div>
        ${renderTable()}
      </section>
    </section>
  `;

  bindEvents();
}

function resetForm() {
  state.editingAssignmentId = null;
  state.formValues = {
    player_id: "",
    batch_id: "",
    status: "active"
  };
  clearNotice();
  renderPage();
}

async function loadData() {
  try {
    const [assignments, players, batches] = await Promise.all([
      api.get("/player-batches"),
      api.get("/players"),
      api.get("/batches")
    ]);

    state.assignments = assignments || [];
    state.players = (players || []).filter((player) => player.status === "active");
    state.batches = batches || [];

    if (state.editingAssignmentId && !getEditingAssignment()) {
      resetForm();
      return;
    }
  } catch (error) {
    setNotice(error.message || "Failed to load assignment data", "danger");
  }

  renderPage();
}

async function saveAssignment(event) {
  event.preventDefault();

  try {
    const payload = {
      player_id: Number(event.currentTarget.player_id.value),
      batch_id: Number(event.currentTarget.batch_id.value),
      status: event.currentTarget.status.value
    };

    if (state.editingAssignmentId) {
      const response = await api.put(`/player-batches/${state.editingAssignmentId}`, payload);
      setNotice(
        response?.movement_applied
          ? "Player moved successfully. Previous active batch was archived."
          : "Assignment updated successfully",
        "success"
      );
    } else {
      const response = await api.post("/player-batches", payload);
      setNotice(
        response?.movement_applied
          ? "Player moved successfully. Previous active batch was archived."
          : "Player assigned to batch successfully",
        "success"
      );
    }

    resetForm();
    await loadData();
  } catch (error) {
    state.formValues = {
      player_id: event.currentTarget.player_id.value,
      batch_id: event.currentTarget.batch_id.value,
      status: event.currentTarget.status.value
    };
    setNotice(error.message || "Unable to save assignment", "danger");
    renderPage();
  }
}

async function deleteAssignment(assignmentId) {
  const assignment =
    state.assignments.find((entry) => String(entry.id) === String(assignmentId || "")) || null;

  if (!assignment) {
    return;
  }

  if (!window.confirm(`Delete the assignment for ${assignment.player_name}?`)) {
    return;
  }

  try {
    await api.delete(`/player-batches/${assignment.id}`);

    if (String(state.editingAssignmentId || "") === String(assignment.id)) {
      resetForm();
    }

    setNotice(`Assignment deleted for ${assignment.player_name}`, "success");
    await loadData();
  } catch (error) {
    setNotice(error.message || "Unable to delete assignment", "danger");
    renderPage();
  }
}

function bindEvents() {
  document
    .querySelector('[data-action="dismiss-assignment-notice"]')
    ?.addEventListener("click", () => {
      clearNotice();
      renderPage();
    });

  bindDebouncedSearch(document.getElementById("assignmentSearch"), (value) => {
    state.filters.search = value;
    renderPage();
  });

  document.getElementById("assignmentStatusFilter")?.addEventListener("change", (event) => {
    state.filters.status = event.target.value;
    renderPage();
  });

  document.getElementById("assignmentBatchFilter")?.addEventListener("change", (event) => {
    state.filters.batchId = event.target.value;
    renderPage();
  });

  document.getElementById("assignmentForm")?.addEventListener("submit", saveAssignment);
  document.getElementById("clearAssignmentForm")?.addEventListener("click", resetForm);
  document.getElementById("resetAssignmentForm")?.addEventListener("click", resetForm);
  document.getElementById("deleteAssignmentButton")?.addEventListener("click", () => {
    deleteAssignment(state.editingAssignmentId);
  });

  document.querySelectorAll('[data-action="edit-assignment"]').forEach((button) => {
    button.addEventListener("click", () => {
      state.editingAssignmentId = button.dataset.id || null;
      const assignment = getEditingAssignment();
      state.formValues = {
        player_id: assignment?.player_id ? String(assignment.player_id) : "",
        batch_id: assignment?.batch_id ? String(assignment.batch_id) : "",
        status: assignment?.status || "active"
      };
      clearNotice();
      renderPage();
    });
  });

  document.querySelectorAll('[data-action="delete-assignment"]').forEach((button) => {
    button.addEventListener("click", () => {
      deleteAssignment(button.dataset.id || null);
    });
  });
}

export async function renderPlayerBatches() {
  renderPage();
  await loadData();
}
