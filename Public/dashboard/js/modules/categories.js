import { api } from "../services/api.js";
import { bindDebouncedSearch } from "../utils/search.js";

const state = {
  categories: [],
  academies: [],
  filters: {
    search: "",
    academyId: ""
  },
  editingCategoryId: null,
  formValues: {
    name: "",
    academy_id: ""
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

function hasText(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function clearNotice() {
  state.notice = null;
}

function setNotice(message, tone = "info") {
  state.notice = { message, tone };
}

function getEditingCategory() {
  return (
    state.categories.find((category) => String(category.id) === String(state.editingCategoryId || "")) ||
    null
  );
}

function getAcademyNameById(academyId) {
  return (
    state.academies.find((academy) => String(academy.id) === String(academyId || ""))?.name ||
    null
  );
}

function getDefaultAcademyId() {
  if (canChooseAcademy()) {
    return state.academies[0] ? String(state.academies[0].id) : "";
  }

  return getCurrentAcademyId();
}

function getFilteredCategories() {
  const query = state.filters.search.trim().toLowerCase();

  return state.categories.filter((category) => {
    if (query) {
      const haystack = `${category.name || ""} ${category.academy_name || ""}`.toLowerCase();

      if (!haystack.includes(query)) {
        return false;
      }
    }

    if (
      state.filters.academyId &&
      String(category.academy_id || "") !== String(state.filters.academyId)
    ) {
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
      <button class="btn btn-ghost btn-sm" type="button" data-action="dismiss-category-notice">Dismiss</button>
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

function renderForm() {
  const editing = getEditingCategory();

  return `
    <section class="panel player-form-panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Category Setup</p>
          <h3>${editing ? "Update category" : "Create category"}</h3>
        </div>
        ${
          editing
            ? `<button class="btn btn-ghost btn-sm" type="button" id="resetCategoryForm">New Category</button>`
            : ""
        }
      </div>
      <form id="categoryForm" class="stack-form">
        <label>Category Name
          <input name="name" value="${escapeHtml(state.formValues.name)}" required />
        </label>
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
        <div class="table-actions">
          <button class="btn btn-primary" type="submit">${editing ? "Update Category" : "Create Category"}</button>
          <button class="btn btn-ghost" type="button" id="clearCategoryForm">Clear</button>
          ${
            editing
              ? `<button class="btn btn-danger" type="button" id="deleteCategoryButton">Delete</button>`
              : ""
          }
        </div>
      </form>
    </section>
  `;
}

function renderTable() {
  const categories = getFilteredCategories();

  if (!categories.length) {
    return `
      <div class="empty-panel compact">
        <p class="eyebrow">Categories</p>
        <h3>No categories found</h3>
        <p>Create your first category to organize academy players.</p>
      </div>
    `;
  }

  return `
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Players</th>
            <th>Academy</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${categories
            .map(
              (category) => `
                <tr>
                  <td><strong>${escapeHtml(category.name)}</strong></td>
                  <td>${escapeHtml(String(category.player_count || 0))}</td>
                  <td>${escapeHtml(category.academy_name || "-")}</td>
                  <td>
                    <div class="table-actions">
                      <button class="btn btn-ghost btn-sm" type="button" data-action="edit-category" data-id="${category.id}">Edit</button>
                      <button class="btn btn-danger btn-sm" type="button" data-action="delete-category" data-id="${category.id}">Delete</button>
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
        <h2>Categories</h2>
        <p class="hero-copy">
          Manage the age groups and academy categories that players are assigned to.
        </p>
      </div>
    </section>
    ${renderNotice()}
    <section class="player-workspace-grid">
      ${renderForm()}
      <section class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Category Registry</p>
            <h3>Available categories</h3>
          </div>
        </div>
        <div class="toolbar player-filter-bar">
          <input id="categorySearch" placeholder="Search categories" value="${escapeHtml(
            state.filters.search
          )}" />
          ${
            canChooseAcademy()
              ? `
                <select id="categoryAcademyFilter">
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
        </div>
        ${renderTable()}
      </section>
    </section>
  `;

  bindEvents();
}

function resetForm() {
  state.editingCategoryId = null;
  state.formValues = {
    name: "",
    academy_id: getDefaultAcademyId()
  };
  clearNotice();
  renderPage();
}

async function loadCategories() {
  try {
    const [categories, academies] = await Promise.all([
      api.get("/categories"),
      api.get("/academies")
    ]);

    state.categories = categories || [];
    state.academies = academies || [];

    if (!state.formValues.academy_id) {
      state.formValues.academy_id = getDefaultAcademyId();
    }

    if (state.editingCategoryId && !getEditingCategory()) {
      resetForm();
      return;
    }
  } catch (error) {
    setNotice(error.message || "Failed to load categories", "danger");
  }

  renderPage();
}

async function saveCategory(event) {
  event.preventDefault();

  try {
    const selectedAcademyId = canChooseAcademy()
      ? String(event.currentTarget.academy_id.value || "").trim()
      : getCurrentAcademyId();
    const payload = {
      name: event.currentTarget.name.value.trim(),
      academy_id: hasText(selectedAcademyId) ? Number(selectedAcademyId) : null
    };

    if (state.editingCategoryId) {
      await api.put(`/categories/${state.editingCategoryId}`, payload);
      setNotice("Category updated successfully", "success");
    } else {
      await api.post("/categories", payload);
      setNotice("Category created successfully", "success");
    }

    resetForm();
    await loadCategories();
  } catch (error) {
    state.formValues.name = event.currentTarget.name.value.trim();
    setNotice(error.message || "Unable to save category", "danger");
    renderPage();
  }
}

async function deleteCategory(categoryId) {
  const category =
    state.categories.find((entry) => String(entry.id) === String(categoryId || "")) || null;

  if (!category) {
    return;
  }

  if (!window.confirm(`Delete category "${category.name}"?`)) {
    return;
  }

  try {
    await api.delete(`/categories/${category.id}`);

    if (String(state.editingCategoryId || "") === String(category.id)) {
      resetForm();
    }

    setNotice(`Category deleted: ${category.name}`, "success");
    await loadCategories();
  } catch (error) {
    setNotice(error.message || "Unable to delete category", "danger");
    renderPage();
  }
}

function bindEvents() {
  document
    .querySelector('[data-action="dismiss-category-notice"]')
    ?.addEventListener("click", () => {
      clearNotice();
      renderPage();
    });

  bindDebouncedSearch(document.getElementById("categorySearch"), (value) => {
    state.filters.search = value;
    renderPage();
  });

  document.getElementById("categoryAcademyFilter")?.addEventListener("change", (event) => {
    state.filters.academyId = event.target.value;
    renderPage();
  });

  document.getElementById("categoryForm")?.addEventListener("submit", saveCategory);
  document.getElementById("clearCategoryForm")?.addEventListener("click", resetForm);
  document.getElementById("resetCategoryForm")?.addEventListener("click", resetForm);
  document.getElementById("deleteCategoryButton")?.addEventListener("click", () => {
    deleteCategory(state.editingCategoryId);
  });

  document.querySelectorAll('[data-action="edit-category"]').forEach((button) => {
    button.addEventListener("click", () => {
      state.editingCategoryId = button.dataset.id || null;
      state.formValues = {
        name: getEditingCategory()?.name || "",
        academy_id: String(getEditingCategory()?.academy_id || getDefaultAcademyId())
      };
      clearNotice();
      renderPage();
    });
  });

  document.querySelectorAll('[data-action="delete-category"]').forEach((button) => {
    button.addEventListener("click", () => {
      deleteCategory(button.dataset.id || null);
    });
  });
}

export async function renderCategories() {
  renderPage();
  await loadCategories();
}
