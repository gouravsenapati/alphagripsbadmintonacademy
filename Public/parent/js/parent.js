import "/Public/dashboard/js/layout.js";
import { parentApi } from "/Public/parent/js/services/parentApi.js";

const state = {
  loading: true,
  notice: null,
  parent: null,
  children: [],
  selectedChildId: null,
  dashboard: null,
  payingInvoiceId: null,
  activeView: "overview",
  selectedMatrixCategoryId: "",
  selectedMatrixDate: ""
};

function getApp() {
  return document.getElementById("app");
}

function getChildNav() {
  return document.getElementById("parentChildNav");
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

function formatCurrency(value) {
  return `Rs ${Number(value || 0).toFixed(2)}`;
}

function reverseScoreRaw(scoreRaw) {
  const normalized = String(scoreRaw || "").trim();

  if (!normalized) {
    return "";
  }

  return normalized
    .split(",")
    .map((segment) => {
      const trimmed = segment.trim();
      const match = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);

      if (!match) {
        return trimmed;
      }

      return `${match[2]}-${match[1]}`;
    })
    .join(", ");
}

function setNotice(message, tone = "info") {
  state.notice = { message, tone };
}

function clearNotice() {
  state.notice = null;
}

function getSelectedChild() {
  return state.children.find((child) => String(child.id) === String(state.selectedChildId)) || null;
}

function syncMatrixStateFromDashboard() {
  const matrix = state.dashboard?.academy_matrix || null;
  state.selectedMatrixCategoryId = matrix?.category_id ? String(matrix.category_id) : "";
  state.selectedMatrixDate = matrix?.selected_match_date || "";
}

function renderNotice() {
  if (!state.notice) {
    return "";
  }

  return `
    <div class="notice notice-${escapeHtml(state.notice.tone)}">
      <span>${escapeHtml(state.notice.message)}</span>
      <button class="btn btn-ghost btn-sm" type="button" data-action="dismiss-parent-notice">Dismiss</button>
    </div>
  `;
}

function renderLoading() {
  return `
    <section class="page-header">
      <p class="eyebrow">Parent Portal</p>
      <h2>Loading your child dashboard</h2>
      <p>Please wait while AlphaGrips fetches attendance, performance, matches, and invoices.</p>
    </section>
  `;
}

function renderEmpty() {
  return `
    <section class="page-header">
      <p class="eyebrow">Parent Portal</p>
      <h2>No linked child profiles found</h2>
      <p>This parent account is active, but no student profile is linked yet. Please contact the academy desk to map your account to your child.</p>
    </section>
  `;
}

function renderParentHero() {
  const selectedChild = getSelectedChild();

  return `
    <section class="page-header">
      <p class="eyebrow">Parent Portal</p>
      <h2>${escapeHtml(selectedChild ? selectedChild.name : "My Children")}</h2>
      <p>
        View your child's profile, fitness progress, academy match results, and this month's fee status from one simple parent dashboard.
      </p>
      <div class="parent-tabs">
        ${state.children
          .map(
            (child) => `
              <button
                class="parent-tab ${String(child.id) === String(state.selectedChildId) ? "active" : ""}"
                type="button"
                data-action="select-child"
                data-player-id="${child.id}"
              >
                ${escapeHtml(child.name)}
              </button>
            `
          )
          .join("")}
      </div>
      <div class="parent-section-tabs" role="tablist" aria-label="Parent portal sections">
        <button
          class="parent-section-tab ${state.activeView === "overview" ? "active" : ""}"
          type="button"
          data-action="select-parent-view"
          data-view="overview"
        >
          Overview
        </button>
        <button
          class="parent-section-tab ${state.activeView === "match-matrix" ? "active" : ""}"
          type="button"
          data-action="select-parent-view"
          data-view="match-matrix"
        >
          Main Match Matrix
        </button>
        <button
          class="parent-section-tab ${state.activeView === "match-log" ? "active" : ""}"
          type="button"
          data-action="select-parent-view"
          data-view="match-log"
        >
          Player Match Log
        </button>
      </div>
    </section>
  `;
}

