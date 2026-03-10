import { api } from "../services/api.js";
import { bindDebouncedSearch } from "../utils/search.js";

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

const now = new Date();

const state = {
  invoices: [],
  academies: [],
  filters: {
    search: "",
    academyId: "",
    month: String(now.getMonth() + 1),
    year: String(now.getFullYear()),
    status: ""
  },
  generator: {
    academy_id: "",
    invoice_month: String(now.getMonth() + 1),
    invoice_year: String(now.getFullYear()),
    invoice_date: getToday()
  },
  notice: null,
  generationResult: null
};

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => ({
  value: String(index + 1),
  label: new Date(2026, index, 1).toLocaleDateString("en-IN", { month: "short" })
}));

function getApp() {
  return document.getElementById("app");
}

function getCurrentRole() {
  return String(localStorage.getItem("role") || "").trim().toLowerCase();
}

function getCurrentAcademyId() {
  const academyId = localStorage.getItem("academy_id");
  return academyId ? String(academyId) : "";
}

function canChooseAcademy() {
  return getCurrentRole() === "super_admin";
}

function canOverrideInvoices() {
  return ["super_admin", "academy_admin", "head_coach"].includes(getCurrentRole());
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

function getDefaultAcademyId() {
  if (canChooseAcademy()) {
    return state.academies[0] ? String(state.academies[0].id) : "";
  }

  return getCurrentAcademyId();
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  return `Rs ${amount.toFixed(2)}`;
}

function formatMonthLabel(month, year) {
  if (!month || !year) {
    return "-";
  }

  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric"
  });
}

function renderMonthOptions(selectedValue = "") {
  return MONTH_OPTIONS.map(
    (month) => `
      <option value="${month.value}" ${String(selectedValue) === month.value ? "selected" : ""}>
        ${escapeHtml(month.label)}
      </option>
    `
  ).join("");
}

function renderNotice() {
  if (!state.notice) {
    return "";
  }

  return `
    <div class="notice notice-${escapeHtml(state.notice.tone)}">
      <span>${escapeHtml(state.notice.message)}</span>
      <button class="btn btn-ghost btn-sm" type="button" data-action="dismiss-invoice-notice">Dismiss</button>
    </div>
  `;
}

function renderAcademyOptions(selectedValue = "") {
  return `
    <option value="">Select academy</option>
    ${state.academies
      .map(
        (academy) => `
          <option value="${academy.id}" ${
            String(selectedValue) === String(academy.id) ? "selected" : ""
          }>
            ${escapeHtml(academy.name)}
          </option>
        `
      )
      .join("")}
  `;
}

function getFilteredInvoices() {
  const query = state.filters.search.trim().toLowerCase();

  return state.invoices.filter((invoice) => {
    if (query) {
      const haystack = `${invoice.player_name || ""} ${invoice.category_name || ""} ${invoice.fee_plan_name || ""} ${invoice.academy_name || ""}`.toLowerCase();

      if (!haystack.includes(query)) {
        return false;
      }
    }

    if (state.filters.status && String(invoice.status || "") !== String(state.filters.status)) {
      return false;
    }

    if (
      state.filters.academyId &&
      String(invoice.academy_id || "") !== String(state.filters.academyId)
    ) {
      return false;
    }

    return true;
  });
}

function renderSummary() {
  const invoices = getFilteredInvoices();
  const totalAmount = invoices.reduce((sum, invoice) => sum + Number(invoice.total_amount || 0), 0);
  const paidAmount = invoices.reduce((sum, invoice) => sum + Number(invoice.paid_amount || 0), 0);
  const overdueCount = invoices.filter((invoice) => String(invoice.status || "") === "overdue").length;

  return `
    <section class="card-grid">
      <article class="stat-card">
        <span class="stat-label">Invoices</span>
        <strong>${escapeHtml(String(invoices.length))}</strong>
        <p>Invoices in the current academy and month filter.</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Billed</span>
        <strong>${escapeHtml(formatCurrency(totalAmount))}</strong>
        <p>Total invoice value for the selected period.</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Collected</span>
        <strong>${escapeHtml(formatCurrency(paidAmount))}</strong>
        <p>Payments already recorded against these invoices.</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Overdue</span>
        <strong>${escapeHtml(String(overdueCount))}</strong>
        <p>Invoices currently marked overdue and still awaiting payment.</p>
      </article>
    </section>
  `;
}

