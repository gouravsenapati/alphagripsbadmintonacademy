import { api } from "../services/api.js";

const state = {
  rows: [],
  categories: [],
  availableDates: [],
  selectedMatchDate: "",
  notice: null,
  filters: {
    categoryId: ""
  }
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

function getFilteredRows() {
  if (!state.filters.categoryId) {
    return state.rows;
  }

  return state.rows.filter(
    (row) => String(row.category_id || "") === String(state.filters.categoryId)
  );
}

function renderNotice() {
  if (!state.notice) {
    return "";
  }

  return `
    <div class="notice notice-${escapeHtml(state.notice.tone)}">
      <span>${escapeHtml(state.notice.message)}</span>
      <button class="btn btn-ghost btn-sm" type="button" data-action="dismiss-ranking-notice">Dismiss</button>
    </div>
  `;
}

function renderTable() {
  const rows = getFilteredRows();

  if (!rows.length) {
    return `
      <div class="empty-panel compact">
        <p class="eyebrow">Rankings</p>
        <h3>No rankings found</h3>
        <p>Ranking rows appear after match matrix entries are saved for the selected category.</p>
      </div>
    `;
  }

  return `
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Category</th>
            <th>Win</th>
            <th>Loss</th>
            <th>Total</th>
            <th>Streak</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  <td>${escapeHtml(row.player_name || "-")}</td>
                  <td>${escapeHtml(row.category_name || "-")}</td>
                  <td>${escapeHtml(String(row.wins ?? 0))}</td>
                  <td>${escapeHtml(String(row.losses ?? 0))}</td>
                  <td>${escapeHtml(String(row.total_matches ?? 0))}</td>
                  <td>${escapeHtml(row.streak || "-")}</td>
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
        <p class="eyebrow">Academy Performance</p>
        <h2>Rankings</h2>
        <p class="hero-copy">Track player rankings and ladder positions by category.</p>
      </div>
    </section>
    ${renderNotice()}
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Filters</p>
          <h3>Filter by category</h3>
        </div>
      </div>
      <div class="toolbar player-filter-bar">
        <select id="rankingsCategoryFilter">
          <option value="">All categories</option>
          ${(state.categories || [])
            .map(
              (category) => `
                <option value="${escapeHtml(String(category.id))}" ${
                  String(state.filters.categoryId) === String(category.id) ? "selected" : ""
                }>
                  ${escapeHtml(category.name)}
                </option>
              `
            )
            .join("")}
        </select>
        <select id="rankingsDateFilter">
          <option value="">All dates</option>
          ${(state.availableDates || [])
            .map(
              (dateValue) => `
                <option value="${escapeHtml(dateValue)}" ${
                  String(state.selectedMatchDate || "") === String(dateValue) ? "selected" : ""
                }>
                  ${escapeHtml(dateValue)}
                </option>
              `
            )
            .join("")}
        </select>
      </div>
      ${renderTable()}
    </section>
  `;

  bindEvents();
}

async function loadRankings() {
  try {
    const params = new URLSearchParams();
    if (state.filters.categoryId) {
      params.set("category_id", state.filters.categoryId);
    }
    if (state.selectedMatchDate) {
      params.set("match_date", state.selectedMatchDate);
    }
    const response = await api.get(`/academy-matches/standings?${params.toString()}`);
    state.rows = response?.rows || [];
    state.categories = response?.categories || [];
    state.availableDates = response?.available_dates || [];
  } catch (error) {
    setNotice(error.message || "Unable to load rankings", "danger");
  }

  renderPage();
}

function bindEvents() {
  document
    .querySelector('[data-action="dismiss-ranking-notice"]')
    ?.addEventListener("click", () => {
      clearNotice();
      renderPage();
    });

  document.getElementById("rankingsCategoryFilter")?.addEventListener("change", (event) => {
    state.filters.categoryId = event.target.value;
    state.selectedMatchDate = "";
    renderPage();
    loadRankings();
  });

  document.getElementById("rankingsDateFilter")?.addEventListener("change", (event) => {
    state.selectedMatchDate = event.target.value;
    renderPage();
    loadRankings();
  });
}

export async function renderRankings() {
  renderPage();
  await loadRankings();
}