function getCurrentMonthInvoice(card) {
  const invoices = card?.invoices?.invoices || [];
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const exactMatch = invoices.find(
    (invoice) =>
      Number(invoice.invoice_month) === currentMonth &&
      Number(invoice.invoice_year) === currentYear
  );

  if (exactMatch) {
    return exactMatch;
  }

  return (
    [...invoices].sort((left, right) => {
      const leftDate = new Date(left.invoice_date || left.created_at || 0).getTime();
      const rightDate = new Date(right.invoice_date || right.created_at || 0).getTime();
      return rightDate - leftDate;
    })[0] || null
  );
}

function getInvoiceViewerStatus(invoice) {
  if (!invoice) {
    return {
      label: "No invoice",
      tone: "neutral",
      description: "No invoice has been generated for the current month yet."
    };
  }

  const balanceAmount = Number(invoice.balance_amount || 0);
  const dueDate = invoice.due_date ? new Date(invoice.due_date) : null;
  const now = new Date();

  if (balanceAmount <= 0 || String(invoice.effective_status || invoice.status).toLowerCase() === "paid") {
    return {
      label: "Paid",
      tone: "paid",
      description: `Payment completed for ${invoice.billing_label || "this month"}.`
    };
  }

  if (dueDate && !Number.isNaN(dueDate.getTime()) && dueDate < now) {
    return {
      label: "Overdue",
      tone: "overdue",
      description: `Payment is overdue since ${formatDate(invoice.due_date)}.`
    };
  }

  return {
    label: "Due",
    tone: "due",
    description: `Payment is pending for ${invoice.billing_label || "this month"}.`
  };
}

function renderChildProfile(card) {
  const child = card?.child;
  if (!child) {
    return "";
  }

  return `
    <section class="panel parent-overview-card">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Child Profile</p>
          <h3>${escapeHtml(child.name)}</h3>
        </div>
        ${child.status ? `<span class="pill ${String(child.status).toLowerCase() === "active" ? "pill-active" : "pill-inactive"}">${escapeHtml(child.status)}</span>` : ""}
      </div>
      <div class="child-profile">
        <div class="child-meta">
          <span>${escapeHtml(child.gender || "Unspecified")}</span>
          <span>${escapeHtml(child.category_name || "No category")}</span>
          <span>DOB: ${formatDate(child.dob)}</span>
        </div>
        <div class="child-meta">
          <span>Father: ${escapeHtml(child.father_name || "-")}</span>
          <span>Mother: ${escapeHtml(child.mother_name || "-")}</span>
        </div>
        <div class="child-meta">
          <span>Primary Contact: ${escapeHtml(child.contact_number_1 || "-")}</span>
          <span>Email: ${escapeHtml(child.email || "-")}</span>
        </div>
      </div>
    </section>
  `;
}