function renderGenerationResult() {
  if (!state.generationResult) {
    return "";
  }

  return `
    <div class="inline-summary-card">
      <div>
        <p class="eyebrow">Last Generation Run</p>
        <h4>${escapeHtml(formatMonthLabel(state.generationResult.invoice_month, state.generationResult.invoice_year))}</h4>
      </div>
      <div class="summary-strip">
        <div>
          <span>Generated</span>
          <strong>${escapeHtml(String(state.generationResult.generated_count || 0))}</strong>
        </div>
        <div>
          <span>Skipped</span>
          <strong>${escapeHtml(String(state.generationResult.skipped_count || 0))}</strong>
        </div>
      </div>
    </div>
  `;
}

function renderGenerator() {
  return `
    <section class="panel player-form-panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Monthly Billing</p>
          <h3>Generate invoices</h3>
        </div>
      </div>
      <form id="invoiceGeneratorForm" class="stack-form">
        ${
          canChooseAcademy()
            ? `
              <label>Academy
                <select name="academy_id" required>
                  ${renderAcademyOptions(state.generator.academy_id)}
                </select>
              </label>
            `
            : `
              <label>Academy
                <input value="${escapeHtml(
                  state.academies.find((academy) => String(academy.id) === getCurrentAcademyId())?.name || "Current academy"
                )}" readonly />
              </label>
            `
        }
        <div class="two-column-grid">
          <label>Invoice Month
            <select name="invoice_month" required>
              ${renderMonthOptions(state.generator.invoice_month)}
            </select>
          </label>
          <label>Invoice Year
            <input name="invoice_year" type="number" min="2024" max="2100" value="${escapeHtml(
              state.generator.invoice_year
            )}" required />
          </label>
        </div>
        <label>Invoice Date
          <input name="invoice_date" type="date" value="${escapeHtml(state.generator.invoice_date)}" required />
        </label>
        <div class="table-actions">
          <button class="btn btn-primary" type="submit">Generate Monthly Invoices</button>
        </div>
      </form>
      ${renderGenerationResult()}
    </section>
  `;
}

