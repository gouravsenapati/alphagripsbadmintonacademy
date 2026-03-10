import { api } from "../services/api.js";
import { bindDebouncedSearch } from "../utils/search.js";

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

const state = {
  tests: [],
  sessions: [],
  records: [],
  summaries: [],
  players: [],
  notice: null,
  quickEntry: {
    player_id: "",
    test_id: "",
    measured_on: getToday(),
    attempts_text: ""
  },
  selection: {
    test_id: "",
    measured_on: getToday(),
    attempt_count: 4
  },
  matrixRows: [],
  summarySearch: "",
  testForm: {
    test_name: "",
    metric_type: "time",
    unit: "sec",
    lower_is_better: true
  },
  editingTestId: null
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

function formatDate(value) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function formatValue(value, unit = "") {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  return `${value}${unit ? ` ${unit}` : ""}`;
}

function getSelectedTest() {
  return state.tests.find((test) => String(test.id) === String(state.selection.test_id || "")) || null;
}

function getSelectedSession() {
  return (
    state.sessions.find(
      (session) =>
        String(session.test_id) === String(state.selection.test_id || "") &&
        String(session.session_date) === String(state.selection.measured_on || "")
    ) || null
  );
}

function getEditingTest() {
  return state.tests.find((test) => String(test.id) === String(state.editingTestId || "")) || null;
}

function getAttemptCount(test = getSelectedTest()) {
  const session = getSelectedSession();
  const rawValue = Number(session?.attempt_count ?? state.selection.attempt_count ?? 4);
  if (!Number.isInteger(rawValue) || rawValue <= 0) {
    return 4;
  }

  return Math.min(rawValue, 20);
}

function getWorstLabel(test = getSelectedTest()) {
  if (!test) {
    return "Worst";
  }

  return test.lower_is_better ? "Longest" : "Lowest";
}

function getSelectedRecords() {
  return state.records.filter(
    (record) =>
      String(record.test_id) === String(state.selection.test_id || "") &&
      String(record.measured_on) === String(state.selection.measured_on || "")
  );
}

function getFilteredSummaries() {
  const query = state.summarySearch.trim().toLowerCase();

  return state.summaries
    .filter((summary) => {
      if (state.selection.test_id && String(summary.test_id) !== String(state.selection.test_id)) {
        return false;
      }

      if (!query) {
        return true;
      }

      const haystack = [summary.player_name, summary.category_name, summary.test_name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    })
    .sort((left, right) =>
      String(left.player_name || "").localeCompare(String(right.player_name || ""), "en", {
        sensitivity: "base"
      })
    );
}

function getFilteredHistory() {
  return state.records.filter((record) => {
    if (state.selection.test_id && String(record.test_id) !== String(state.selection.test_id)) {
      return false;
    }

    return true;
  });
}

function syncMatrixRows() {
  const selectedTest = getSelectedTest();

  if (!selectedTest) {
    state.matrixRows = [];
    return;
  }

  const attemptCount = getAttemptCount(selectedTest);
  const recordMap = new Map();
  const recordPlayerMetaMap = new Map();
  const playerMap = new Map(
    state.players.map((player) => [String(player.id), player])
  );

  getSelectedRecords().forEach((record) => {
    const playerKey = String(record.player_id);
    const attemptIndex = Math.max(Number(record.attempt_number || 1) - 1, 0);
    const player = playerMap.get(playerKey);

    if (!recordMap.has(playerKey)) {
      recordMap.set(playerKey, []);
    }

    recordMap.get(playerKey)[attemptIndex] = record;
    recordPlayerMetaMap.set(playerKey, {
      player_id: record.player_id,
      player_name:
        record.player_name || player?.name || `Player #${record.player_id}`,
      category_name: record.category_name || player?.category_name || ""
    });
  });

  state.matrixRows = [...recordPlayerMetaMap.values()]
    .sort((left, right) =>
      String(left.player_name || "").localeCompare(String(right.player_name || ""), "en", {
        sensitivity: "base"
      })
    )
    .map((playerMeta) => {
      const attempts = Array.from({ length: attemptCount }, (_, index) => {
        const existing = recordMap.get(String(playerMeta.player_id))?.[index];
        return existing ? String(existing.result_value) : "";
      });
      const numericAttempts = attempts
        .map((value) => (value === "" ? null : Number(value)))
        .filter((value) => Number.isFinite(value));
      const bestValue =
        numericAttempts.length === 0
          ? null
          : selectedTest.lower_is_better
            ? Math.min(...numericAttempts)
            : Math.max(...numericAttempts);
      const worstValue =
        numericAttempts.length === 0
          ? null
          : selectedTest.lower_is_better
            ? Math.max(...numericAttempts)
            : Math.min(...numericAttempts);

      return {
        player_id: playerMeta.player_id,
        player_name: playerMeta.player_name,
        category_name: playerMeta.category_name || "",
        attempts,
        bestValue,
        worstValue
      };
    });
}

function renderNotice() {
  if (!state.notice) {
    return "";
  }

  return `
    <div class="notice notice-${escapeHtml(state.notice.tone)}">
      <span>${escapeHtml(state.notice.message)}</span>
      <button class="btn btn-ghost btn-sm" type="button" data-action="dismiss-fitness-notice">Dismiss</button>
    </div>
  `;
}

function renderTestOptions(selectedValue = state.selection.test_id, includePlaceholder = false) {
  return `
    ${includePlaceholder ? `<option value="">Select test</option>` : ""}
    ${state.tests
      .filter((test) => test.is_active !== false)
      .map(
        (test) => `
          <option value="${test.id}" ${
            String(selectedValue) === String(test.id) ? "selected" : ""
          }>
            ${escapeHtml(test.test_name)}
          </option>
        `
      )
      .join("")}
  `;
}

function renderPlayerOptions(selectedValue = state.quickEntry.player_id, includePlaceholder = false) {
  return `
    ${includePlaceholder ? `<option value="">Select player</option>` : ""}
    ${state.players
      .filter((player) => String(player.status || "").toLowerCase() === "active")
      .sort((left, right) =>
        String(left.name || "").localeCompare(String(right.name || ""), "en", {
          sensitivity: "base"
        })
      )
      .map(
        (player) => `
          <option value="${player.id}" ${
            String(selectedValue) === String(player.id) ? "selected" : ""
          }>
            ${escapeHtml(player.name)}${player.category_name ? ` · ${escapeHtml(player.category_name)}` : ""}
          </option>
        `
      )
      .join("")}
  `;
}

function renderQuickEntryPanel() {
  const selectedTest =
    state.tests.find((test) => String(test.id) === String(state.quickEntry.test_id || "")) || null;
  const sessionAttemptCount = Number(
    state.sessions.find(
      (session) =>
        String(session.test_id) === String(state.quickEntry.test_id || "") &&
        String(session.session_date) === String(state.quickEntry.measured_on || "")
    )?.attempt_count || 0
  );
  const placeholderCount = Math.max(
    sessionAttemptCount,
    Number(state.selection.attempt_count || 0),
    3
  );
  const placeholder = `Example: ${Array.from(
    { length: Math.min(placeholderCount, 3) },
    (_, index) => 10 + index * 2
  ).join(", ")}`;

  return `
    <section class="panel performance-quick-entry-panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Player Performance Entry</p>
          <h3>Quick single-player save</h3>
        </div>
      </div>
      <form id="fitnessQuickEntryForm" class="performance-quick-entry-grid">
        <label>
          <span>Player</span>
          <select name="player_id" required>
            ${renderPlayerOptions(state.quickEntry.player_id, true)}
          </select>
        </label>
        <label>
          <span>Event</span>
          <select name="test_id" required>
            ${renderTestOptions(state.quickEntry.test_id, true)}
          </select>
        </label>
        <label>
          <span>Date</span>
          <input name="measured_on" type="date" value="${escapeHtml(state.quickEntry.measured_on)}" required />
        </label>
        <label class="performance-attempts-field">
          <span>Attempts (comma separated)</span>
          <input
            name="attempts_text"
            value="${escapeHtml(state.quickEntry.attempts_text)}"
            placeholder="${escapeHtml(placeholder)}"
            required
          />
        </label>
        <div class="performance-quick-entry-actions">
          <button class="btn btn-primary" type="submit">Save Performance</button>
        </div>
      </form>
    </section>
  `;
}

function renderMatrixPanel() {
  const selectedTest = getSelectedTest();
  const selectedSession = getSelectedSession();
  const attemptCount = getAttemptCount(selectedTest);
  const worstLabel = getWorstLabel(selectedTest);

  return `
    <section class="panel performance-matrix-panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Performance Stats</p>
          <h3>Daily attempt sheet</h3>
        </div>
      </div>
      <div class="performance-toolbar">
        <label>
          <span>Event</span>
          <select id="fitnessTestSelect">
            ${renderTestOptions(state.selection.test_id, true)}
          </select>
        </label>
        <label>
          <span>Date</span>
          <input id="fitnessDateSelect" type="date" value="${escapeHtml(state.selection.measured_on)}" />
        </label>
        <label>
          <span>Attempts For This Date</span>
          <input
            id="fitnessAttemptCount"
            type="number"
            min="1"
            max="20"
            value="${escapeHtml(String(attemptCount))}"
          />
        </label>
        <div class="performance-toolbar-actions">
          <button class="btn btn-secondary" type="button" id="loadFitnessMatrix">Load</button>
          <button class="btn btn-primary" type="button" id="saveFitnessMatrix" ${
            selectedTest && state.matrixRows.length ? "" : "disabled"
          }>Save Records</button>
        </div>
      </div>
      ${
        !selectedTest
          ? `
            <div class="empty-panel compact">
              <p class="eyebrow">Select event</p>
              <h3>No test selected</h3>
              <p>Choose a test like 100m Sprint, select a date, and load the matrix to enter all player attempts together.</p>
            </div>
          `
          : `
              <div class="entry-sheet-meta">
                <span class="status-pill status-neutral">${escapeHtml(selectedTest.test_name)}</span>
                <span class="status-pill status-neutral">${escapeHtml(selectedTest.unit || "value")}</span>
                <span class="status-pill status-neutral">Day Attempts ${escapeHtml(String(attemptCount))}</span>
                <span class="status-pill status-neutral">${
                  selectedSession ? "Saved day setup" : "Custom day setup"
                }</span>
              </div>
            ${
              !state.matrixRows.length
                ? `
                  <div class="empty-panel compact">
                    <p class="eyebrow">No player rows yet</p>
                    <h3>This day only shows players with saved records</h3>
                    <p>Use the quick single-player save above to add the first player for ${escapeHtml(
                      selectedTest.test_name
                    )} on ${escapeHtml(formatDate(state.selection.measured_on))}. After that, click Load and only recorded players will appear here.</p>
                  </div>
                `
                : `
                  <div class="table-container">
                    <table class="performance-matrix-table">
                      <thead>
                        <tr>
                          <th>Player</th>
                          ${Array.from({ length: attemptCount }, (_, index) => `<th>A${index + 1}</th>`).join("")}
                          <th>Best</th>
                          <th>${escapeHtml(worstLabel)}</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${state.matrixRows
                          .map(
                            (row) => `
                              <tr>
                                <td>
                                  <strong>${escapeHtml(row.player_name)}</strong>
                                  <div class="player-table-meta">
                                    <span>${escapeHtml(row.category_name || "-")}</span>
                                  </div>
                                </td>
                                ${row.attempts
                                  .map(
                                    (attemptValue, index) => `
                                      <td>
                                        <input
                                          class="attempt-input"
                                          type="number"
                                          step="0.01"
                                          min="0"
                                          data-attempt-player="${row.player_id}"
                                          data-attempt-number="${index + 1}"
                                          value="${escapeHtml(attemptValue)}"
                                          placeholder="-"
                                        />
                                      </td>
                                    `
                                  )
                                  .join("")}
                                <td><strong>${escapeHtml(formatValue(row.bestValue, selectedTest.unit))}</strong></td>
                                <td>${escapeHtml(formatValue(row.worstValue, selectedTest.unit))}</td>
                              </tr>
                            `
                          )
                          .join("")}
                      </tbody>
                    </table>
                  </div>
                `
            }
          `
      }
    </section>
  `;
}

function renderTestManager() {
  const editingTest = getEditingTest();

  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Test Setup</p>
          <h3>${editingTest ? "Update performance test" : "Create performance test"}</h3>
        </div>
        ${
          editingTest
            ? `<button class="btn btn-ghost btn-sm" type="button" id="resetFitnessTestForm">New Test</button>`
            : ""
        }
      </div>
      <form id="fitnessTestForm" class="stack-form">
        <div class="form-grid">
          <label>Test Name
            <input name="test_name" value="${escapeHtml(state.testForm.test_name)}" required />
          </label>
          <label>Metric Type
            <select name="metric_type">
              <option value="time" ${state.testForm.metric_type === "time" ? "selected" : ""}>time</option>
              <option value="distance" ${state.testForm.metric_type === "distance" ? "selected" : ""}>distance</option>
              <option value="count" ${state.testForm.metric_type === "count" ? "selected" : ""}>count</option>
              <option value="score" ${state.testForm.metric_type === "score" ? "selected" : ""}>score</option>
            </select>
          </label>
          <label>Unit
            <input name="unit" value="${escapeHtml(state.testForm.unit)}" placeholder="sec, cm, reps..." />
          </label>
          <label>Best Means
            <select name="lower_is_better">
              <option value="true" ${state.testForm.lower_is_better ? "selected" : ""}>Lower is better</option>
              <option value="false" ${!state.testForm.lower_is_better ? "selected" : ""}>Higher is better</option>
            </select>
          </label>
        </div>
        <div class="table-actions">
          <button class="btn btn-primary" type="submit">${editingTest ? "Update Test" : "Create Test"}</button>
          <button class="btn btn-ghost" type="button" id="clearFitnessTestForm">Clear</button>
        </div>
      </form>
      <div class="mini-list">
        ${state.tests
          .map(
            (test) => `
              <button class="mini-list-item" type="button" data-action="edit-test" data-id="${test.id}">
                <strong>${escapeHtml(test.test_name)}</strong>
                <span>${escapeHtml(test.metric_type)}${test.unit ? ` · ${escapeHtml(test.unit)}` : ""}</span>
              </button>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderSummaryPanel() {
  const selectedTest = getSelectedTest();
  const worstLabel = getWorstLabel(selectedTest);
  const summaries = getFilteredSummaries();

  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Player Summary</p>
          <h3>${selectedTest ? `${escapeHtml(selectedTest.test_name)} records` : "Best and worst records"}</h3>
        </div>
      </div>
      <div class="toolbar player-filter-bar">
        <input id="fitnessSummarySearch" placeholder="Search player or category" value="${escapeHtml(
          state.summarySearch
        )}" />
      </div>
      ${
        !summaries.length
          ? `
            <div class="empty-panel compact">
              <p class="eyebrow">No summary yet</p>
              <h3>No player records found</h3>
              <p>Load a test and save some attempts to start tracking each player’s best and ${escapeHtml(
                worstLabel.toLowerCase()
              )} records.</p>
            </div>
          `
          : `
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Best</th>
                    <th>${escapeHtml(worstLabel)}</th>
                    <th>Latest</th>
                    <th>Entries</th>
                  </tr>
                </thead>
                <tbody>
                  ${summaries
                    .map(
                      (summary) => `
                        <tr>
                          <td>
                            <strong>${escapeHtml(summary.player_name || "-")}</strong>
                            <div class="player-table-meta">
                              <span>${escapeHtml(summary.category_name || "-")}</span>
                            </div>
                          </td>
                          <td>${escapeHtml(formatValue(summary.best_value, summary.unit))}</td>
                          <td>${escapeHtml(formatValue(summary.worst_value, summary.unit))}</td>
                          <td>
                            <strong>${escapeHtml(formatValue(summary.latest_value, summary.unit))}</strong>
                            <div class="player-table-meta">
                              <span>${escapeHtml(formatDate(summary.latest_measured_on))}</span>
                            </div>
                          </td>
                          <td>${escapeHtml(String(summary.record_count || 0))}</td>
                        </tr>
                      `
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          `
      }
    </section>
  `;
}

function renderHistoryPanel() {
  const selectedTest = getSelectedTest();
  const records = getFilteredHistory();

  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Attempt History</p>
          <h3>${selectedTest ? `${escapeHtml(selectedTest.test_name)} by date` : "All saved attempts"}</h3>
        </div>
      </div>
      ${
        !records.length
          ? `
            <div class="empty-panel compact">
              <p class="eyebrow">Date-wise history</p>
              <h3>No attempts saved yet</h3>
              <p>Once attempts are recorded, you can reopen any day and continue from the same sheet.</p>
            </div>
          `
          : `
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Player</th>
                    <th>Attempt</th>
                    <th>Result</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${records
                    .map(
                      (record) => `
                        <tr>
                          <td>${escapeHtml(formatDate(record.measured_on))}</td>
                          <td>
                            <strong>${escapeHtml(record.player_name || "-")}</strong>
                            <div class="player-table-meta">
                              <span>${escapeHtml(record.category_name || "-")}</span>
                            </div>
                          </td>
                          <td>A${escapeHtml(String(record.attempt_number || 1))}</td>
                          <td>${escapeHtml(formatValue(record.result_value, record.unit))}</td>
                          <td>
                            <div class="table-actions">
                              <button class="btn btn-ghost btn-sm" type="button" data-action="load-record-day" data-test-id="${record.test_id}" data-measured-on="${record.measured_on}">
                                Open Day
                              </button>
                              <button class="btn btn-danger btn-sm" type="button" data-action="delete-record" data-id="${record.id}">
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      `
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          `
      }
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
        <p class="eyebrow">Academy Performance</p>
        <h2>Performance Stats</h2>
        <p class="hero-copy">
          Save single-player attempts quickly, then reopen each day as a focused sheet that only shows players who already have saved records for that event and date.
        </p>
      </div>
    </section>
    ${renderNotice()}
    ${renderQuickEntryPanel()}
    ${renderMatrixPanel()}
    <section class="academy-attendance-grid">
      ${renderTestManager()}
      ${renderSummaryPanel()}
    </section>
    ${renderHistoryPanel()}
  `;

  bindEvents();
}

function resetTestForm() {
  state.editingTestId = null;
  state.testForm = {
    test_name: "",
    metric_type: "time",
    unit: "sec",
    lower_is_better: true
  };
  clearNotice();
  renderPage();
}

function readTestFormState() {
  const form = document.getElementById("fitnessTestForm");

  if (!form) {
    return;
  }

  state.testForm = {
    test_name: form.test_name.value.trim(),
    metric_type: form.metric_type.value,
    unit: form.unit.value.trim(),
    lower_is_better: form.lower_is_better.value === "true"
  };
}

function syncTestDefaults(metricType) {
  if (metricType === "time") {
    state.testForm.unit = "sec";
    state.testForm.lower_is_better = true;
  } else if (metricType === "distance") {
    state.testForm.unit = "cm";
    state.testForm.lower_is_better = false;
  } else if (metricType === "count") {
    state.testForm.unit = "reps";
    state.testForm.lower_is_better = false;
  }
}

async function loadFitnessData() {
  try {
    const [fitnessPayload, players] = await Promise.all([api.get("/fitness"), api.get("/players")]);

    state.tests = fitnessPayload.tests || [];
    state.sessions = fitnessPayload.sessions || [];
    state.records = fitnessPayload.records || [];
    state.summaries = fitnessPayload.summaries || [];
    state.players = players || [];

    if (!state.selection.test_id && state.tests.length) {
      state.selection.test_id = String(state.tests[0].id);
    }

    const currentSession = getSelectedSession();
    if (currentSession) {
      state.selection.attempt_count = Number(currentSession.attempt_count || 4);
    } else if (!state.selection.attempt_count) {
      state.selection.attempt_count = 4;
    }

    if (!state.quickEntry.test_id && state.tests.length) {
      state.quickEntry.test_id = String(state.tests[0].id);
    }

    if (!state.quickEntry.player_id && state.players.length) {
      const firstActivePlayer = state.players.find(
        (player) => String(player.status || "").toLowerCase() === "active"
      );
      state.quickEntry.player_id = firstActivePlayer ? String(firstActivePlayer.id) : "";
    }

    syncMatrixRows();
    clearNotice();
  } catch (error) {
    setNotice(error.message || "Failed to load performance stats", "danger");
  }

  renderPage();
}

function readMatrixFromDom() {
  const attemptCount = getAttemptCount();

  return state.matrixRows.map((row) => ({
    player_id: row.player_id,
    attempts: Array.from({ length: attemptCount }, (_, index) => {
      const input = document.querySelector(
        `[data-attempt-player="${row.player_id}"][data-attempt-number="${index + 1}"]`
      );
      const value = input ? input.value.trim() : "";

      if (!value) {
        return null;
      }

      return {
        attempt_number: index + 1,
        result_value: value
      };
    }).filter(Boolean)
  }));
}

async function saveTestDefinition(event) {
  event.preventDefault();

  try {
    const payload = {
      test_name: event.currentTarget.test_name.value.trim(),
      metric_type: event.currentTarget.metric_type.value,
      unit: event.currentTarget.unit.value.trim(),
      lower_is_better: event.currentTarget.lower_is_better.value === "true"
    };

    if (state.editingTestId) {
      await api.put(`/fitness/tests/${state.editingTestId}`, payload);
      setNotice("Performance test updated successfully", "success");
    } else {
      await api.post("/fitness/tests", payload);
      setNotice("Performance test created successfully", "success");
    }

    resetTestForm();
    await loadFitnessData();
  } catch (error) {
    state.testForm = {
      test_name: event.currentTarget.test_name.value.trim(),
      metric_type: event.currentTarget.metric_type.value,
      unit: event.currentTarget.unit.value.trim(),
      lower_is_better: event.currentTarget.lower_is_better.value === "true"
    };
    setNotice(error.message || "Unable to save performance test", "danger");
    renderPage();
  }
}

async function saveQuickEntry(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const playerId = form.player_id.value;
  const testId = form.test_id.value;
  const measuredOn = form.measured_on.value || getToday();
  const attemptsText = form.attempts_text.value.trim();
  const selectedTest =
    state.tests.find((test) => String(test.id) === String(testId || "")) || null;
  const existingSession = state.sessions.find(
    (session) =>
      String(session.test_id) === String(testId || "") &&
      String(session.session_date) === String(measuredOn || "")
  );

  state.quickEntry = {
    player_id: playerId,
    test_id: testId,
    measured_on: measuredOn,
    attempts_text: attemptsText
  };

  if (!selectedTest) {
    setNotice("Select an event before saving performance", "danger");
    renderPage();
    return;
  }

  const rawValues = attemptsText
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!rawValues.length) {
    setNotice("Enter at least one attempt value", "danger");
    renderPage();
    return;
  }

  const attempts = rawValues.map((value, index) => ({
    attempt_number: index + 1,
    result_value: value
  }));

  try {
    await api.post("/fitness/records/bulk", {
      test_id: Number(testId),
      measured_on: measuredOn,
      attempt_count: Math.max(rawValues.length, Number(existingSession?.attempt_count || 0), 1),
      entries: [
        {
          player_id: Number(playerId),
          attempts
        }
      ]
    });

    state.selection.test_id = String(testId);
    state.selection.measured_on = measuredOn;
    state.selection.attempt_count = Math.max(rawValues.length, Number(existingSession?.attempt_count || 0), 1);
    state.quickEntry.attempts_text = "";
    setNotice("Performance saved successfully", "success");
    await loadFitnessData();
  } catch (error) {
    setNotice(error.message || "Unable to save performance", "danger");
    renderPage();
  }
}

function loadSelectedMatrix() {
  const testSelect = document.getElementById("fitnessTestSelect");
  const dateInput = document.getElementById("fitnessDateSelect");
  const attemptsInput = document.getElementById("fitnessAttemptCount");

  if (testSelect) {
    state.selection.test_id = testSelect.value;
  }

  if (dateInput) {
    state.selection.measured_on = dateInput.value || getToday();
  }

  const matchingSession = getSelectedSession();
  if (matchingSession) {
    state.selection.attempt_count = Number(matchingSession.attempt_count || 4);
  } else if (attemptsInput) {
    const selectedValue = Number(attemptsInput.value || 0);
    state.selection.attempt_count =
      Number.isInteger(selectedValue) && selectedValue > 0
        ? Math.min(selectedValue, 20)
        : 4;
  }

  syncMatrixRows();
  clearNotice();
  renderPage();
}

async function saveMatrix() {
  const selectedTest = getSelectedTest();

  if (!selectedTest) {
    setNotice("Select an event before saving", "danger");
    renderPage();
    return;
  }

  const entries = readMatrixFromDom();

  try {
    await api.post("/fitness/records/bulk", {
      test_id: Number(state.selection.test_id),
      measured_on: state.selection.measured_on,
      attempt_count: getAttemptCount(selectedTest),
      entries
    });
    setNotice("Performance records saved successfully", "success");
    await loadFitnessData();
  } catch (error) {
    setNotice(error.message || "Unable to save performance records", "danger");
    renderPage();
  }
}

async function deleteRecord(recordId) {
  const record = state.records.find((entry) => String(entry.id) === String(recordId || "")) || null;

  if (!record) {
    return;
  }

  if (
    !window.confirm(
      `Delete ${record.player_name}'s ${record.test_name} attempt A${record.attempt_number || 1} from ${formatDate(record.measured_on)}?`
    )
  ) {
    return;
  }

  try {
    await api.delete(`/fitness/records/${record.id}`);
    setNotice("Performance record deleted successfully", "success");
    await loadFitnessData();
  } catch (error) {
    setNotice(error.message || "Unable to delete performance record", "danger");
    renderPage();
  }
}

function bindEvents() {
  document
    .querySelector('[data-action="dismiss-fitness-notice"]')
    ?.addEventListener("click", () => {
      clearNotice();
      renderPage();
    });

  document.getElementById("fitnessTestForm")?.addEventListener("submit", saveTestDefinition);
  document.getElementById("fitnessQuickEntryForm")?.addEventListener("submit", saveQuickEntry);
  document.getElementById("clearFitnessTestForm")?.addEventListener("click", resetTestForm);
  document.getElementById("resetFitnessTestForm")?.addEventListener("click", resetTestForm);
  document.getElementById("loadFitnessMatrix")?.addEventListener("click", loadSelectedMatrix);
  document.getElementById("saveFitnessMatrix")?.addEventListener("click", saveMatrix);
  document.getElementById("fitnessAttemptCount")?.addEventListener("change", (event) => {
    const value = Number(event.target.value || 0);
    state.selection.attempt_count =
      Number.isInteger(value) && value > 0 ? Math.min(value, 20) : getAttemptCount();
    syncMatrixRows();
    renderPage();
  });

  bindDebouncedSearch(document.getElementById("fitnessSummarySearch"), (value) => {
    state.summarySearch = value;
    renderPage();
  });

  document.querySelectorAll('[data-action="edit-test"]').forEach((button) => {
    button.addEventListener("click", () => {
      state.editingTestId = button.dataset.id || null;
      const test = getEditingTest();

      if (!test) {
        return;
      }

        state.testForm = {
          test_name: test.test_name || "",
          metric_type: test.metric_type || "time",
          unit: test.unit || "",
          lower_is_better: Boolean(test.lower_is_better)
        };
      clearNotice();
      renderPage();
    });
  });

  document
    .querySelector('#fitnessTestForm select[name="metric_type"]')
    ?.addEventListener("change", (event) => {
      readTestFormState();
      syncTestDefaults(event.target.value);
      state.testForm.metric_type = event.target.value;
      renderPage();
    });

  document.querySelectorAll('[data-action="load-record-day"]').forEach((button) => {
    button.addEventListener("click", () => {
      state.selection.test_id = button.dataset.testId || "";
      state.selection.measured_on = button.dataset.measuredOn || getToday();
      clearNotice();
      syncMatrixRows();
      renderPage();
    });
  });

  document.querySelectorAll('[data-action="delete-record"]').forEach((button) => {
    button.addEventListener("click", () => {
      deleteRecord(button.dataset.id || null);
    });
  });
}

export async function renderFitness() {
  renderPage();
  await loadFitnessData();
}
