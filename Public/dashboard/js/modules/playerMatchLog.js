import { api } from "../services/api.js";

const state = {
  categories: [],
  players: [],
  selectedCategoryId: "",
  selectedPlayerId: "",
  matchLog: [],
  summary: null,
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

function formatDate(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return escapeHtml(value);
  }

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
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
      <button class="btn btn-ghost btn-sm" type="button" data-action="dismiss-player-log-notice">Dismiss</button>
    </div>
  `;
}

function renderCategoryChips() {
  if (!state.categories.length) {
    return `<p class="hero-copy">No categories found yet. Create categories first to browse player match logs.</p>`;
  }

  return `
    <div class="match-matrix-category-row">
      ${state.categories
        .map(
          (category) => `
            <button
              class="match-matrix-chip ${String(state.selectedCategoryId) === String(category.id) ? "active" : ""}"
              type="button"
              data-action="select-player-log-category"
              data-id="${category.id}"
            >
              ${escapeHtml(category.name)}
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function renderSummary() {
  const summary = state.summary || { total_matches: 0, wins: 0, losses: 0 };

  return `
    <div class="summary-strip compact">
      <div><span>Total</span><strong>${escapeHtml(String(summary.total_matches || 0))}</strong></div>
      <div><span>Wins</span><strong>${escapeHtml(String(summary.wins || 0))}</strong></div>
      <div><span>Losses</span><strong>${escapeHtml(String(summary.losses || 0))}</strong></div>
    </div>
  `;
}

function renderTable() {
  if (!state.selectedPlayerId) {
    return `
      <div class="empty-panel compact">
        <p>Select a player to see the full academy match log.</p>
      </div>
    `;
  }

  if (!state.matchLog.length) {
    return `
      <div class="empty-panel compact">
        <p>No academy match results recorded yet for this player in the selected category.</p>
      </div>
    `;
  }

  return `
    <div class="table-container player-match-log-panel">
      <table class="player-match-log-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Player 1</th>
            <th>Category 1</th>
            <th>Player 2</th>
            <th>Category 2</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          ${state.matchLog
            .map(
              (match) => `
                <tr>
                  <td>${escapeHtml(formatDate(match.match_date))}</td>
                  <td>${escapeHtml(match.player1_name || "-")}</td>
                  <td>${escapeHtml(match.player1_category_name || "-")}</td>
                  <td>${escapeHtml(match.player2_name || "-")}</td>
                  <td>${escapeHtml(match.player2_category_name || "-")}</td>
                  <td>
                    <span class="player-match-log-score ${
                      String(match.result_label || "").toLowerCase() === "won" ? "is-win" : "is-loss"
                    }">
                      ${escapeHtml(match.display_score || "-")}
                    </span>
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

function render() {
  const selectedPlayer = state.players.find(
    (player) => String(player.id) === String(state.selectedPlayerId || "")
  );

  getApp().innerHTML = `
    ${renderNotice()}
    <section class="page-header">
      <p class="eyebrow">Academy Competition</p>
      <h2>Player Match Log</h2>
      <p>Review every recorded academy result for a selected player in a read-only format that matches the parent-side log.</p>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Choose</p>
          <h3>Player match log filters</h3>
        </div>
      </div>
      ${renderCategoryChips()}
      <div class="player-match-log-toolbar">
        <label>
          <span>Select Player</span>
          <select id="playerMatchLogPlayer">
            <option value="">Select player</option>
            ${state.players
              .map(
                (player) => `
                  <option value="${player.id}" ${String(player.id) === String(state.selectedPlayerId || "") ? "selected" : ""}>
                    ${escapeHtml(player.name)}
                  </option>
                `
              )
              .join("")}
          </select>
        </label>
        <div class="player-match-log-toolbar-actions">
          <button class="btn btn-secondary" type="button" id="refreshPlayerMatchLog">Refresh</button>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Player Match Log</p>
          <h3>${selectedPlayer ? escapeHtml(selectedPlayer.name) : "Select a player"}</h3>
        </div>
      </div>
      ${renderSummary()}
      ${renderTable()}
    </section>
  `;

  bindActions();
}

async function loadData() {
  try {
    clearNotice();
    const params = new URLSearchParams();
    if (state.selectedCategoryId) {
      params.set("category_id", state.selectedCategoryId);
    }
    if (state.selectedPlayerId) {
      params.set("player_id", state.selectedPlayerId);
    }

    const data = await api.get(`/academy-matches/player-log${params.toString() ? `?${params.toString()}` : ""}`);
    state.categories = data.categories || [];
    state.selectedCategoryId = data.selected_category_id ? String(data.selected_category_id) : "";
    state.players = data.players || [];
    state.selectedPlayerId = data.selected_player_id ? String(data.selected_player_id) : "";
    state.matchLog = data.match_log || [];
    state.summary = data.summary || null;
  } catch (error) {
    setNotice(error.message || "Failed to load player match log.", "danger");
    state.matchLog = [];
    state.summary = null;
  }

  render();
}

function bindActions() {
  document.querySelectorAll('[data-action="select-player-log-category"]').forEach((button) => {
    button.addEventListener("click", async () => {
      state.selectedCategoryId = button.dataset.id || "";
      state.selectedPlayerId = "";
      await loadData();
    });
  });

  document.getElementById("playerMatchLogPlayer")?.addEventListener("change", async (event) => {
    state.selectedPlayerId = event.target.value || "";
    await loadData();
  });

  document.getElementById("refreshPlayerMatchLog")?.addEventListener("click", async () => {
    await loadData();
  });

  document.querySelector('[data-action="dismiss-player-log-notice"]')?.addEventListener("click", () => {
    clearNotice();
    render();
  });
}

export async function renderPlayerMatchLog() {
  await loadData();
}