function renderInvoiceTable() {
  const invoices = getFilteredInvoices();

  if (!invoices.length) {
    return `
      <div class="empty-panel compact">
        <p class="eyebrow">Invoices</p>
        <h3>No invoices found</h3>
        <p>Generate monthly invoices for the selected academy and period to start the fee cycle.</p>
      </div>
    `;
  }

  return `
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>Category</th>
            <th>Billing Month</th>
            <th>Plan</th>
            <th>Total</th>
            <th>Paid</th>
            <th>Balance</th>
            <th>Status</th>
            <th>Due Date</th>
            <th>Academy</th>
          </tr>
        </thead>
        <tbody>
          ${invoices
            .map(
              (invoice) => `
                <tr>
                  <td><strong>${escapeHtml(invoice.player_name || "-")}</strong></td>
                  <td>${escapeHtml(invoice.category_name || "-")}</td>
                  <td>${escapeHtml(invoice.billing_label || formatMonthLabel(invoice.invoice_month, invoice.invoice_year))}</td>
                  <td>${escapeHtml(invoice.fee_plan_name || "Player override")}</td>
                  <td>
                    <div class="invoice-amount-cell">
                      <strong>${escapeHtml(formatCurrency(invoice.total_amount || 0))}</strong>
                      <span class="table-subtext">Base ${escapeHtml(
                        formatCurrency(invoice.calculated_amount ?? invoice.amount ?? 0)
                      )}</span>
                      ${
                        invoice.override_amount !== null && invoice.override_amount !== undefined
                          ? `<span class="table-subtext">Override ${escapeHtml(
                              formatCurrency(invoice.override_amount || 0)
                            )}</span>`
                          : ""
                      }
                    </div>
                  </td>
                  <td>${escapeHtml(formatCurrency(invoice.paid_amount || 0))}</td>
                  <td>${escapeHtml(formatCurrency(invoice.balance_amount || 0))}</td>
                  <td><span class="pill pill-${escapeHtml(invoice.status || "inactive")}">${escapeHtml(invoice.status || "-")}</span></td>
                  <td>${escapeHtml(invoice.due_date || "-")}</td>
                  <td>${escapeHtml(invoice.academy_name || "-")}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderOverridePanel() {
  const invoices = getFilteredInvoices();

  if (!invoices.length) {
    return "";
  }

  return `
    <section class="panel invoice-override-panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Admin Override</p>
          <h3>Adjust an invoice amount</h3>
        </div>
      </div>
      <form id="invoiceOverrideForm" class="stack-form">
        <label>Invoice
          <select name="invoice_id" required>
            <option value="">Select invoice</option>
            ${invoices
              .map(
                (invoice) => `
                  <option value="${invoice.id}">
                    ${escapeHtml(invoice.player_name || "-")} · ${escapeHtml(
                      invoice.billing_label || formatMonthLabel(invoice.invoice_month, invoice.invoice_year)
                    )} · ${escapeHtml(formatCurrency(invoice.total_amount || 0))}
                  </option>
                `
              )
              .join("")}
          </select>
        </label>
        <div class="two-column-grid">
          <label>Override Amount
            <input name="override_amount" type="number" min="0" step="0.01" required />
          </label>
          <label>Status
            <select name="status">
              <option value="">Keep current</option>
              <option value="issued">Issued</option>
              <option value="partial">Partial</option>
              <option value="paid">Paid</option>
              <option value="overdue">Overdue</option>
            </select>
          </label>
        </div>
        <label>Reason (audit)
          <textarea
            name="override_reason"
            rows="3"
            placeholder="Explain why this invoice amount was manually adjusted"
            required
          ></textarea>
        </label>
        <div class="table-actions">
          <button class="btn btn-primary" type="submit">Save Manual Override</button>
        </div>
      </form>
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
        <p class="eyebrow">Academy Payments</p>
        <h2>Invoices</h2>
        <p class="hero-copy">
          Generate monthly invoices from category fee plans and monitor billed, collected, and outstanding balances across the academy.
        </p>
      </div>
    </section>
    ${renderNotice()}
    ${renderSummary()}
    <section class="player-workspace-grid">
      ${renderGenerator()}
      <section class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Invoice Registry</p>
            <h3>Issued invoices</h3>
          </div>
        </div>
        <div class="toolbar player-filter-bar">
          <input id="invoiceSearch" placeholder="Search players, categories, or plans" value="${escapeHtml(
            state.filters.search
          )}" />
          ${
            canChooseAcademy()
              ? `
                <select id="invoiceAcademyFilter">
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
              `
              : ""
          }
          <select id="invoiceMonthFilter">
            ${renderMonthOptions(state.filters.month)}
          </select>
          <input id="invoiceYearFilter" type="number" min="2024" max="2100" value="${escapeHtml(
            state.filters.year
          )}" />
          <select id="invoiceStatusFilter">
            <option value="">All statuses</option>
            <option value="issued" ${state.filters.status === "issued" ? "selected" : ""}>Issued</option>
            <option value="partial" ${state.filters.status === "partial" ? "selected" : ""}>Partial</option>
            <option value="paid" ${state.filters.status === "paid" ? "selected" : ""}>Paid</option>
            <option value="overdue" ${state.filters.status === "overdue" ? "selected" : ""}>Overdue</option>
          </select>
          <button class="btn btn-ghost" type="button" id="refreshInvoices">Refresh</button>
        </div>
        ${renderInvoiceTable()}
        ${canOverrideInvoices() ? renderOverridePanel() : ""}
      </section>
    </section>
  `;

  bindEvents();
}

async function loadInvoices() {
  try {
    const query = new URLSearchParams();

    if (state.filters.month) {
      query.set("month", state.filters.month);
    }

    if (state.filters.year) {
      query.set("year", state.filters.year);
    }

    if (state.filters.status) {
      query.set("status", state.filters.status);
    }

    const [invoices, academies] = await Promise.all([
      api.get(`/invoices${query.toString() ? `?${query.toString()}` : ""}`),
      api.get("/academies")
    ]);

    state.invoices = invoices || [];
    state.academies = academies || [];

    if (!state.generator.academy_id) {
      state.generator.academy_id = getDefaultAcademyId();
    }
  } catch (error) {
    setNotice(error.message || "Failed to load invoices", "danger");
  }

  renderPage();
}

async function generateInvoices(event) {
  event.preventDefault();

  try {
    const payload = {
      academy_id: canChooseAcademy()
        ? Number(event.currentTarget.academy_id.value)
        : Number(getCurrentAcademyId()),
      invoice_month: Number(event.currentTarget.invoice_month.value),
      invoice_year: Number(event.currentTarget.invoice_year.value),
      invoice_date: event.currentTarget.invoice_date.value
    };

    const result = await api.post("/invoices/generate-monthly", payload);
    state.generator = {
      academy_id: String(payload.academy_id),
      invoice_month: String(payload.invoice_month),
      invoice_year: String(payload.invoice_year),
      invoice_date: payload.invoice_date
    };
    state.generationResult = result;
    state.filters.month = String(payload.invoice_month);
    state.filters.year = String(payload.invoice_year);
    if (canChooseAcademy()) {
      state.filters.academyId = String(payload.academy_id);
    }
    setNotice(
      `Generated ${result.generated_count || 0} invoice(s). Skipped ${result.skipped_count || 0}.`,
      "success"
    );
    await loadInvoices();
  } catch (error) {
    setNotice(error.message || "Unable to generate invoices", "danger");
    renderPage();
  }
}

async function saveInvoiceOverride(event) {
  event.preventDefault();

  try {
    const form = event.currentTarget;
    const invoiceId = form.invoice_id.value;

    if (!invoiceId) {
      throw new Error("Please select an invoice");
    }

    const payload = {
      override_amount: Number(form.override_amount.value),
      override_reason: String(form.override_reason.value || "").trim()
    };

    if (!payload.override_reason) {
      throw new Error("Override reason is required");
    }

    if (form.status.value) {
      payload.status = form.status.value;
    }

    await api.patch(`/invoices/${invoiceId}`, payload);
    setNotice("Invoice override saved.", "success");
    await loadInvoices();
  } catch (error) {
    setNotice(error.message || "Unable to save invoice override", "danger");
    renderPage();
  }
}

function bindEvents() {
  document
    .querySelector('[data-action="dismiss-invoice-notice"]')
    ?.addEventListener("click", () => {
      clearNotice();
      renderPage();
    });

  document.getElementById("invoiceGeneratorForm")?.addEventListener("submit", generateInvoices);
  document.getElementById("invoiceOverrideForm")?.addEventListener("submit", saveInvoiceOverride);

  bindDebouncedSearch(document.getElementById("invoiceSearch"), (value) => {
    state.filters.search = value;
    renderPage();
  });

  document.getElementById("invoiceAcademyFilter")?.addEventListener("change", (event) => {
    state.filters.academyId = event.target.value;
    renderPage();
  });

  document.getElementById("invoiceMonthFilter")?.addEventListener("change", (event) => {
    state.filters.month = event.target.value;
    loadInvoices();
  });

  document.getElementById("invoiceYearFilter")?.addEventListener("change", (event) => {
    state.filters.year = event.target.value;
    loadInvoices();
  });

  document.getElementById("invoiceStatusFilter")?.addEventListener("change", (event) => {
    state.filters.status = event.target.value;
    loadInvoices();
  });

  document.getElementById("refreshInvoices")?.addEventListener("click", () => {
    loadInvoices();
  });
}

export async function renderInvoices() {
  renderPage();
  await loadInvoices();
}
