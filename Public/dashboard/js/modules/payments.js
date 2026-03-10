import { api } from "../services/api.js";
import { bindDebouncedSearch } from "../utils/search.js";

const state = {
  payments: [],
  invoices: [],
  academies: [],
  filters: {
    search: "",
    academyId: ""
  },
  formValues: {
    academy_id: "",
    invoice_id: "",
    payment_date: new Date().toISOString().slice(0, 10),
    amount_paid: "",
    payment_method: "online",
    reference_number: "",
    payment_proof_url: "",
    notes: ""
  },
  notice: null
};

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

function getDefaultAcademyId() {
  if (canChooseAcademy()) {
    return state.academies[0] ? String(state.academies[0].id) : "";
  }

  return getCurrentAcademyId();
}

function getAvailableInvoices() {
  if (!canChooseAcademy()) {
    return state.invoices;
  }

  if (!state.formValues.academy_id) {
    return [];
  }

  return state.invoices.filter(
    (invoice) => String(invoice.academy_id || "") === String(state.formValues.academy_id)
  );
}

function getFilteredPayments() {
  const query = state.filters.search.trim().toLowerCase();

  return state.payments.filter((payment) => {
    if (query) {
      const haystack =
        `${payment.player_name || ""} ${payment.receipt?.receipt_number || ""} ${payment.reference_number || ""} ${payment.payment_method || ""}`.toLowerCase();

      if (!haystack.includes(query)) {
        return false;
      }
    }

    if (state.filters.academyId && String(payment.academy_id || "") !== String(state.filters.academyId)) {
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
      <button class="btn btn-ghost btn-sm" type="button" data-action="dismiss-payment-notice">Dismiss</button>
    </div>
  `;
}

function renderAcademyOptions(selectedValue = "") {
  return `
    <option value="">Select academy</option>
    ${state.academies
      .map(
        (academy) => `
          <option value="${academy.id}" ${String(selectedValue) === String(academy.id) ? "selected" : ""}>
            ${escapeHtml(academy.name)}
          </option>
        `
      )
      .join("")}
  `;
}

function renderInvoiceOptions(selectedValue = "") {
  return `
    <option value="">Select invoice</option>
    ${getAvailableInvoices()
      .map(
        (invoice) => `
          <option value="${invoice.id}" ${String(selectedValue) === String(invoice.id) ? "selected" : ""}>
            ${escapeHtml(invoice.player_name || "Player")} • ${escapeHtml(invoice.billing_label || "-")} • ${escapeHtml(
              formatCurrency(invoice.balance_amount || invoice.total_amount || 0)
            )} due
          </option>
        `
      )
      .join("")}
  `;
}

function renderSummary() {
  const filtered = getFilteredPayments();
  const totalCollected = filtered.reduce((sum, row) => sum + Number(row.amount_paid || 0), 0);
  const cashCount = filtered.filter((row) => String(row.payment_method || "") === "cash").length;

  return `
    <section class="card-grid">
      <article class="stat-card">
        <span class="stat-label">Payments</span>
        <strong>${escapeHtml(String(filtered.length))}</strong>
        <p>Recorded fee payments for the visible academy scope.</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Collected</span>
        <strong>${escapeHtml(formatCurrency(totalCollected))}</strong>
        <p>Total collections recorded through the academy fee desk.</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Cash With Proof</span>
        <strong>${escapeHtml(String(cashCount))}</strong>
        <p>Cash entries recorded with proof attachment for audit safety.</p>
      </article>
    </section>
  `;
}

function renderForm() {
  return `
    <section class="panel player-form-panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Fee Collection Desk</p>
          <h3>Record payment</h3>
        </div>
      </div>
      <form id="paymentForm" class="stack-form">
        ${
          canChooseAcademy()
            ? `
              <label>Academy
                <select name="academy_id" required>
                  ${renderAcademyOptions(state.formValues.academy_id)}
                </select>
              </label>
            `
            : ""
        }
        <label>Invoice
          <select name="invoice_id" required>
            ${renderInvoiceOptions(state.formValues.invoice_id)}
          </select>
        </label>
        <div class="two-column-grid">
          <label>Payment Date
            <input type="date" name="payment_date" value="${escapeHtml(state.formValues.payment_date)}" required />
          </label>
          <label>Amount Paid
            <input type="number" name="amount_paid" min="0.01" step="0.01" value="${escapeHtml(
              state.formValues.amount_paid
            )}" required />
          </label>
        </div>
        <div class="two-column-grid">
          <label>Payment Method
            <select name="payment_method">
              <option value="online" ${state.formValues.payment_method === "online" ? "selected" : ""}>Online</option>
              <option value="upi" ${state.formValues.payment_method === "upi" ? "selected" : ""}>UPI</option>
              <option value="bank_transfer" ${state.formValues.payment_method === "bank_transfer" ? "selected" : ""}>Bank Transfer</option>
              <option value="cash" ${state.formValues.payment_method === "cash" ? "selected" : ""}>Cash</option>
            </select>
          </label>
          <label>Reference Number
            <input name="reference_number" value="${escapeHtml(state.formValues.reference_number)}" />
          </label>
        </div>
        <label>Payment Proof URL
          <input name="payment_proof_url" placeholder="Required for cash, UPI, and bank transfer" value="${escapeHtml(
            state.formValues.payment_proof_url
          )}" />
        </label>
        <label>Notes
          <textarea name="notes" rows="4" placeholder="Desk notes or payment remarks">${escapeHtml(
            state.formValues.notes
          )}</textarea>
        </label>
        <div class="table-actions">
          <button class="btn btn-primary" type="submit">Record Payment</button>
          <button class="btn btn-ghost" type="button" id="clearPaymentForm">Clear</button>
        </div>
      </form>
    </section>
  `;
}

function renderTable() {
  const payments = getFilteredPayments();

  if (!payments.length) {
    return `
      <div class="empty-panel compact">
        <p class="eyebrow">Payments</p>
        <h3>No payments recorded</h3>
        <p>Record the first payment against an issued invoice to start receipt generation.</p>
      </div>
    `;
  }

  return `
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Receipt</th>
            <th>Player</th>
            <th>Billing Month</th>
            <th>Method</th>
            <th>Amount</th>
            <th>Payment Date</th>
            <th>Reference</th>
            <th>Academy</th>
          </tr>
        </thead>
        <tbody>
          ${payments
            .map(
              (payment) => `
                <tr>
                  <td>
                    <strong>${escapeHtml(payment.receipt?.receipt_number || "-")}</strong>
                    <div class="table-subtext">${escapeHtml(payment.invoice?.status || "-")}</div>
                  </td>
                  <td>${escapeHtml(payment.player_name || "-")}</td>
                  <td>${escapeHtml(payment.billing_label || "-")}</td>
                  <td>${escapeHtml(payment.payment_method || "-")}</td>
                  <td>${escapeHtml(formatCurrency(payment.amount_paid || 0))}</td>
                  <td>${escapeHtml(payment.payment_date || "-")}</td>
                  <td>${escapeHtml(payment.reference_number || "-")}</td>
                  <td>${escapeHtml(payment.academy_name || "-")}</td>
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
        <h2>Payments</h2>
        <p class="hero-copy">
          Record collections against monthly invoices, require proof where needed, and keep receipt generation automatic for the fee desk.
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
            <p class="eyebrow">Collection Ledger</p>
            <h3>Recorded payments</h3>
          </div>
        </div>
        <div class="toolbar player-filter-bar">
          <input id="paymentSearch" placeholder="Search player, receipt, or reference" value="${escapeHtml(
            state.filters.search
          )}" />
          ${
            canChooseAcademy()
              ? `
                <select id="paymentAcademyFilter">
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
          <button class="btn btn-ghost" type="button" id="refreshPayments">Refresh</button>
        </div>
        ${renderTable()}
      </section>
    </section>
  `;

  bindEvents();
}

function resetForm() {
  state.formValues = {
    academy_id: getDefaultAcademyId(),
    invoice_id: "",
    payment_date: new Date().toISOString().slice(0, 10),
    amount_paid: "",
    payment_method: "online",
    reference_number: "",
    payment_proof_url: "",
    notes: ""
  };
  clearNotice();
  renderPage();
}

async function loadPayments() {
  try {
    const [payments, invoices, academies] = await Promise.all([
      api.get("/invoice-payments"),
      api.get("/invoices"),
      api.get("/academies")
    ]);

    state.payments = payments || [];
    state.invoices = (invoices || []).filter((invoice) =>
      ["issued", "partial", "overdue"].includes(String(invoice.status || ""))
    );
    state.academies = academies || [];

    if (!state.formValues.academy_id) {
      state.formValues.academy_id = getDefaultAcademyId();
    }
  } catch (error) {
    setNotice(error.message || "Failed to load payments", "danger");
  }

  renderPage();
}

async function savePayment(event) {
  event.preventDefault();

  try {
    const payload = {
      academy_id: canChooseAcademy() ? Number(event.currentTarget.academy_id.value) : Number(getCurrentAcademyId()),
      invoice_id: Number(event.currentTarget.invoice_id.value),
      payment_date: event.currentTarget.payment_date.value,
      amount_paid: event.currentTarget.amount_paid.value,
      payment_method: event.currentTarget.payment_method.value,
      reference_number: event.currentTarget.reference_number.value.trim(),
      payment_proof_url: event.currentTarget.payment_proof_url.value.trim(),
      notes: event.currentTarget.notes.value.trim()
    };

    const payment = await api.post("/invoice-payments", payload);
    setNotice(
      `Payment recorded. Receipt ${payment.receipt?.receipt_number || "generated"} is now available.`,
      "success"
    );
    resetForm();
    await loadPayments();
  } catch (error) {
    state.formValues = {
      academy_id: canChooseAcademy() ? String(event.currentTarget.academy_id.value || "") : getCurrentAcademyId(),
      invoice_id: String(event.currentTarget.invoice_id.value || ""),
      payment_date: event.currentTarget.payment_date.value,
      amount_paid: event.currentTarget.amount_paid.value,
      payment_method: event.currentTarget.payment_method.value,
      reference_number: event.currentTarget.reference_number.value.trim(),
      payment_proof_url: event.currentTarget.payment_proof_url.value.trim(),
      notes: event.currentTarget.notes.value.trim()
    };
    setNotice(error.message || "Unable to record payment", "danger");
    renderPage();
  }
}

function bindEvents() {
  document
    .querySelector('[data-action="dismiss-payment-notice"]')
    ?.addEventListener("click", () => {
      clearNotice();
      renderPage();
    });

  bindDebouncedSearch(document.getElementById("paymentSearch"), (value) => {
    state.filters.search = value;
    renderPage();
  });

  document.getElementById("paymentAcademyFilter")?.addEventListener("change", (event) => {
    state.filters.academyId = event.target.value;
    renderPage();
  });

  document.querySelector('#paymentForm select[name="academy_id"]')?.addEventListener("change", (event) => {
    state.formValues.academy_id = event.target.value;
    state.formValues.invoice_id = "";
    renderPage();
  });

  document.getElementById("paymentForm")?.addEventListener("submit", savePayment);
  document.getElementById("clearPaymentForm")?.addEventListener("click", resetForm);
  document.getElementById("refreshPayments")?.addEventListener("click", loadPayments);
}

export async function renderPayments() {
  renderPage();
  await loadPayments();
}