function renderPerformance(card) {
  const performance = card?.performance || { summaries: [], recent_records: [] };

  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Performance</p>
          <h3>Fitness and test records</h3>
        </div>
      </div>
      <div class="parent-list">
        ${
          performance.summaries?.length
            ? performance.summaries
                .map(
                  (summary) => `
                    <article class="parent-list-item">
                      <div class="parent-list-item-head">
                        <strong>${escapeHtml(summary.test_name)}</strong>
                        <span class="receipt-pill">${escapeHtml(summary.unit || "")}</span>
                      </div>
                      <div class="summary-strip compact">
                        <div><span>Best</span><strong>${escapeHtml(String(summary.best_value ?? "-"))}</strong></div>
                        <div><span>Latest</span><strong>${escapeHtml(String(summary.latest_value ?? "-"))}</strong></div>
                        <div><span>Worst</span><strong>${escapeHtml(String(summary.worst_value ?? "-"))}</strong></div>
                      </div>
                    </article>
                  `
                )
                .join("")
            : `<div class="empty-panel compact parent-empty"><p>No performance records found yet.</p></div>`
        }
      </div>
    </section>
  `;
}

function getMatrixPairResult(matrix, playerAId, playerBId) {
  const lowId = Math.min(Number(playerAId), Number(playerBId));
  const highId = Math.max(Number(playerAId), Number(playerBId));

  return (
    (matrix?.results || []).find(
      (result) =>
        Number(result.player1_id) === lowId && Number(result.player2_id) === highId
    ) || null
  );
}

function getMatrixStanding(matrix, playerId) {
  return (
    (matrix?.summary?.standings || []).find(
      (standing) => String(standing.player_id) === String(playerId || "")
    ) || null
  );
}

function getMatrixDiagonalDisplay(matrix, playerId) {
  if (!matrix?.summary?.is_complete) {
    return {
      label: "-",
      className: "match-matrix-diagonal",
      contentClassName: "match-matrix-diagonal-content"
    };
  }

  const standing = getMatrixStanding(matrix, playerId);
  const recommendation = String(standing?.recommendation || "");

  if (recommendation.startsWith("Move Up")) {
    return {
      label: "Move Up",
      className: "match-matrix-diagonal match-matrix-diagonal-up",
      contentClassName:
        "match-matrix-diagonal-content match-matrix-diagonal-content-up"
    };
  }

  if (recommendation.startsWith("Move Down")) {
    return {
      label: "Move Down",
      className: "match-matrix-diagonal match-matrix-diagonal-down",
      contentClassName:
        "match-matrix-diagonal-content match-matrix-diagonal-content-down"
    };
  }

  return {
    label: "-",
    className: "match-matrix-diagonal",
    contentClassName: "match-matrix-diagonal-content"
  };
}

function getMatrixCellDisplay(matrix, rowPlayerId, colPlayerId) {
  if (String(rowPlayerId) === String(colPlayerId)) {
    return {
      label: "-",
      tone: "diagonal"
    };
  }

  const result = getMatrixPairResult(matrix, rowPlayerId, colPlayerId);

  if (!result) {
    return {
      label: "-",
      tone: "empty"
    };
  }

  const isDirectOrientation = Number(result.player1_id) === Number(rowPlayerId);
  const resultType = String(result.result_type || "normal").toLowerCase();
  const displayScore =
    resultType === "normal"
      ? isDirectOrientation
        ? result.score_raw
        : reverseScoreRaw(result.score_raw)
      : "";
  const won = Number(result.winner_id) === Number(rowPlayerId);
  const label =
    resultType === "walkover"
      ? `WO ${won ? "✓" : "✕"}`
      : resultType === "ab"
        ? `AB ${won ? "✓" : "✕"}`
        : `${displayScore}${won ? " ✓" : " ✕"}`;

  return {
    label,
    tone: won ? "win" : "loss"
  };
}

function renderAcademyMatrix(card) {
  const matrix = card?.academy_matrix || {
    category_id: null,
    category_name: null,
    categories: [],
    selected_match_date: null,
    players: [],
    results: [],
    summary: null
  };

  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Academy Match Matrix</p>
          <h3>${
            matrix.category_name
              ? `${escapeHtml(matrix.category_name)} - ${escapeHtml(formatDate(matrix.selected_match_date))}`
              : "No category matrix yet"
          }</h3>
        </div>
      </div>
      <div class="match-matrix-toolbar">
        <div class="match-matrix-category-row">
          ${
            matrix.categories?.length
              ? matrix.categories
                  .map(
                    (category) => `
                      <button
                        class="match-matrix-chip ${
                          String(matrix.category_id || "") === String(category.id) ? "active" : ""
                        }"
                        type="button"
                        data-action="select-matrix-category"
                        data-category-id="${category.id}"
                      >
                        ${escapeHtml(category.name)}
                      </button>
                    `
                  )
                  .join("")
              : `<span class="status-pill status-neutral">No categories</span>`
          }
        </div>
        <div class="match-matrix-toolbar-actions">
          <label>
            <span>Date</span>
            ${
              matrix.available_dates?.length
                ? `
                  <select id="parentMatrixDate">
                    ${matrix.available_dates
                      .map(
                        (matchDate) => `
                          <option value="${escapeHtml(matchDate)}" ${
                            String(matrix.selected_match_date || "") === String(matchDate) ? "selected" : ""
                          }>
                            ${escapeHtml(formatDate(matchDate))}
                          </option>
                        `
                      )
                      .join("")}
                  </select>
                `
                : `
                  <input
                    id="parentMatrixDate"
                    type="text"
                    value="No saved dates yet"
                    disabled
                  />
                `
            }
          </label>
          <button class="btn btn-secondary" type="button" data-action="refresh-parent-matrix">
            Refresh
          </button>
        </div>
      </div>
      ${
        matrix.available_dates?.length
          ? `
            <div class="entry-sheet-meta">
              ${matrix.available_dates
                .slice(0, 5)
                .map(
                  (matchDate) => `
                    <button
                      class="status-pill status-neutral match-date-pill"
                      type="button"
                      data-action="select-matrix-date"
                      data-date="${matchDate}"
                    >
                      ${escapeHtml(formatDate(matchDate))}
                    </button>
                  `
                )
                .join("")}
            </div>
          `
          : ""
      }
      ${
        matrix.players?.length >= 2
          ? `
            <div class="entry-sheet-meta match-matrix-status-strip">
              <span class="status-pill ${matrix.summary?.is_complete ? "status-success" : "status-warning"}">
                ${matrix.summary?.is_complete ? "All matches completed" : "Sheet incomplete"}
              </span>
              <span class="status-pill status-neutral">
                ${escapeHtml(String(matrix.summary?.completed_matches || 0))} / ${escapeHtml(
                  String(matrix.summary?.expected_matches || 0)
                )} matches
              </span>
              ${
                matrix.summary?.is_complete
                  ? `<span class="status-pill status-neutral">Diagonal shows move suggestions</span>`
                  : `<span class="status-pill status-neutral">${escapeHtml(
                      String(matrix.summary?.remaining_matches || 0)
                    )} remaining</span>`
              }
            </div>
            <div class="match-matrix-note">
              ${
                matrix.summary?.is_complete
                  ? `Tie-break rule: ${escapeHtml(matrix.summary?.tie_break_rule || "-")}`
                  : "Scores are shown as entered by the academy. Final movement suggestions appear after all matches are completed."
              }
            </div>
            <div class="table-container parent-matrix-panel">
              <table class="match-matrix-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    ${matrix.players
                      .map((player) => `<th>${escapeHtml(player.name)}</th>`)
                      .join("")}
                  </tr>
                </thead>
                <tbody>
                  ${matrix.players
                    .map((rowPlayer) => {
                      const cells = matrix.players
                        .map((colPlayer) => {
                          const cell = getMatrixCellDisplay(matrix, rowPlayer.id, colPlayer.id);

                          if (cell.tone === "diagonal") {
                            const diagonal = getMatrixDiagonalDisplay(matrix, rowPlayer.id);
                            return `
                              <td class="${escapeHtml(diagonal.className)}">
                                <div class="${escapeHtml(diagonal.contentClassName)}">
                                  ${escapeHtml(diagonal.label)}
                                </div>
                              </td>
                            `;
                          }

                          return `
                            <td>
                              <div
                                class="match-cell-btn parent-match-cell ${cell.tone === "win" ? "is-win" : ""} ${
                                  cell.tone === "loss" ? "is-loss" : ""
                                } ${cell.tone === "empty" ? "is-empty" : ""}"
                              >
                                ${escapeHtml(cell.label)}
                              </div>
                            </td>
                          `;
                        })
                        .join("");

                      return `
                        <tr>
                          <th>${escapeHtml(rowPlayer.name)}</th>
                          ${cells}
                        </tr>
                      `;
                    })
                    .join("")}
                </tbody>
              </table>
            </div>
          `
          : `
            <div class="empty-panel compact parent-empty">
              <p>No academy matrix scores are available for this child’s category yet.</p>
            </div>
          `
      }
    </section>
  `;
}

