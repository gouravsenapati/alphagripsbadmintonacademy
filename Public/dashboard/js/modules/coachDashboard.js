import { api } from "../services/api.js";

const state = {
  data: null,
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

function renderNotice() {
  if (!state.notice) {
    return "";
  }

  return `
    <div class="notice notice-${escapeHtml(state.notice.tone)}">
      <span>${escapeHtml(state.notice.message)}</span>
      <button class="btn btn-ghost btn-sm" type="button" data-action="dismiss-dashboard-notice">Dismiss</button>
    </div>
  `;
}

function renderSummaryCards() {
  const data = state.data || {};

  return `
    <section class="card-grid">
      <article class="stat-card">
        <span class="stat-label">Active Players</span>
        <strong>${escapeHtml(String(data.activePlayers || 0))}</strong>
        <p>Players currently marked active.</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Categories</span>
        <strong>${escapeHtml(String(data.categories || 0))}</strong>
        <p>Academy skill groups and age bands.</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Batches</span>
        <strong>${escapeHtml(String(data.batches || 0))}</strong>
        <p>Training batches in the current academy scope.</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Open Invoices</span>
        <strong>${escapeHtml(String(data.openInvoices || 0))}</strong>
        <p>Outstanding monthly fees.</p>
      </article>
    </section>
  `;
}

function renderHighlights() {
  const data = state.data || {};

  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Today</p>
          <h3>Training overview</h3>
        </div>
      </div>
      <div class="summary-strip">
        <div class="summary-card">
          <span class="summary-label">Attendance Sessions</span>
          <strong>${escapeHtml(String(data.sessions || 0))}</strong>
        </div>
        <div class="summary-card">
          <span class="summary-label">Match Matrix Updates</span>
          <strong>${escapeHtml(String(data.matchResults || 0))}</strong>
        </div>
        <div class="summary-card">
          <span class="summary-label">Fitness Tests</span>
          <strong>${escapeHtml(String(data.fitnessTests || 0))}</strong>
        </div>
      </div>
      <p class="form-help">Counts are based on current academy records available in this console.</p>
    </section>
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
        <p class="eyebrow">Head Coach Console</p>
        <h2>Coach Dashboard</h2>
        <p class="hero-copy">Quick snapshot of training, fees, and match activity across the academy.</p>
      </div>
    </section>
    ${renderNotice()}
    ${renderSummaryCards()}
    ${renderHighlights()}
  `;

  bindEvents();
}

async function loadDashboard() {
  try {
    const [players, categories, batches, invoices, fitness, academyMatches] = await Promise.all([
      api.get("/players"),
      api.get("/categories"),
      api.get("/batches"),
      api.get("/invoices"),
      api.get("/fitness"),
      api.get("/academy-matches")
    ]);

    const activePlayers = (players || []).filter((player) => player.status === "active").length;
    const openInvoices = (invoices || []).filter((invoice) =>
      ["pending", "overdue"].includes(String(invoice.status || "").toLowerCase())
    ).length;
    const sessions = 0;
    const matchResults = (academyMatches?.results || []).length || 0;
    const fitnessTests = (fitness?.tests || []).length || 0;

    state.data = {
      activePlayers,
      categories: (categories || []).length,
      batches: (batches || []).length,
      openInvoices,
      sessions,
      matchResults,
      fitnessTests
    };
  } catch (error) {
    setNotice(error.message || "Unable to load dashboard data", "danger");
  }

  renderPage();
}

function bindEvents() {
  document.querySelector('[data-action="dismiss-dashboard-notice"]')?.addEventListener("click", () => {
    clearNotice();
    renderPage();
  });
}

export async function renderCoachDashboard() {
  renderPage();
  await loadDashboard();
}
