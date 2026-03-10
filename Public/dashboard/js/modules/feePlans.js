import { api } from "../services/api.js";
import { bindDebouncedSearch } from "../utils/search.js";

const state = {
  feePlans: [],
  categories: [],
  academies: [],
  filters: {
    search: "",
    academyId: "",
    status: ""
  },
  editingFeePlanId: null,
  formValues: {
    academy_id: "",
    category_id: "",
    plan_name: "",
    amount: "",
    billing_cycle: "monthly",
    due_day: "5",
    grace_days: "0",
    status: "active",
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

function hasText(value) {
  return String(value || "").trim().length > 0;
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

function getEditingFeePlan() {
  return state.feePlans.find((plan) => String(plan.id) === String(state.editingFeePlanId || "")) || null;
}

function getDefaultAcademyId() {
  if (canChooseAcademy()) {
    return state.academies[0] ? String(state.academies[0].id) : "";
  }

  return getCurrentAcademyId();
}

function getAcademyNameById(academyId) {
  return (
    state.academies.find((academy) => String(academy.id) === String(academyId || ""))?.name ||
    null
  );
}

function getAvailableCategories() {
  if (!canChooseAcademy()) {
    return state.categories;
  }

  if (!state.formValues.academy_id) {
    return [];
  }

  return state.categories.filter(
    (category) => String(category.academy_id || "") === String(state.formValues.academy_id)
  );
}

function getFilteredFeePlans() {
  const query = state.filters.search.trim().toLowerCase();

  return state.feePlans.filter((plan) => {
    if (query) {
      const haystack = `${plan.plan_name || ""} ${plan.category_name || ""} ${plan.academy_name || ""}`.toLowerCase();

      if (!haystack.includes(query)) {
        return false;
      }
    }

    if (state.filters.status && String(plan.status || "") !== String(state.filters.status)) {
      return false;
    }

    if (
      state.filters.academyId &&
      String(plan.academy_id || "") !== String(state.filters.academyId)
    ) {
      return false;
    }

    return true;
  });
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  return `Rs ${amount.toFixed(2)}`;
}

function renderNotice() {
  if (!state.notice) {
    return "";
  }

  return `
    <div class="notice notice-${escapeHtml(state.notice.tone)}">
      <span>${escapeHtml(state.notice.message)}</span>
      <button class="btn btn-ghost btn-sm" type="button" data-action="dismiss-fee-plan-notice">Dismiss</button>
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

function renderCategoryOptions(selectedValue = "") {
  const categories = getAvailableCategories();

  return `
    <option value="">Select category</option>
    ${categories
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

function renderSummary() {
  const activePlans = state.feePlans.filter((plan) => String(plan.status || "") === "active").length;
  const categoriesCovered = new Set(
    state.feePlans.filter((plan) => String(plan.status || "") === "active").map((plan) => String(plan.category_id))
  ).size;
  const averageFee =
    state.feePlans.length > 0
      ? state.feePlans.reduce((sum, plan) => sum + Number(plan.amount || 0), 0) / state.feePlans.length
      : 0;

  return `
    <section class="card-grid">
      <article class="stat-card">
        <span class="stat-label">Fee Plans</span>
        <strong>${escapeHtml(String(state.feePlans.length))}</strong>
        <p>Total category-based academy fee plans configured.</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Active Plans</span>
        <strong>${escapeHtml(String(activePlans))}</strong>
        <p>Currently active fee plans that will drive invoice defaults.</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Categories Covered</span>
        <strong>${escapeHtml(String(categoriesCovered))}</strong>
        <p>Active categories already mapped to a fee plan.</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Average Monthly Fee</span>
        <strong>${escapeHtml(formatCurrency(averageFee))}</strong>
        <p>Average category fee across the currently configured plans.</p>
      </article>
    </section>
  `;
}

function renderForm() {
  const editing = getEditingFeePlan();

  return `
    <section class="panel player-form-panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Category Fee Setup</p>
          <h3>${editing ? "Update fee plan" : "Create fee plan"}</h3>
        </div>
        ${
          editing
            ? `<button class="btn btn-ghost btn-sm" type="button" id="resetFeePlanForm">New Fee Plan</button>`
            : ""
        }
      </div>
      <form id="feePlanForm" class="stack-form">
        ${
          canChooseAcademy()
            ? `
              <label>Academy
                <select name="academy_id" required>
                  ${renderAcademyOptions(state.formValues.academy_id)}
                </select>
              </label>
            `
            : `
              <label>Academy
                <input value="${escapeHtml(
                  getAcademyNameById(getCurrentAcademyId()) || "Current academy"
                )}" readonly />
              </label>
            `
        }
        <label>Category
          <select name="category_id" required>
            ${renderCategoryOptions(state.formValues.category_id)}
          </select>
        </label>
        <label>Plan Name
          <input name="plan_name" value="${escapeHtml(state.formValues.plan_name)}" required />
        </label>
        <label>Monthly Amount
          <input name="amount" type="number" step="0.01" min="0" value="${escapeHtml(
            state.formValues.amount
          )}" required />
        </label>
        <div class="two-column-grid">
          <label>Billing Cycle
            <select name="billing_cycle">
              <option value="monthly" ${
                state.formValues.billing_cycle === "monthly" ? "selected" : ""
              }>Monthly</option>
            </select>
          </label>
          <label>Status
            <select name="status">
              <option value="active" ${state.formValues.status === "active" ? "selected" : ""}>Active</option>
              <option value="inactive" ${state.formValues.status === "inactive" ? "selected" : ""}>Inactive</option>
            </select>
          </label>
        </div>
        <div class="two-column-grid">
          <label>Due Day
            <input name="due_day" type="number" min="1" max="31" value="${escapeHtml(
              state.formValues.due_day
            )}" />
          </label>
          <label>Grace Days
            <input name="grace_days" type="number" min="0" max="60" value="${escapeHtml(
              state.formValues.grace_days
            )}" />
          </label>
        </div>
        <label>Notes
          <textarea name="notes" rows="4" placeholder="Optional notes for invoice or desk usage">${escapeHtml(
            state.formValues.notes
          )}</textarea>
        </label>
        <div class="table-actions">
          <button class="btn btn-primary" type="submit">${editing ? "Update Fee Plan" : "Create Fee Plan"}</button>
          <button class="btn btn-ghost" type="button" id="clearFeePlanForm">Clear</button>
          ${
            editing
              ? `<button class="btn btn-danger" type="button" id="deleteFeePlanButton">Delete</button>`
              : ""
          }
        </div>
      </form>
    </section>
  `;
}

function renderTable() {
  const plans = getFilteredFeePlans();

  if (!plans.length) {
    return `
      <div class="empty-panel compact">
        <p class="eyebrow">Fee Plans</p>
        <h3>No fee plans found</h3>
        <p>Create category-based fee plans so monthly invoices can follow the correct academy structure.</p>
      </div>
    `;
  }

  return `
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Plan</th>
            <th>Category</th>
            <th>Amount</th>
            <th>Due Day</th>
            <th>Status</th>
            <th>Academy</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${plans
            .map(
              (plan) => `
                <tr>
                  <td>
                    <strong>${escapeHtml(plan.plan_name)}</strong>
                    <div class="table-subtext">${escapeHtml(plan.billing_cycle || "monthly")}</div>
                  </td>
                  <td>${escapeHtml(plan.category_name || "-")}</td>
                  <td>${escapeHtml(formatCurrency(plan.amount || 0))}</td>
                  <td>${escapeHtml(String(plan.due_day || "-"))}</td>
                  <td><span class="pill pill-${escapeHtml(plan.status || "inactive")}">${escapeHtml(plan.status || "-")}</span></td>
                  <td>${escapeHtml(plan.academy_name || "-")}</td>
                  <td>
                    <div class="table-actions">
                      <button class="btn btn-ghost btn-sm" type="button" data-action="edit-fee-plan" data-id="${plan.id}">Edit</button>
                      <button class="btn btn-danger btn-sm" type="button" data-action="delete-fee-plan" data-id="${plan.id}">Delete</button>
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
        <p class="eyebrow">Academy Payments</p>
        <h2>Fee Plans</h2>
        <p class="hero-copy">
          Define category-based monthly fee plans so billing stays aligned with the player’s academy category.
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
            <p class="eyebrow">Fee Registry</p>
            <h3>Configured fee plans</h3>
          </div>
        </div>
        <div class="toolbar player-filter-bar">
          <input id="feePlanSearch" placeholder="Search plans, categories, or academies" value="${escapeHtml(
            state.filters.search
          )}" />
          ${
            canChooseAcademy()
              ? `
                <select id="feePlanAcademyFilter">
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
          <select id="feePlanStatusFilter">
            <option value="">All statuses</option>
            <option value="active" ${state.filters.status === "active" ? "selected" : ""}>Active</option>
            <option value="inactive" ${state.filters.status === "inactive" ? "selected" : ""}>Inactive</option>
          </select>
        </div>
        ${renderTable()}
      </section>
    </section>
  `;

  bindEvents();
}

function resetForm() {
  state.editingFeePlanId = null;
  state.formValues = {
    academy_id: getDefaultAcademyId(),
    category_id: "",
    plan_name: "",
    amount: "",
    billing_cycle: "monthly",
    due_day: "5",
    grace_days: "0",
    status: "active",
    notes: ""
  };
  clearNotice();
  renderPage();
}

async function loadFeePlans() {
  try {
    const [feePlans, categories, academies] = await Promise.all([
      api.get("/category-fee-plans"),
      api.get("/categories"),
      api.get("/academies")
    ]);

    state.feePlans = feePlans || [];
    state.categories = categories || [];
    state.academies = academies || [];

    if (!state.formValues.academy_id) {
      state.formValues.academy_id = getDefaultAcademyId();
    }

    if (state.editingFeePlanId && !getEditingFeePlan()) {
      resetForm();
      return;
    }
  } catch (error) {
    setNotice(error.message || "Failed to load fee plans", "danger");
  }

  renderPage();
}

async function saveFeePlan(event) {
  event.preventDefault();

  try {
    const selectedAcademyId = canChooseAcademy()
      ? String(event.currentTarget.academy_id.value || "").trim()
      : getCurrentAcademyId();
    const payload = {
      academy_id: hasText(selectedAcademyId) ? Number(selectedAcademyId) : null,
      category_id: hasText(event.currentTarget.category_id.value) ? Number(event.currentTarget.category_id.value) : null,
      plan_name: event.currentTarget.plan_name.value.trim(),
      amount: event.currentTarget.amount.value.trim(),
      billing_cycle: event.currentTarget.billing_cycle.value,
      due_day: event.currentTarget.due_day.value.trim(),
      grace_days: event.currentTarget.grace_days.value.trim(),
      status: event.currentTarget.status.value,
      notes: event.currentTarget.notes.value.trim()
    };

    if (state.editingFeePlanId) {
      await api.put(`/category-fee-plans/${state.editingFeePlanId}`, payload);
      setNotice("Fee plan updated successfully", "success");
    } else {
      await api.post("/category-fee-plans", payload);
      setNotice("Fee plan created successfully", "success");
    }

    resetForm();
    await loadFeePlans();
  } catch (error) {
    state.formValues = {
      academy_id: canChooseAcademy()
        ? String(event.currentTarget.academy_id.value || "").trim()
        : getCurrentAcademyId(),
      category_id: String(event.currentTarget.category_id.value || "").trim(),
      plan_name: event.currentTarget.plan_name.value.trim(),
      amount: event.currentTarget.amount.value.trim(),
      billing_cycle: event.currentTarget.billing_cycle.value,
      due_day: event.currentTarget.due_day.value.trim(),
      grace_days: event.currentTarget.grace_days.value.trim(),
      status: event.currentTarget.status.value,
      notes: event.currentTarget.notes.value.trim()
    };
    setNotice(error.message || "Unable to save fee plan", "danger");
    renderPage();
  }
}

async function deleteFeePlan(feePlanId) {
  const feePlan = state.feePlans.find((entry) => String(entry.id) === String(feePlanId || "")) || null;

  if (!feePlan) {
    return;
  }

  if (!window.confirm(`Delete fee plan "${feePlan.plan_name}"?`)) {
    return;
  }

  try {
    await api.delete(`/category-fee-plans/${feePlan.id}`);

    if (String(state.editingFeePlanId || "") === String(feePlan.id)) {
      resetForm();
    }

    setNotice(`Fee plan deleted: ${feePlan.plan_name}`, "success");
    await loadFeePlans();
  } catch (error) {
    setNotice(error.message || "Unable to delete fee plan", "danger");
    renderPage();
  }
}

function bindEvents() {
  document
    .querySelector('[data-action="dismiss-fee-plan-notice"]')
    ?.addEventListener("click", () => {
      clearNotice();
      renderPage();
    });

  bindDebouncedSearch(document.getElementById("feePlanSearch"), (value) => {
    state.filters.search = value;
    renderPage();
  });

  document.getElementById("feePlanAcademyFilter")?.addEventListener("change", (event) => {
    state.filters.academyId = event.target.value;
    renderPage();
  });

  document.getElementById("feePlanStatusFilter")?.addEventListener("change", (event) => {
    state.filters.status = event.target.value;
    renderPage();
  });

  document.querySelector('#feePlanForm select[name="academy_id"]')?.addEventListener("change", (event) => {
    state.formValues.academy_id = event.target.value;
    if (
      state.formValues.category_id &&
      !getAvailableCategories().some(
        (category) => String(category.id) === String(state.formValues.category_id)
      )
    ) {
      state.formValues.category_id = "";
    }
    renderPage();
  });

  document.getElementById("feePlanForm")?.addEventListener("submit", saveFeePlan);
  document.getElementById("clearFeePlanForm")?.addEventListener("click", resetForm);
  document.getElementById("resetFeePlanForm")?.addEventListener("click", resetForm);
  document.getElementById("deleteFeePlanButton")?.addEventListener("click", () => {
    deleteFeePlan(state.editingFeePlanId);
  });

  document.querySelectorAll('[data-action="edit-fee-plan"]').forEach((button) => {
    button.addEventListener("click", () => {
      state.editingFeePlanId = button.dataset.id || null;
      const plan = getEditingFeePlan();
      state.formValues = {
        academy_id: String(plan?.academy_id || getDefaultAcademyId()),
        category_id: String(plan?.category_id || ""),
        plan_name: plan?.plan_name || "",
        amount: String(plan?.amount ?? ""),
        billing_cycle: plan?.billing_cycle || "monthly",
        due_day: String(plan?.due_day ?? "5"),
        grace_days: String(plan?.grace_days ?? "0"),
        status: plan?.status || "active",
        notes: plan?.notes || ""
      };
      clearNotice();
      renderPage();
    });
  });

  document.querySelectorAll('[data-action="delete-fee-plan"]').forEach((button) => {
    button.addEventListener("click", () => {
      deleteFeePlan(button.dataset.id || null);
    });
  });
}

export async function renderFeePlans() {
  renderPage();
  await loadFeePlans();
}