function renderMatches(card) {
  const matches = card?.academy_matches || { summary: {}, recent_matches: [] };

  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Academy Matches</p>
          <h3>Practice match history</h3>
        </div>
      </div>
      <div class="summary-strip compact">
        <div><span>Total</span><strong>${escapeHtml(String(matches.summary.total_matches || 0))}</strong></div>
        <div><span>Wins</span><strong>${escapeHtml(String(matches.summary.wins || 0))}</strong></div>
        <div><span>Losses</span><strong>${escapeHtml(String(matches.summary.losses || 0))}</strong></div>
      </div>
      <div class="parent-list">
        ${
          matches.recent_matches?.length
            ? matches.recent_matches
                .map(
                  (match) => `
                    <article class="parent-list-item">
                      <div class="parent-list-item-head">
                        <strong>${escapeHtml(match.result_label || "-")} vs ${escapeHtml(match.opponent_name || "Opponent")}</strong>
                        <span class="pill ${String(match.result_label).toLowerCase() === "won" ? "pill-active" : "pill-inactive"}">${escapeHtml(match.result_label || "-")}</span>
                      </div>
                      <div class="parent-list-item-meta">
                        <span>${formatDate(match.match_date)}</span>
                        <span>${escapeHtml(match.category_name || "-")}</span>
                        <span>${escapeHtml(match.result_type || "normal")}</span>
                      </div>
                      <p>Score: ${escapeHtml(match.score_raw || "-")}</p>
                    </article>
                  `
                )
                .join("")
            : `<div class="empty-panel compact parent-empty"><p>No academy match results recorded yet.</p></div>`
        }
      </div>
    </section>
  `;
}

function renderMatchLog(card) {
  const matches = card?.academy_matches || { summary: {}, match_log: [] };
  const matchLog = matches.match_log || [];

  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Player Match Log</p>
          <h3>All academy scores</h3>
        </div>
      </div>
      <div class="summary-strip compact">
        <div><span>Total</span><strong>${escapeHtml(String(matches.summary.total_matches || 0))}</strong></div>
        <div><span>Wins</span><strong>${escapeHtml(String(matches.summary.wins || 0))}</strong></div>
        <div><span>Losses</span><strong>${escapeHtml(String(matches.summary.losses || 0))}</strong></div>
      </div>
      ${
        matchLog.length
          ? `
            <div class="table-container parent-match-log-panel">
              <table class="parent-match-log-table">
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
                  ${matchLog
                    .map(
                      (match) => `
                        <tr>
                          <td>${escapeHtml(formatDate(match.match_date))}</td>
                          <td>${escapeHtml(match.player1_name || "-")}</td>
                          <td>${escapeHtml(match.player1_category_name || "-")}</td>
                          <td>${escapeHtml(match.player2_name || "-")}</td>
                          <td>${escapeHtml(match.player2_category_name || "-")}</td>
                          <td>
                            <span class="parent-match-log-score ${
                              String(match.result_label || "").toLowerCase() === "won"
                                ? "is-win"
                                : "is-loss"
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
          `
          : `
            <div class="empty-panel compact parent-empty">
              <p>No academy match results recorded yet.</p>
            </div>
          `
      }
    </section>
  `;
}

function renderInvoices(card) {
  const invoices = card?.invoices || { summary: {}, invoices: [] };
  const currentInvoice = getCurrentMonthInvoice(card);
  const currentStatus = getInvoiceViewerStatus(currentInvoice);

  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Monthly Fees</p>
          <h3>This month's fee status</h3>
        </div>
      </div>
      <div class="fee-status-card fee-status-${escapeHtml(currentStatus.tone)}">
        <div class="fee-status-head">
          <div>
            <p class="eyebrow">Current Invoice</p>
            <h4>${escapeHtml(currentInvoice?.billing_label || "No active invoice")}</h4>
          </div>
          <span class="pill pill-fee-${escapeHtml(currentStatus.tone)}">${escapeHtml(currentStatus.label)}</span>
        </div>
        <p>${escapeHtml(currentStatus.description)}</p>
        <div class="summary-strip compact">
          <div><span>Total</span><strong>${escapeHtml(formatCurrency(currentInvoice?.total_amount || 0))}</strong></div>
          <div><span>Paid</span><strong>${escapeHtml(formatCurrency(currentInvoice?.paid_amount || 0))}</strong></div>
          <div><span>Balance</span><strong>${escapeHtml(formatCurrency(currentInvoice?.balance_amount || 0))}</strong></div>
          <div><span>Due Date</span><strong>${escapeHtml(currentInvoice ? formatDate(currentInvoice.due_date || currentInvoice.invoice_date) : "-")}</strong></div>
        </div>
        ${
          currentInvoice && Number(currentInvoice.balance_amount || 0) > 0
            ? `
              <div class="invoice-actions">
                <button
                  class="btn btn-primary"
                  type="button"
                  data-action="pay-invoice"
                  data-invoice-id="${currentInvoice.id}"
                  ${state.payingInvoiceId === currentInvoice.id ? "disabled" : ""}
                >
                  ${state.payingInvoiceId === currentInvoice.id ? "Opening payment..." : "Pay Online"}
                </button>
              </div>
            `
            : ""
        }
      </div>
      <div class="parent-list">
        ${
          currentInvoice?.payments?.length
            ? currentInvoice.payments
                .map(
                  (payment) => `
                    <article class="parent-list-item">
                      <div class="parent-list-item-head">
                        <strong>${escapeHtml(payment.payment_method || "payment")}</strong>
                        <span class="receipt-pill">
                          ${payment.receipt?.receipt_number ? escapeHtml(payment.receipt.receipt_number) : "Receipt pending"}
                        </span>
                      </div>
                      <div class="parent-list-item-meta">
                        <span>${formatDate(payment.payment_date || payment.created_at)}</span>
                        <span>${escapeHtml(formatCurrency(payment.amount_paid || 0))}</span>
                        <span>${escapeHtml(payment.reference_number || "No reference")}</span>
                      </div>
                    </article>
                  `
                )
                .join("")
            : `<div class="empty-panel compact parent-empty"><p>No recorded payments for the current invoice yet.</p></div>`
        }
      </div>
    </section>
  `;
}

function renderDashboard() {
  if (state.loading) {
    getApp().innerHTML = renderLoading();
    return;
  }

  if (!state.children.length || !state.dashboard) {
    getApp().innerHTML = `${renderNotice()}${renderEmpty()}`;
    renderChildNavigation();
    return;
  }

  getApp().innerHTML = `
    ${renderNotice()}
    ${renderParentHero()}
    ${
      state.activeView === "match-matrix"
        ? `
          <div class="parent-matrix-view">
            ${renderAcademyMatrix(state.dashboard)}
          </div>
        `
        : state.activeView === "match-log"
          ? `
            <div class="parent-matrix-view">
              ${renderMatchLog(state.dashboard)}
            </div>
          `
        : `
          <div class="parent-overview-grid">
            ${renderChildProfile(state.dashboard)}
            ${renderInvoices(state.dashboard)}
          </div>
          <div class="section-grid parent-focused-grid">
            ${renderPerformance(state.dashboard)}
          </div>
        `
    }
  `;

  renderChildNavigation();
  bindActions();
}

function renderChildNavigation() {
  const nav = getChildNav();
  if (!nav) {
    return;
  }

  nav.innerHTML = state.children.length
    ? state.children
        .map(
          (child) => `
            <a
              href="#child-${child.id}"
              class="${String(child.id) === String(state.selectedChildId) ? "active" : ""}"
              data-action="select-child"
              data-player-id="${child.id}"
            >
              ${escapeHtml(child.name)}
            </a>
          `
        )
        .join("")
    : `<div class="empty-panel compact parent-empty"><p>No child profiles linked yet.</p></div>`;
}

async function loadPortal(playerId = "") {
  state.loading = true;
  renderDashboard();

  try {
    const payload = await parentApi.getPortal(playerId);
    state.parent = payload.parent || null;
    state.children = payload.children || [];
    state.selectedChildId = payload.selected_child_id || payload.children?.[0]?.id || null;
    state.dashboard = payload.dashboard || null;
    syncMatrixStateFromDashboard();
    clearNotice();
  } catch (error) {
    setNotice(error.message || "Unable to load the parent portal", "error");
  } finally {
    state.loading = false;
    renderDashboard();
  }
}

async function selectChild(playerId) {
  if (String(playerId) === String(state.selectedChildId)) {
    if (window.innerWidth < 1100 && typeof window.closeSidebar === "function") {
      window.closeSidebar();
    }
    return;
  }

  state.selectedChildId = playerId;
  state.loading = true;
  renderDashboard();

  try {
    state.dashboard = await parentApi.getChildDashboard(playerId);
    syncMatrixStateFromDashboard();
    clearNotice();
  } catch (error) {
    setNotice(error.message || "Unable to load this child profile", "error");
  } finally {
    state.loading = false;
    renderDashboard();
    if (window.innerWidth < 1100 && typeof window.closeSidebar === "function") {
      window.closeSidebar();
    }
  }
}

async function refreshMatrix() {
  if (!state.selectedChildId) {
    return;
  }

  state.loading = true;
  renderDashboard();

  try {
    state.dashboard = await parentApi.getChildDashboard(state.selectedChildId, {
      categoryId: state.selectedMatrixCategoryId,
      matchDate: state.selectedMatrixDate
    });
    syncMatrixStateFromDashboard();
    clearNotice();
  } catch (error) {
    setNotice(error.message || "Unable to load the academy match matrix", "error");
  } finally {
    state.loading = false;
    renderDashboard();
  }
}

async function openInvoicePayment(invoiceId) {
  state.payingInvoiceId = invoiceId;
  renderDashboard();

  try {
    const order = await parentApi.createPaymentOrder(invoiceId);

    if (order.zero_amount) {
      setNotice("This invoice is already fully paid.", "info");
      return;
    }

    if (!window.Razorpay) {
      throw new Error("Razorpay checkout is not available right now");
    }

    const selectedChild = getSelectedChild();
    const options = {
      key: order.key_id,
      amount: order.amount,
      currency: order.currency,
      name: "AlphaGrips",
      description: `Monthly fee for ${selectedChild?.name || "student"}`,
      order_id: order.order_id,
      handler: async function (response) {
        try {
          await parentApi.verifyPayment(invoiceId, response);
          setNotice("Payment verified successfully.", "success");
          await loadPortal(state.selectedChildId);
        } catch (error) {
          setNotice(error.message || "Payment verification failed", "error");
        }
      },
      prefill: {
        name: state.parent?.name || "",
        email: state.parent?.email || "",
        contact: state.parent?.phone || ""
      },
      theme: {
        color: "#26386e"
      },
      modal: {
        ondismiss: function () {
          state.payingInvoiceId = null;
          renderDashboard();
        }
      }
    };

    const checkout = new window.Razorpay(options);
    checkout.open();
  } catch (error) {
    setNotice(error.message || "Unable to start online payment", "error");
  } finally {
    state.payingInvoiceId = null;
    renderDashboard();
  }
}

function bindActions() {
  document.querySelectorAll('[data-action="dismiss-parent-notice"]').forEach((button) => {
    button.onclick = () => {
      clearNotice();
      renderDashboard();
    };
  });

  document.querySelectorAll('[data-action="select-child"]').forEach((button) => {
    button.onclick = (event) => {
      event.preventDefault();
      selectChild(button.dataset.playerId);
    };
  });

  document.querySelectorAll('[data-action="select-parent-view"]').forEach((button) => {
    button.onclick = () => {
      state.activeView = ["match-matrix", "match-log"].includes(button.dataset.view)
        ? button.dataset.view
        : "overview";
      renderDashboard();
    };
  });

  document.querySelectorAll('[data-action="pay-invoice"]').forEach((button) => {
    button.onclick = () => {
      openInvoicePayment(button.dataset.invoiceId);
    };
  });

  document.querySelectorAll('[data-action="select-matrix-category"]').forEach((button) => {
    button.onclick = () => {
      state.selectedMatrixCategoryId = button.dataset.categoryId || "";
      state.selectedMatrixDate = "";
      refreshMatrix();
    };
  });

  document.querySelectorAll('[data-action="select-matrix-date"]').forEach((button) => {
    button.onclick = () => {
      state.selectedMatrixDate = button.dataset.date || "";
      refreshMatrix();
    };
  });

  const parentMatrixDate = document.getElementById("parentMatrixDate");
  if (parentMatrixDate) {
    parentMatrixDate.onchange = () => {
      state.selectedMatrixDate = parentMatrixDate.value || "";
    };
  }

  document.querySelectorAll('[data-action="refresh-parent-matrix"]').forEach((button) => {
    button.onclick = () => {
      const parentMatrixDateInput = document.getElementById("parentMatrixDate");
      if (parentMatrixDateInput) {
        state.selectedMatrixDate = parentMatrixDateInput.value || "";
      }
      refreshMatrix();
    };
  });
}

loadPortal();
