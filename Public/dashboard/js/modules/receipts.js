import { api } from "../services/api.js";
import { bindDebouncedSearch } from "../utils/search.js";

const state = {
  receipts: [],
  academies: [],
  filters: {
    search: "",
    academyId: ""
  },
  notice: null
};

function getApp() {
  return document.getElementById("app");
}

function getCurrentRole() {
  return String(localStorage.getItem("role") || "").trim().toLowerCase();
}

function canChooseAcademy() {
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

function formatCurrency(value) {
  return `Rs ${Number(value || 0).toFixed(2)}`;
}

function getFilteredReceipts() {
  const query = state.filters.search.trim().toLowerCase();

  return state.receipts.filter((receipt) => {
    if (query) {
      const haystack =
        `${receipt.receipt_number || ""} ${receipt.player_name || ""} ${receipt.academy_name || ""}`.toLowerCase();

      if (!haystack.includes(query)) {
        return false;
      }
    }

    if (state.filters.academyId && String(receipt.academy_id || "") !== String(state.filters.academyId)) {
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
      <button class="btn btn-ghost btn-sm" type="button" data-action="dismiss-receipt-notice">Dismiss</button>
    </div>
  `;
}

function renderSummary() {
  const filtered = getFilteredReceipts();
  const totalCollected = filtered.reduce((sum, receipt) => sum + Number(receipt.payment?.amount_paid || 0), 0);

  return `
    <section class="card-grid">
      <article class="stat-card">
        <span class="stat-label">Receipts</span>
        <strong>${escapeHtml(String(filtered.length))}</strong>
        <p>Generated receipt records available for desk verification and reprint workflows.</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Receipt Value</span>
        <strong>${escapeHtml(formatCurrency(totalCollected))}</strong>
        <p>Total value represented by the visible receipt set.</p>
      </article>
    </section>
  `;
}

function renderAcademyOptions() {
  return `
    <option value="">All academies</option>
    ${state.academies
      .map(
        (academy) => `
          <option value="${academy.id}" ${String(state.filters.academyId) === String(academy.id) ? "selected" : ""}>
            ${escapeHtml(academy.name)}
          </option>
        `
      )
      .join("")}
  `;
}

function renderTable() {
  const receipts = getFilteredReceipts();

  if (!receipts.length) {
    return `
      <div class="empty-panel compact">
        <p class="eyebrow">Receipts</p>
        <h3>No receipts generated yet</h3>
        <p>Receipts will appear automatically as soon as invoice payments are recorded.</p>
      </div>
    `;
  }

  return `
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Receipt Number</th>
            <th>Player</th>
            <th>Billing Month</th>
            <th>Amount</th>
            <th>Method</th>
            <th>Payment Date</th>
            <th>Academy</th>
          </tr>
        </thead>
        <tbody>
          ${receipts
            .map(
              (receipt) => `
                <tr>
                  <td><strong>${escapeHtml(receipt.receipt_number || "-")}</strong></td>
                  <td>${escapeHtml(receipt.player_name || "-")}</td>
                  <td>${escapeHtml(receipt.billing_label || "-")}</td>
                  <td>${escapeHtml(formatCurrency(receipt.payment?.amount_paid || 0))}</td>
                  <td>${escapeHtml(receipt.payment?.payment_method || "-")}</td>
                  <td>${escapeHtml(receipt.payment?.payment_date || "-")}</td>
                  <td>${escapeHtml(receipt.academy_name || "-")}</td>
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
        <p class="eyebrow">Academy Payments</p>
        <h2>Receipts</h2>
        <p class="hero-copy">
          Track generated receipts for all fee payments and keep a clean audit trail for front desk operations.
        </p>
      </div>
    </section>
    ${renderNotice()}
    ${renderSummary()}
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Receipt Register</p>
          <h3>Generated receipts</h3>
        </div>
      </div>
      <div class="toolbar player-filter-bar">
        <input id="receiptSearch" placeholder="Search receipt number or player" value="${escapeHtml(state.filters.search)}" />
        ${
          canChooseAcademy()
            ? `
              <select id="receiptAcademyFilter">
                ${renderAcademyOptions()}
              </select>
            `
            : ""
        }
        <button class="btn btn-ghost" type="button" id="refreshReceipts">Refresh</button>
      </div>
      ${renderTable()}
    </section>
  `;

  bindEvents();
}

async function loadReceipts() {
  try {
    const [receipts, academies] = await Promise.all([api.get("/receipts"), api.get("/academies")]);
    state.receipts = receipts || [];
    state.academies = academies || [];
  } catch (error) {
    setNotice(error.message || "Failed to load receipts", "danger");
  }

  renderPage();
}

function bindEvents() {
  document
    .querySelector('[data-action="dismiss-receipt-notice"]')
    ?.addEventListener("click", () => {
      clearNotice();
      renderPage();
    });

  bindDebouncedSearch(document.getElementById("receiptSearch"), (value) => {
    state.filters.search = value;
    renderPage();
  });

  document.getElementById("receiptAcademyFilter")?.addEventListener("change", (event) => {
    state.filters.academyId = event.target.value;
    renderPage();
  });

  document.getElementById("refreshReceipts")?.addEventListener("click", loadReceipts);
}

export async function renderReceipts() {
  renderPage();
  await loadReceipts();
}
