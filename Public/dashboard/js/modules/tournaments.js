import { tournamentApi } from "../services/tournamentApi.js";

function readStoredTournamentId() {
  if (typeof localStorage === "undefined") {
    return null;
  }

  return localStorage.getItem("ag_selected_tournament_id");
}

const state = {
  tournaments: [],
  players: [],
  overview: null,
  matches: [],
  readyMatches: [],
  courts: [],
  registrations: [],
  referees: [],
  selectedTournamentId: readStoredTournamentId(),
  page: "overview",
  loading: false,
  notice: null,
  lastActionResult: null,
  filters: {
    eventId: "",
    status: ""
  },
  views: {
    bracketEventId: "",
    courtEventId: "",
    resultsEventId: ""
  }
};

const PAGE_META = {
  overview: {
    title: "Tournament Overview",
    eyebrow: "Tournament Engine",
    description:
      "Track tournament progress, event readiness, and overall match movement across the knockout engine."
  },
  setup: {
    title: "Tournament Setup",
    eyebrow: "Tournament Setup",
    description:
      "Create events, register participants, prepare courts, and generate draws before the tournament goes live."
  },
  operations: {
    title: "Tournament Operations",
    eyebrow: "Control Desk",
    description:
        "Process byes, preview court assignments, assign matches to courts, and manage match movement through the live queue."
  },
  scoring: {
    title: "Live Scoring",
    eyebrow: "Scoring Desk",
    description:
      "Start matches, enter set-by-set scores, and finalize results with automatic winner propagation."
  },
  brackets: {
    title: "Tournament Draws",
    eyebrow: "Draw View",
    description:
      "Visualize every event round by round, see progression through the knockout draw, and spot winners at a glance."
  },
  courts: {
    title: "Court Monitor",
    eyebrow: "Court Control",
    description:
      "Track occupied and available courts, see active assignments, and manage the next queue of ready matches."
  },
  results: {
    title: "Results Center",
    eyebrow: "Tournament Results",
    description:
      "Review champions, finalists, and completed match history across all events in the tournament."
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

function formatDate(value) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function hasText(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function getRegistrationPaymentReviewBadge(registration) {
  const paymentMethod = String(registration?.payment_method || "").toLowerCase();
  const paymentStatus = String(registration?.payment_status || "").toLowerCase();

  if (paymentStatus === "rejected") {
    return {
      label: "Payment rejected",
      tone: "danger"
    };
  }

  if (paymentMethod === "online") {
    return {
      label:
        paymentStatus === "paid"
          ? "Online auto-confirmed"
          : "Online payment pending",
      tone: paymentStatus === "paid" ? "success" : "warning"
    };
  }

  if (paymentMethod === "upi") {
    return {
      label:
        paymentStatus === "paid"
          ? "UPI manually verified"
          : "UPI manual review pending",
      tone: paymentStatus === "paid" ? "success" : "warning"
    };
  }

  if (paymentMethod === "bank_transfer") {
    return {
      label:
        paymentStatus === "paid"
          ? "Bank transfer verified"
          : "Bank transfer review pending",
      tone: paymentStatus === "paid" ? "success" : "warning"
    };
  }

  return {
    label: "Payment review pending",
    tone: paymentStatus === "paid" ? "success" : "neutral"
  };
}

  function getPlayerName(playerId) {
    const player = state.players.find((item) => String(item.id) === String(playerId));
    return player?.name || null;
  }

  function formatExternalPlayerName(playerId) {
    if (!hasText(playerId) || !String(playerId).startsWith("external:")) {
      return null;
    }

    return String(playerId)
      .slice("external:".length)
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (character) => character.toUpperCase());
  }

  function buildGeneratedParticipantName(participant) {
    const ids = [participant?.player1_id, participant?.player2_id]
      .filter(hasText)
      .map((playerId) => formatExternalPlayerName(playerId) || String(playerId));

  if (!ids.length) {
    return null;
  }

  return ids.join(" / ");
}

function resolveParticipantRecordName(participant, fallbackName = null) {
  if (!participant) {
    return fallbackName || "-";
  }

  const candidateName =
    participant.display_name ||
    fallbackName ||
    participant.team_name ||
    null;
    const generatedName = buildGeneratedParticipantName(participant);
    const playerNames = [
      getPlayerName(participant.player1_id) || formatExternalPlayerName(participant.player1_id),
      getPlayerName(participant.player2_id) || formatExternalPlayerName(participant.player2_id)
    ]
      .filter(hasText);

  if (
    playerNames.length &&
    (!hasText(candidateName) ||
      candidateName === generatedName ||
      candidateName === String(participant.player1_id) ||
      candidateName === String(participant.player2_id))
  ) {
    return playerNames.join(" / ");
  }

  return candidateName || playerNames.join(" / ") || generatedName || "-";
}

function getSideName(match, sideNumber) {
  return (
    match[`participant${sideNumber}_display_name`] ||
    match[`participant${sideNumber}_name`] ||
    "-"
  );
}

function aggregateReasonCounts(entries) {
  return (entries || []).reduce((counts, entry) => {
    const reason = entry.reason || "other";
    counts[reason] = (counts[reason] || 0) + 1;
    return counts;
  }, {});
}

function renderActionDetails(result) {
  const payload = result.payload || {};
  const detailCards = [];

  if (payload.scheduled_matches?.length) {
    detailCards.push(`
      <div class="result-section">
        <span class="result-label">Scheduled Matches</span>
        <div class="result-list">
          ${payload.scheduled_matches
            .map(
              (match) => `
                <article class="result-item">
                  <strong>Match #${escapeHtml(String(match.match_number || "-"))} • ${escapeHtml(
                    match.court_name || "Court pending"
                  )}</strong>
                  <p>${escapeHtml(match.participant1_name || "-")} vs ${escapeHtml(
                    match.participant2_name || "-"
                  )}</p>
                </article>
              `
            )
            .join("")}
        </div>
      </div>
    `);
  }

  if (payload.processed_matches?.length) {
    detailCards.push(`
      <div class="result-section">
        <span class="result-label">Processed Matches</span>
        <div class="result-tags">
          ${payload.processed_matches
            .map(
              (entry) => `
                <span class="result-tag">
                  Match ${escapeHtml(String(entry.match_id || "-"))}
                </span>
              `
            )
            .join("")}
        </div>
      </div>
    `);
  }

  if (payload.skipped_matches?.length) {
    const reasonCounts = aggregateReasonCounts(payload.skipped_matches);

    detailCards.push(`
      <div class="result-section">
        <span class="result-label">Skipped</span>
        <div class="result-tags">
          ${Object.entries(reasonCounts)
            .map(
              ([reason, count]) => `
                <span class="result-tag">
                  ${escapeHtml(reason.replaceAll("_", " "))}: ${escapeHtml(String(count))}
                </span>
              `
            )
            .join("")}
        </div>
      </div>
    `);
  }

  if (payload.deleted_counts) {
    detailCards.push(`
      <div class="result-section">
        <span class="result-label">Deleted Records</span>
        <div class="result-tags">
          ${Object.entries(payload.deleted_counts)
            .map(
              ([key, count]) => `
                <span class="result-tag">
                  ${escapeHtml(key.replaceAll("_", " "))}: ${escapeHtml(String(count))}
                </span>
              `
            )
            .join("")}
        </div>
      </div>
    `);
  }

  if (!detailCards.length) {
    return "";
  }

  return `<div class="result-details">${detailCards.join("")}</div>`;
}

  function renderPlayerOptions(selectedValue = "") {
    return [
      `<option value="">Select academy player${state.players.length ? "" : " (none loaded)"}</option>`,
      ...state.players.map(
        (player) => `
          <option value="${player.id}" ${selectedValue === String(player.id) ? "selected" : ""}>
          ${escapeHtml(player.name || "Unnamed Player")} (${escapeHtml(String(player.id))})
        </option>
      `
    )
  ].join("");
}

function getSelectedTournament() {
  return state.tournaments.find((tournament) => tournament.id === state.selectedTournamentId) || null;
}

function getViewerPortalUrl() {
  const tournament = getSelectedTournament();
  const tournamentLookup = tournament?.tournament_code || tournament?.id || "";

  if (!hasText(tournamentLookup)) {
    return "";
  }

  return `/Public/tournament/viewer.html?tournament=${encodeURIComponent(tournamentLookup)}`;
}

function getDeleteConfirmationText(tournament) {
  return `DELETE ${tournament.tournament_name}`;
}

function setSelectedTournamentId(tournamentId) {
  state.selectedTournamentId = tournamentId || null;

  if (typeof localStorage === "undefined") {
    return;
  }

  if (state.selectedTournamentId) {
    localStorage.setItem("ag_selected_tournament_id", state.selectedTournamentId);
  } else {
    localStorage.removeItem("ag_selected_tournament_id");
  }
}

function setActivePage(page) {
  state.page = PAGE_META[page] ? page : "overview";
}

function getPageMeta() {
  return PAGE_META[state.page] || PAGE_META.overview;
}

function shouldShowCreateTournamentButton() {
  if (!state.tournaments.length || !state.selectedTournamentId) {
    return true;
  }

  return ["overview", "setup"].includes(state.page);
}

function getSelectedEvents() {
  return state.overview?.events || [];
}

function getSelectedEvent(eventId) {
  return getSelectedEvents().find((event) => event.id === eventId) || null;
}

function getRegistrationsForEvent(eventId) {
  return (state.registrations || []).filter(
    (registration) => registration.event?.id === eventId
  );
}

function summarizeRegistrationsForEvent(eventId) {
  return getRegistrationsForEvent(eventId).reduce(
    (summary, registration) => {
      summary.total += 1;

      if (registration.payment_status === "paid") {
        summary.paid += 1;
      } else if (registration.payment_status === "rejected") {
        summary.rejected += 1;
      } else {
        summary.pending += 1;
      }

      return summary;
    },
    { total: 0, paid: 0, pending: 0, rejected: 0 }
  );
}

function getFilteredMatches() {
  return (state.matches || []).filter((match) => {
    if (state.filters.eventId && match.event_id !== state.filters.eventId) {
      return false;
    }

    if (state.filters.status && match.status !== state.filters.status) {
      return false;
    }

    return true;
  });
}

function getOperationalMatches() {
  return (state.matches || []).filter((match) =>
    ["pending", "scheduled", "in_progress"].includes(match.status)
  );
}

function getLiveMatches() {
  return (state.matches || []).filter((match) =>
    ["scheduled", "in_progress", "completed"].includes(match.status)
  );
}

function getMatchesForEvent(eventId) {
  return (state.matches || []).filter((match) => match.event_id === eventId);
}

function getFilteredBracketEvents() {
  const eventId = state.views.bracketEventId;
  const events = getSelectedEvents();

  if (!eventId) {
    return events;
  }

  return events.filter((event) => event.id === eventId);
}

function getFilteredCourtEvents() {
  const eventId = state.views.courtEventId;

  if (!eventId) {
    return state.readyMatches || [];
  }

  return (state.readyMatches || []).filter((match) => match.event_id === eventId);
}

function getFilteredResultEvents() {
  const eventId = state.views.resultsEventId;
  const events = getSelectedEvents();

  if (!eventId) {
    return events;
  }

  return events.filter((event) => event.id === eventId);
}

function getResultMatches() {
  const eventId = state.views.resultsEventId;

  return (state.matches || []).filter((match) => {
    if (match.status !== "completed") {
      return false;
    }

    if (eventId && match.event_id !== eventId) {
      return false;
    }

    return true;
  });
}

function groupMatchesByRound(matches) {
  const groups = matches.reduce((accumulator, match) => {
    const key = match.round_number;

    if (!accumulator[key]) {
      accumulator[key] = [];
    }

    accumulator[key].push(match);
    return accumulator;
  }, {});

  Object.values(groups).forEach((roundMatches) => {
    roundMatches.sort((left, right) => left.match_number - right.match_number);
  });

  return groups;
}

  function getChampionForEvent(eventId) {
    const eventMatches = getMatchesForEvent(eventId);

    if (!eventMatches.length) {
      return null;
    }

    const maxRound = eventMatches.reduce(
      (highestRound, match) => Math.max(highestRound, Number(match.round_number) || 0),
      0
    );
    const finalMatch = eventMatches
      .filter((match) => Number(match.round_number) === maxRound)
      .sort((a, b) => (Number(a.match_number) || 0) - (Number(b.match_number) || 0))[0];

    if (!finalMatch || finalMatch.status !== "completed" || !finalMatch.winner_id) {
      return null;
    }

    return {
      champion_name: finalMatch.winner_name || "Winner pending",
    finalist_name:
      finalMatch.participant1_id === finalMatch.winner_id
        ? getSideName(finalMatch, 2)
        : getSideName(finalMatch, 1),
    score_summary: finalMatch.score_summary,
    result_type: finalMatch.result_type,
    round_name: finalMatch.round_name || `Round ${finalMatch.round_number}`
  };
}

function getCourtAssignmentMap() {
  const activeMatches = (state.matches || []).filter((match) =>
    ["scheduled", "in_progress"].includes(match.status)
  );

  return activeMatches.reduce((map, match) => {
    if (match.court_id) {
      map.set(match.court_id, match);
    }

    return map;
  }, new Map());
}

function setNotice(message, tone = "info") {
  state.notice = { message, tone };
}

function clearNotice() {
  state.notice = null;
}

function statusTone(status) {
  switch (status) {
    case "completed":
    case "available":
    case "checked_in":
      return "success";
    case "in_progress":
    case "occupied":
    case "live":
      return "accent";
    case "scheduled":
    case "draw_generated":
      return "warning";
    case "cancelled":
    case "withdrawn":
    case "disabled":
    case "disqualified":
      return "danger";
    default:
      return "neutral";
  }
}

function renderNotice() {
  if (!state.notice) {
    return "";
  }

  return `
    <div class="notice notice-${escapeHtml(state.notice.tone)}">
      <span>${escapeHtml(state.notice.message)}</span>
      <button class="btn btn-ghost btn-sm" data-action="dismiss-notice">Dismiss</button>
    </div>
  `;
}

function renderTournamentList() {
  if (!state.tournaments.length) {
    return `
      <div class="empty-panel compact">
        <p class="eyebrow">No tournaments</p>
        <h3>Create your first tournament</h3>
        <p>Start with the tournament shell, then add events, courts, participants, and draw data.</p>
      </div>
    `;
  }

  return `
    <div class="list-stack">
      ${state.tournaments
        .map((tournament) => {
          const isActive = tournament.id === state.selectedTournamentId;

          return `
            <button class="list-card ${isActive ? "active" : ""}" data-tournament-id="${tournament.id}">
              <div class="list-card-top">
                <strong>${escapeHtml(tournament.tournament_name)}</strong>
                <span class="status-pill status-${statusTone(tournament.status)}">${escapeHtml(
                  tournament.status
                )}</span>
              </div>
              <div class="list-card-meta">
                <span>${formatDate(tournament.start_date)} - ${formatDate(tournament.end_date)}</span>
                <span>${escapeHtml(tournament.city || tournament.venue_name || "Venue pending")}</span>
              </div>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderStats() {
  const events = state.overview?.events || [];
  const matches = state.matches || [];
  const participants = events.reduce(
    (total, event) => total + Number(event.participant_count || 0),
    0
  );

  return `
    <section class="card-grid">
      <article class="stat-card">
        <span class="stat-label">Events</span>
        <strong>${events.length}</strong>
        <p>Active event definitions under this tournament.</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Participants</span>
        <strong>${participants}</strong>
        <p>Singles players or doubles teams registered into events.</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Courts</span>
        <strong>${state.courts.length}</strong>
        <p>Available playing surfaces for court scheduling.</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Matches</span>
        <strong>${matches.length}</strong>
        <p>Total generated matches across all rounds in this tournament.</p>
      </article>
    </section>
  `;
}

function renderActionResult() {
  if (!state.lastActionResult) {
    return "";
  }

  const result = state.lastActionResult;
  const processedCount =
    result.payload?.scheduled_count ??
    result.payload?.processed_count ??
    result.payload?.matches_created ??
    result.payload?.processed_matches?.length ??
    0;

  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Last operation</p>
          <h3>${escapeHtml(result.title || "Tournament action result")}</h3>
        </div>
      </div>
      <div class="result-grid">
        <div>
          <span class="result-label">Processed</span>
          <strong>${escapeHtml(String(processedCount))}</strong>
        </div>
        <div>
          <span class="result-label">Dry run</span>
          <strong>${result.dry_run ? "Yes" : "No"}</strong>
        </div>
        <div>
          <span class="result-label">Message</span>
          <strong>${escapeHtml(result.message || "Completed")}</strong>
        </div>
      </div>
      ${renderActionDetails(result)}
    </section>
  `;
}

function renderEventCards() {
  const events = state.overview?.events || [];

  if (!events.length) {
    return `
      <div class="empty-panel compact">
        <p class="eyebrow">No events</p>
        <h3>Add the first event</h3>
        <p>Create singles or doubles events before registering participants and generating the draw.</p>
      </div>
    `;
  }

  return `
    <div class="event-grid">
      ${events
        .map((event) => {
          const summary = event.match_summary || {};
          const registrationSummary = summarizeRegistrationsForEvent(event.id);

          return `
            <article class="event-card">
              <div class="event-card-head">
                <div>
                  <h3>${escapeHtml(event.event_name)}</h3>
                  <p>${escapeHtml(event.format)}${event.category_name ? ` • ${escapeHtml(event.category_name)}` : ""}</p>
                </div>
                <span class="status-pill status-${statusTone(event.status)}">${escapeHtml(event.status)}</span>
              </div>
              <div class="event-metrics">
                <div><span>Registrations</span><strong>${escapeHtml(String(registrationSummary.total))}</strong></div>
                <div><span>Paid</span><strong>${escapeHtml(String(registrationSummary.paid))}</strong></div>
                <div><span>Pending</span><strong>${escapeHtml(String(registrationSummary.pending))}</strong></div>
                <div><span>Rejected</span><strong>${escapeHtml(String(registrationSummary.rejected))}</strong></div>
              </div>
              <div class="event-metrics">
                <div><span>Participants</span><strong>${escapeHtml(String(event.participant_count || 0))}</strong></div>
                <div><span>Draw Size</span><strong>${escapeHtml(String(event.draw_size || "-"))}</strong></div>
                <div><span>Matches</span><strong>${escapeHtml(String(summary.total_matches || 0))}</strong></div>
                <div><span>Live</span><strong>${escapeHtml(String(summary.in_progress_matches || 0))}</strong></div>
              </div>
              <div class="event-actions">
                <button class="btn btn-secondary btn-sm" data-event-action="edit" data-event-id="${event.id}">Edit Event</button>
                <button class="btn btn-secondary btn-sm" data-event-action="registrations" data-event-id="${event.id}">Registrations</button>
                <button class="btn btn-secondary btn-sm" data-event-action="participants" data-event-id="${event.id}">Participants</button>
                <button class="btn btn-secondary btn-sm" data-event-action="draw" data-event-id="${event.id}">Generate Draw</button>
                <button class="btn btn-secondary btn-sm" data-event-action="byes" data-event-id="${event.id}">Process Byes</button>
                <button class="btn btn-secondary btn-sm" data-event-action="scheduler" data-event-id="${event.id}">Preview Court Assignments</button>
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderCourts() {
  if (!state.courts.length) {
    return `
      <div class="empty-panel compact">
        <p class="eyebrow">No courts</p>
        <h3>Add court inventory</h3>
          <p>Automatic court assignment works only when tournament courts exist and are available.</p>
      </div>
    `;
  }

  return `
    <div class="court-grid">
      ${state.courts
        .map(
          (court) => `
            <article class="court-card">
              <div class="court-card-head">
                <strong>${escapeHtml(court.court_name)}</strong>
                <span class="status-pill status-${statusTone(court.status)}">${escapeHtml(court.status)}</span>
              </div>
              <p>Sort order: ${escapeHtml(String(court.sort_order ?? 0))}</p>
              <p>Referee: ${escapeHtml(getCourtRefereeLabel(court))}</p>
              <div class="table-actions">
                <button
                  class="btn btn-ghost btn-sm"
                  type="button"
                  data-court-action="assign-referee"
                  data-court-id="${court.id}"
                >
                  ${court.referee_user_id ? "Change Referee" : "Assign Referee"}
                </button>
              </div>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function getCourtRefereeLabel(court) {
  if (!court) {
    return "Unassigned";
  }

  return court.referee_name || court.referee_email || "Unassigned";
}

function getRefereeOptionLabel(referee) {
  if (!referee) {
    return "Unassigned";
  }

  const meta = [referee.role_name, referee.email].filter(hasText).join(" • ");
  return meta ? `${referee.name} (${meta})` : referee.name;
}

function renderReadyMatches() {
  if (!state.readyMatches.length) {
    return `
      <div class="empty-panel compact">
        <p class="eyebrow">Ready queue</p>
        <h3>No ready matches</h3>
        <p>Once both sides are available in a pending match, they will appear here for scheduling.</p>
      </div>
    `;
  }

  return `
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Event</th>
            <th>Round</th>
            <th>Match</th>
            <th>Side A</th>
            <th>Side B</th>
          </tr>
        </thead>
        <tbody>
          ${state.readyMatches
            .map(
              (match) => `
                <tr>
                  <td>${escapeHtml(match.event_name || "-")}</td>
                  <td>${escapeHtml(match.round_name || `Round ${match.round_number}`)}</td>
                  <td>#${escapeHtml(String(match.match_number))}</td>
                  <td>${escapeHtml(getSideName(match, 1))}</td>
                  <td>${escapeHtml(getSideName(match, 2))}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderMatchTable(matches, { emptyTitle, emptyMessage } = {}) {
  if (!matches.length) {
    return `
      <div class="empty-panel compact">
        <p class="eyebrow">Matches</p>
        <h3>${escapeHtml(emptyTitle || "No matches found")}</h3>
        <p>${escapeHtml(
          emptyMessage || "Generate a draw or adjust the current filters to view matches."
        )}</p>
      </div>
    `;
  }

  return `
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Event</th>
            <th>Round</th>
            <th>Match</th>
            <th>Side A</th>
            <th>Side B</th>
            <th>Court</th>
            <th>Status</th>
            <th>Score</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${matches
            .map((match) => {
              const canAssign =
                ["pending", "scheduled"].includes(match.status) &&
                match.participant1_id &&
                match.participant2_id;
              const canStart = match.status === "scheduled";
              const canScore = ["scheduled", "in_progress"].includes(match.status);
              const canComplete =
                match.status !== "completed" && match.participant1_id && match.participant2_id;

              return `
                <tr>
                  <td>${escapeHtml(match.event_name || "-")}</td>
                  <td>${escapeHtml(match.round_name || `Round ${match.round_number}`)}</td>
                  <td>#${escapeHtml(String(match.match_number))}</td>
                  <td>${escapeHtml(getSideName(match, 1))}</td>
                  <td>${escapeHtml(getSideName(match, 2))}</td>
                  <td>${escapeHtml(match.court_name || "-")}</td>
                  <td><span class="status-pill status-${statusTone(match.status)}">${escapeHtml(match.status)}</span></td>
                  <td>${escapeHtml(match.score_summary || "-")}</td>
                  <td>
                    <div class="table-actions">
                      ${
                        canAssign
                          ? `<button class="btn btn-ghost btn-sm" data-match-action="assign" data-match-id="${match.id}">Court</button>`
                          : ""
                      }
                      ${
                        canStart
                          ? `<button class="btn btn-ghost btn-sm" data-match-action="start" data-match-id="${match.id}">Start</button>`
                          : ""
                      }
                      ${
                        canScore
                          ? `<button class="btn btn-ghost btn-sm" data-match-action="score" data-match-id="${match.id}">Score</button>`
                          : ""
                      }
                      ${
                        canComplete
                          ? `<button class="btn btn-ghost btn-sm" data-match-action="complete" data-match-id="${match.id}">Complete</button>`
                          : ""
                      }
                    </div>
                  </td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderMatches() {
  return renderMatchTable(getFilteredMatches());
}

function renderOperationalMatches() {
  return renderMatchTable(getOperationalMatches(), {
    emptyTitle: "No operational matches",
    emptyMessage:
      "Pending, scheduled, and in-progress matches will appear here once the draw is generated."
  });
}

function renderLiveScoringMatches() {
  return renderMatchTable(getLiveMatches(), {
    emptyTitle: "No matches ready for scoring",
    emptyMessage:
      "Scheduled, live, and completed matches will appear here for scoring and result control."
  });
}

function renderConsoleNav() {
  const links = [
    { route: "tournaments", key: "overview", label: "Overview" },
    { route: "tournament-setup", key: "setup", label: "Setup" },
    { route: "tournament-brackets", key: "brackets", label: "Draws" },
    { route: "tournament-operations", key: "operations", label: "Operations" },
    { route: "tournament-courts", key: "courts", label: "Courts" },
    { route: "tournament-scoring", key: "scoring", label: "Live Scoring" },
    { route: "tournament-results", key: "results", label: "Results" }
  ];

  return `
    <div class="console-nav">
      ${links
        .map(
          (link) => `
            <a href="#${link.route}" class="console-link ${state.page === link.key ? "active" : ""}">
              ${escapeHtml(link.label)}
            </a>
          `
        )
        .join("")}
    </div>
  `;
}

function renderProgressHighlights() {
  const summary = (state.matches || []).reduce(
    (totals, match) => {
      totals[match.status] = (totals[match.status] || 0) + 1;
      return totals;
    },
    { pending: 0, scheduled: 0, in_progress: 0, completed: 0 }
  );

  return `
    <section class="summary-strip">
      <div><span>Pending</span><strong>${escapeHtml(String(summary.pending || 0))}</strong></div>
      <div><span>Scheduled</span><strong>${escapeHtml(String(summary.scheduled || 0))}</strong></div>
      <div><span>Live</span><strong>${escapeHtml(String(summary.in_progress || 0))}</strong></div>
      <div><span>Completed</span><strong>${escapeHtml(String(summary.completed || 0))}</strong></div>
    </section>
  `;
}

function renderOverviewPage() {
  return `
    ${renderStats()}
    ${renderProgressHighlights()}
    ${renderActionResult()}

    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Event Snapshot</p>
          <h3>Events and draw readiness</h3>
        </div>
      </div>
      ${renderEventCards()}
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Tournament Flow</p>
          <h3>Ready matches</h3>
        </div>
      </div>
      ${renderReadyMatches()}
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Match Progress</p>
          <h3>All matches</h3>
        </div>
        <div class="toolbar compact">
          <select id="matchEventFilter">
            <option value="">All events</option>
            ${getSelectedEvents()
              .map(
                (event) => `
                  <option value="${event.id}" ${state.filters.eventId === event.id ? "selected" : ""}>
                    ${escapeHtml(event.event_name)}
                  </option>
                `
              )
              .join("")}
          </select>
          <select id="matchStatusFilter">
            <option value="">All statuses</option>
            ${["pending", "scheduled", "in_progress", "completed"]
              .map(
                (status) => `
                  <option value="${status}" ${state.filters.status === status ? "selected" : ""}>
                    ${status}
                  </option>
                `
              )
              .join("")}
          </select>
        </div>
      </div>
      ${renderMatches()}
    </section>
  `;
}

function renderSetupPage() {
  return `
    <section class="action-strip">
      <button class="btn btn-secondary" data-action="add-event">Add Event</button>
      <button class="btn btn-secondary" data-action="add-court">Add Court</button>
      <button class="btn btn-ghost" data-action="refresh-workspace">Refresh</button>
    </section>

    ${renderStats()}
    ${renderActionResult()}

    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Event Setup</p>
          <h3>Events, registration, and draw generation</h3>
        </div>
      </div>
      ${renderEventCards()}
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Court Setup</p>
          <h3>Court inventory</h3>
        </div>
      </div>
      ${renderCourts()}
    </section>
  `;
}

function renderOperationsPage() {
  return `
    <section class="action-strip">
      <button class="btn btn-ghost" data-action="process-byes">Process Byes</button>
      <button class="btn btn-primary" data-action="scheduler-dry-run">Preview Court Assignments</button>
      <button class="btn btn-primary" data-action="scheduler-live">Assign Matches to Courts</button>
      <button class="btn btn-ghost" data-action="refresh-workspace">Refresh</button>
    </section>

    ${renderProgressHighlights()}
    ${renderActionResult()}

    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Queue</p>
          <h3>Ready matches for scheduling</h3>
        </div>
      </div>
      ${renderReadyMatches()}
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Court Operations</p>
          <h3>Match assignment and start control</h3>
        </div>
      </div>
      ${renderOperationalMatches()}
    </section>
  `;
}

function renderScoringPage() {
  return `
    <section class="action-strip">
      <button class="btn btn-ghost" data-action="refresh-workspace">Refresh</button>
    </section>

    ${renderProgressHighlights()}
    ${renderActionResult()}

    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Scoring Desk</p>
          <h3>Live score entry and result completion</h3>
        </div>
      </div>
      ${renderLiveScoringMatches()}
    </section>
  `;
}

function getBracketSlotState(match, sideNumber) {
  const sideName = getSideName(match, sideNumber);

  if (hasText(sideName) && sideName !== "-") {
    return {
      label: sideName,
      tag: null,
      tone: "filled"
    };
  }

  const ownParticipantId = match[`participant${sideNumber}_id`];
  const opponentParticipantId = match[`participant${sideNumber === 1 ? 2 : 1}_id`];

  if (!ownParticipantId && opponentParticipantId) {
    return {
      label: "BYE",
      tag: "auto",
      tone: "bye"
    };
  }

  return {
    label: "TBD",
    tag: "waiting",
    tone: "tbd"
  };
}

function getBracketResultLabel(match) {
  if (hasText(match.score_summary)) {
    return match.score_summary;
  }

  if (match.result_type === "bye") {
    return "Bye advanced";
  }

  if (match.result_type === "walkover") {
    return "Walkover";
  }

  return match.result_type || "-";
}

function getBracketRoundLayout(roundIndex) {
  const cardHeight = 138;
  const baseGap = 18;

  if (roundIndex === 0) {
    return {
      topSpacing: 0,
      betweenSpacing: baseGap,
      connectorSpan: Math.round(cardHeight / 2 + baseGap / 2)
    };
  }

  const centerDistance = (cardHeight + baseGap) * Math.pow(2, roundIndex);
  const topSpacing = Math.max(0, Math.round(centerDistance / 2 - cardHeight / 2));
  const betweenSpacing = Math.max(baseGap, Math.round(centerDistance - cardHeight));

  return {
    topSpacing,
    betweenSpacing,
    connectorSpan: Math.round(cardHeight / 2 + betweenSpacing / 2)
  };
}

function renderBracketMatchCard(match) {
  const winnerId = match.winner_id;
  const sideOneWinner = winnerId && match.participant1_id === winnerId;
  const sideTwoWinner = winnerId && match.participant2_id === winnerId;
  const sideOne = getBracketSlotState(match, 1);
  const sideTwo = getBracketSlotState(match, 2);

  return `
    <article class="bracket-match-card">
      <div class="bracket-match-head">
        <span>${escapeHtml(match.round_name || `Round ${match.round_number}`)}</span>
        <span class="status-pill status-${statusTone(match.status)}">${escapeHtml(match.status)}</span>
      </div>
      <div class="bracket-team ${sideOneWinner ? "is-winner" : ""} ${sideOne.tone === "bye" ? "is-bye" : ""} ${sideOne.tone === "tbd" ? "is-pending" : ""}">
        <div class="bracket-team-row">
          <strong>${escapeHtml(sideOne.label)}</strong>
          ${sideOne.tag ? `<span class="bracket-slot-tag">${escapeHtml(sideOne.tag)}</span>` : ""}
        </div>
      </div>
      <div class="bracket-team ${sideTwoWinner ? "is-winner" : ""} ${sideTwo.tone === "bye" ? "is-bye" : ""} ${sideTwo.tone === "tbd" ? "is-pending" : ""}">
        <div class="bracket-team-row">
          <strong>${escapeHtml(sideTwo.label)}</strong>
          ${sideTwo.tag ? `<span class="bracket-slot-tag">${escapeHtml(sideTwo.tag)}</span>` : ""}
        </div>
      </div>
      <div class="bracket-match-meta">
        <span>Match #${escapeHtml(String(match.match_number))}</span>
        <span>${escapeHtml(getBracketResultLabel(match))}</span>
      </div>
    </article>
  `;
}

function renderBracketRound(roundMatches, roundIndex, totalRounds) {
  const layout = getBracketRoundLayout(roundIndex);

  return `
    <div class="bracket-round" style="--round-top-space:${layout.topSpacing}px; --round-gap:${layout.betweenSpacing}px; --connector-span:${layout.connectorSpan}px;">
      <h4>${escapeHtml(roundMatches[0]?.round_name || `Round ${roundMatches[0]?.round_number || roundIndex + 1}`)}</h4>
      <div class="bracket-round-stack">
        ${roundMatches
          .map((match, matchIndex) => {
            const branchClass =
              roundIndex < totalRounds - 1
                ? matchIndex % 2 === 0
                  ? "branch-top"
                  : "branch-bottom"
                : "";

            return `
              <div class="bracket-node ${branchClass} ${roundIndex > 0 ? "has-entry" : ""} ${roundIndex < totalRounds - 1 ? "has-next" : ""}">
                ${renderBracketMatchCard(match)}
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

  function renderChampionLane(eventId) {
    const champion = getChampionForEvent(eventId);

    return `
      <aside class="bracket-champion-lane">
        <span class="eyebrow">Final outcome</span>
        <div class="bracket-champion-card ${champion ? "is-decided" : ""}">
          ${
            champion
              ? `
                  <div class="bracket-champion-summary">
                    <div class="bracket-champion-row">
                      <span class="bracket-champion-label">Winner</span>
                      <strong>${escapeHtml(champion.champion_name || "Winner pending")}</strong>
                    </div>
                    <div class="bracket-champion-row">
                      <span class="bracket-champion-label">Runner-up</span>
                      <span class="bracket-champion-name">${escapeHtml(champion.finalist_name || "-")}</span>
                    </div>
                    <div class="bracket-champion-row is-meta">
                      <span class="bracket-champion-label">Result</span>
                      <span class="bracket-champion-detail">${escapeHtml(
                        champion.score_summary || champion.result_type || champion.round_name || "-"
                      )}</span>
                    </div>
                  </div>
                `
              : `
                  <strong>Awaiting final</strong>
                  <span>Winner and runner-up will appear here</span>
                `
          }
        </div>
      </aside>
    `;
  }

function renderBracketsPage() {
  const events = getFilteredBracketEvents();

  return `
    <section class="action-strip">
      <select id="bracketEventFilter">
        <option value="">All events</option>
        ${getSelectedEvents()
          .map(
            (event) => `
              <option value="${event.id}" ${state.views.bracketEventId === event.id ? "selected" : ""}>
                ${escapeHtml(event.event_name)}
              </option>
            `
          )
          .join("")}
      </select>
      <button class="btn btn-ghost" data-action="refresh-workspace">Refresh</button>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Draw View</p>
          <h3>Event draws</h3>
        </div>
      </div>
      ${
        events.length
          ? events
              .map((event) => {
                const matches = getMatchesForEvent(event.id);
                const groups = groupMatchesByRound(matches);
                const rounds = Object.keys(groups)
                  .map(Number)
                  .sort((a, b) => a - b);

                return `
                  <section class="bracket-board">
                    <div class="panel-head">
                      <div>
                        <p class="eyebrow">${escapeHtml(event.format)}</p>
                        <h3>${escapeHtml(event.event_name)}</h3>
                      </div>
                      <div class="toolbar">
                        <a
                          class="btn btn-ghost btn-sm"
                          href="./tournament-draw-sheet.html?tournamentId=${encodeURIComponent(
                            state.selectedTournamentId || ""
                          )}&eventId=${encodeURIComponent(event.id)}"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open Draw Sheet
                        </a>
                        <span class="status-pill status-${statusTone(event.status)}">${escapeHtml(event.status)}</span>
                      </div>
                    </div>
                    <div class="bracket-tree-shell">
                      ${
                        rounds.length
                          ? `
                              <div class="bracket-columns">
                                ${rounds
                                  .map((roundNumber, roundIndex) =>
                                    renderBracketRound(groups[roundNumber], roundIndex, rounds.length)
                                  )
                                  .join("")}
                              </div>
                              ${renderChampionLane(event.id)}
                            `
                              : `<div class="empty-panel compact"><h3>No draw generated</h3><p>Generate the draw to visualize the event draw.</p></div>`
                      }
                    </div>
                  </section>
                `;
              })
              .join("")
          : `<div class="empty-panel compact"><h3>No events selected</h3><p>Create an event or adjust the event filter.</p></div>`
      }
    </section>
  `;
}

function renderCourtMonitorPage() {
  const courtAssignments = getCourtAssignmentMap();
  const readyQueue = getFilteredCourtEvents();

  return `
    <section class="action-strip">
      <select id="courtEventFilter">
        <option value="">All events</option>
        ${getSelectedEvents()
          .map(
            (event) => `
              <option value="${event.id}" ${state.views.courtEventId === event.id ? "selected" : ""}>
                ${escapeHtml(event.event_name)}
              </option>
            `
          )
          .join("")}
      </select>
      <button class="btn btn-primary" data-action="scheduler-dry-run">Preview Court Assignments</button>
      <button class="btn btn-primary" data-action="scheduler-live">Assign Matches to Courts</button>
      <button class="btn btn-ghost" data-action="refresh-workspace">Refresh</button>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Court Status</p>
          <h3>Live court monitor</h3>
        </div>
      </div>
      <div class="court-monitor-grid">
        ${
          state.courts.length
            ? state.courts
                .map((court) => {
                  const assignedMatch = courtAssignments.get(court.id);

                  return `
                    <article class="court-monitor-card">
                      <div class="court-card-head">
                        <strong>${escapeHtml(court.court_name)}</strong>
                        <span class="status-pill status-${statusTone(court.status)}">${escapeHtml(court.status)}</span>
                      </div>
                      <p class="court-referee-line">Referee: ${escapeHtml(
                        getCourtRefereeLabel(court)
                      )}</p>
                      <div class="table-actions">
                        <button
                          class="btn btn-ghost btn-sm"
                          type="button"
                          data-court-action="assign-referee"
                          data-court-id="${court.id}"
                        >
                          ${court.referee_user_id ? "Change Referee" : "Assign Referee"}
                        </button>
                      </div>
                      ${
                        assignedMatch
                          ? `
                              <div class="court-match-block">
                                <p>${escapeHtml(assignedMatch.event_name || "-")}</p>
                                <strong>${escapeHtml(getSideName(assignedMatch, 1))} vs ${escapeHtml(
                                  getSideName(assignedMatch, 2)
                                )}</strong>
                                <span>${escapeHtml(assignedMatch.status)} • ${escapeHtml(
                                  assignedMatch.score_summary || assignedMatch.round_name || "-"
                                )}</span>
                              </div>
                            `
                          : `<div class="court-match-block is-empty"><strong>No active match</strong><span>Court is ready for assignment</span></div>`
                      }
                    </article>
                  `;
                })
                .join("")
            : `<div class="empty-panel compact"><h3>No courts</h3><p>Add tournament courts to enable automatic court assignment.</p></div>`
        }
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Queue</p>
          <h3>Next ready matches</h3>
        </div>
      </div>
      ${
        readyQueue.length
          ? `
              <div class="queue-list">
                ${readyQueue
                  .map(
                    (match) => `
                      <article class="queue-card">
                        <div>
                          <p>${escapeHtml(match.event_name || "-")}</p>
                          <strong>${escapeHtml(getSideName(match, 1))} vs ${escapeHtml(
                            getSideName(match, 2)
                          )}</strong>
                        </div>
                        <span>${escapeHtml(match.round_name || `Round ${match.round_number}`)} • Match #${escapeHtml(
                          String(match.match_number)
                        )}</span>
                      </article>
                    `
                  )
                  .join("")}
              </div>
            `
          : `<div class="empty-panel compact"><h3>No ready queue</h3><p>Ready matches will appear here once earlier rounds are completed.</p></div>`
      }
    </section>
  `;
}

function renderResultsPage() {
  const events = getFilteredResultEvents();

  return `
    <section class="action-strip">
      <select id="resultsEventFilter">
        <option value="">All events</option>
        ${getSelectedEvents()
          .map(
            (event) => `
              <option value="${event.id}" ${state.views.resultsEventId === event.id ? "selected" : ""}>
                ${escapeHtml(event.event_name)}
              </option>
            `
          )
          .join("")}
      </select>
      <button class="btn btn-ghost" data-action="refresh-workspace">Refresh</button>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Champions</p>
          <h3>Event winners and finalists</h3>
        </div>
      </div>
      <div class="results-grid">
        ${
          events.length
            ? events
                .map((event) => {
                  const champion = getChampionForEvent(event.id);

                  return `
                    <article class="result-card">
                      <p class="eyebrow">${escapeHtml(event.format)}</p>
                      <h3>${escapeHtml(event.event_name)}</h3>
                      ${
                        champion
                          ? `
                              <div class="result-winner">
                                <strong>${escapeHtml(champion.champion_name || "Winner pending")}</strong>
                                <span>Champion</span>
                              </div>
                              <div class="result-meta">
                                <span>Finalist: ${escapeHtml(champion.finalist_name || "-")}</span>
                                <span>${escapeHtml(champion.round_name || "-")}</span>
                                <span>${escapeHtml(champion.score_summary || champion.result_type || "-")}</span>
                              </div>
                            `
                          : `<p class="hero-copy">Champion not decided yet.</p>`
                      }
                    </article>
                  `;
                })
                .join("")
            : `<div class="empty-panel compact"><h3>No events selected</h3><p>Adjust the results filter or create an event.</p></div>`
        }
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Completed Matches</p>
          <h3>Result history</h3>
        </div>
      </div>
      ${renderMatchTable(
        getResultMatches(),
        {
          emptyTitle: "No completed matches",
          emptyMessage: "Completed match results will appear here as the tournament progresses."
        }
      )}
    </section>
  `;
}

function renderTournamentContent() {
  const tournament = getSelectedTournament();
  const pageMeta = getPageMeta();

  if (!tournament) {
    return `
      <div class="empty-panel">
        <p class="eyebrow">Tournament workspace</p>
        <h2>Select a tournament</h2>
        <p>Choose a tournament from the left panel or create a new one to begin event operations.</p>
      </div>
    `;
  }

  let pageBody = renderOverviewPage();

  if (state.page === "setup") {
    pageBody = renderSetupPage();
  }

  if (state.page === "brackets") {
    pageBody = renderBracketsPage();
  }

  if (state.page === "operations") {
    pageBody = renderOperationsPage();
  }

  if (state.page === "courts") {
    pageBody = renderCourtMonitorPage();
  }

  if (state.page === "scoring") {
    pageBody = renderScoringPage();
  }

  if (state.page === "results") {
    pageBody = renderResultsPage();
  }

  return `
    <section class="tournament-hero">
      <div>
        <p class="eyebrow">${escapeHtml(pageMeta.eyebrow)}</p>
        <h2>${escapeHtml(tournament.tournament_name)}</h2>
        <p class="hero-copy">
          ${escapeHtml(pageMeta.description)}
        </p>
        <p class="meta-line">
          ${escapeHtml(tournament.venue_name || "Venue pending")}
          ${tournament.city ? ` • ${escapeHtml(tournament.city)}` : ""}
          ${tournament.country ? ` • ${escapeHtml(tournament.country)}` : ""}
          • ${formatDate(tournament.start_date)} - ${formatDate(tournament.end_date)}
        </p>
        </div>
        <div class="hero-actions">
          ${
            hasText(getViewerPortalUrl())
              ? `<button class="btn btn-ghost" data-action="open-viewer-portal">Open Viewer Portal</button>`
              : ""
          }
          <button class="btn btn-ghost" data-action="edit-tournament">Edit Tournament</button>
          <button class="btn btn-danger" data-action="delete-tournament">Delete Tournament</button>
          <span class="status-pill status-${statusTone(tournament.status)}">${escapeHtml(
            tournament.status
          )}</span>
      </div>
    </section>

    ${renderConsoleNav()}
    ${pageBody}
  `;
}

function renderPage() {
  const app = getApp();
  const pageMeta = getPageMeta();

  if (!app) {
    return;
  }

  app.innerHTML = `
    <section class="page-header">
      <div>
        <p class="eyebrow">${escapeHtml(pageMeta.eyebrow)}</p>
        <h2>${escapeHtml(pageMeta.title)}</h2>
        <p class="hero-copy">${escapeHtml(pageMeta.description)}</p>
      </div>
      ${
        shouldShowCreateTournamentButton()
          ? `
            <div class="hero-actions">
              <button class="btn btn-primary" data-action="create-tournament">New Tournament</button>
            </div>
          `
          : ""
      }
    </section>

    ${renderNotice()}

    <div class="workspace-shell">
      <aside class="panel sidebar-panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Tournaments</p>
            <h3>Schedule list</h3>
          </div>
        </div>
        ${
          state.loading && !state.tournaments.length
            ? `<div class="loading-card">Loading tournaments...</div>`
            : renderTournamentList()
        }
      </aside>

      <section class="workspace-main">
        ${
          state.loading && state.selectedTournamentId
            ? `<div class="loading-card">Refreshing tournament workspace...</div>`
            : renderTournamentContent()
        }
      </section>
    </div>
  `;

  bindPageEvents();
}

function bindPageEvents() {
  document.querySelector('[data-action="create-tournament"]')?.addEventListener("click", openTournamentModal);
  document.querySelector('[data-action="edit-tournament"]')?.addEventListener("click", () =>
    openTournamentModal("edit")
  );
  document.querySelector('[data-action="delete-tournament"]')?.addEventListener("click", deleteSelectedTournament);
  document.querySelector('[data-action="open-viewer-portal"]')?.addEventListener("click", () => {
    const viewerPortalUrl = getViewerPortalUrl();

    if (!hasText(viewerPortalUrl)) {
      return;
    }

    window.open(viewerPortalUrl, "_blank", "noopener");
  });
  document.querySelector('[data-action="dismiss-notice"]')?.addEventListener("click", () => {
    clearNotice();
    renderPage();
  });
  document.querySelector('[data-action="add-event"]')?.addEventListener("click", openEventModal);
  document.querySelector('[data-action="add-court"]')?.addEventListener("click", openCourtModal);
  document.querySelector('[data-action="refresh-workspace"]')?.addEventListener("click", refreshSelectedTournament);
  document.querySelector('[data-action="process-byes"]')?.addEventListener("click", () => processByes());
  document.querySelector('[data-action="scheduler-dry-run"]')?.addEventListener("click", () => runScheduler(true));
  document.querySelector('[data-action="scheduler-live"]')?.addEventListener("click", () => runScheduler(false));

  document.querySelectorAll("[data-tournament-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      setSelectedTournamentId(button.dataset.tournamentId);
      await refreshSelectedTournament();
    });
  });

  document.querySelectorAll("[data-event-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const eventId = button.dataset.eventId;
      const action = button.dataset.eventAction;
      const eventRecord = getSelectedEvents().find((event) => event.id === eventId);

      if (action === "edit" && eventRecord) await openEventModal(eventRecord);
      if (action === "registrations") await openRegistrationsModal(eventId);
      if (action === "participants") await openParticipantsModal(eventId);
      if (action === "draw") await generateDraw(eventId);
      if (action === "byes") await processByes(eventId);
      if (action === "scheduler") await runScheduler(true, eventId);
    });
  });

  document.querySelectorAll("[data-match-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const match = (state.matches || []).find((item) => item.id === button.dataset.matchId);

      if (!match) {
        return;
      }

      if (button.dataset.matchAction === "assign") openAssignCourtModal(match);
      if (button.dataset.matchAction === "start") await startMatch(match);
      if (button.dataset.matchAction === "score") await openScoringModal(match);
      if (button.dataset.matchAction === "complete") await openCompleteMatchModal(match);
    });
  });

  document.querySelectorAll("[data-court-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const court = (state.courts || []).find((item) => item.id === button.dataset.courtId);

      if (!court) {
        return;
      }

      if (button.dataset.courtAction === "assign-referee") {
        openCourtRefereeModal(court);
      }
    });
  });

  document.getElementById("matchEventFilter")?.addEventListener("change", (event) => {
    state.filters.eventId = event.target.value;
    renderPage();
  });

  document.getElementById("matchStatusFilter")?.addEventListener("change", (event) => {
    state.filters.status = event.target.value;
    renderPage();
  });

  document.getElementById("bracketEventFilter")?.addEventListener("change", (event) => {
    state.views.bracketEventId = event.target.value;
    renderPage();
  });

  document.getElementById("courtEventFilter")?.addEventListener("change", (event) => {
    state.views.courtEventId = event.target.value;
    renderPage();
  });

  document.getElementById("resultsEventFilter")?.addEventListener("change", (event) => {
    state.views.resultsEventId = event.target.value;
    renderPage();
  });
}

async function loadTournaments(keepSelection = true) {
  const tournaments = (await tournamentApi.listTournaments()) || [];
  state.tournaments = tournaments;

  if (!keepSelection || !tournaments.some((tournament) => tournament.id === state.selectedTournamentId)) {
    setSelectedTournamentId(tournaments[0]?.id || null);
  }
}

async function loadPlayers() {
  const players = (await tournamentApi.listPlayers()) || [];
  state.players = players;
}

async function loadSelectedTournamentData() {
  if (!state.selectedTournamentId) {
    state.overview = null;
    state.matches = [];
    state.readyMatches = [];
    state.courts = [];
    state.registrations = [];
    state.referees = [];
    return;
  }

  const [overview, matches, readyMatches, courts, referees, registrations] = await Promise.all([
    tournamentApi.getOverview(state.selectedTournamentId),
    tournamentApi.listMatches(state.selectedTournamentId),
    tournamentApi.listReadyMatches(state.selectedTournamentId),
    tournamentApi.listCourts(state.selectedTournamentId),
    tournamentApi.listReferees(state.selectedTournamentId),
    tournamentApi.listRegistrations(state.selectedTournamentId)
  ]);

  state.overview = overview;
  state.matches = matches || [];
  state.readyMatches = readyMatches || [];
  state.courts = courts || [];
  state.registrations = registrations || [];
  state.referees = referees || [];

  if (
    state.filters.eventId &&
    !(state.overview?.events || []).some((event) => event.id === state.filters.eventId)
  ) {
    state.filters.eventId = "";
  }

  for (const key of ["bracketEventId", "courtEventId", "resultsEventId"]) {
    if (
      state.views[key] &&
      !(state.overview?.events || []).some((event) => event.id === state.views[key])
    ) {
      state.views[key] = "";
    }
  }
}

async function refreshWorkspace({ keepSelection = true } = {}) {
  state.loading = true;
  renderPage();

  try {
    await loadTournaments(keepSelection);
    await loadPlayers();
    await loadSelectedTournamentData();
  } catch (error) {
    setNotice(error.message, "danger");
  } finally {
    state.loading = false;
    renderPage();
  }
}

async function refreshSelectedTournament() {
  state.loading = true;
  renderPage();

  try {
    await loadSelectedTournamentData();
  } catch (error) {
    setNotice(error.message, "danger");
  } finally {
    state.loading = false;
    renderPage();
  }
}

function closeModal() {
  document.querySelectorAll(".modal").forEach((modal) => modal.remove());
}

function openModal({ title, body, wide = false }) {
  closeModal();

  const modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-content ${wide ? "modal-content-wide" : ""}">
      <button class="modal-close" type="button" aria-label="Close">✕</button>
      <div class="modal-header-block">
        <h3>${escapeHtml(title)}</h3>
      </div>
      <div class="modal-body">${body}</div>
    </div>
  `;

  modal.querySelector(".modal-backdrop").onclick = closeModal;
  modal.querySelector(".modal-close").onclick = closeModal;
  document.body.appendChild(modal);

  return modal;
}

async function openTournamentModal(mode = "create") {
  const isEdit = mode === "edit";
  const tournament = isEdit ? getSelectedTournament() : null;
  const metadata =
    tournament?.metadata && typeof tournament.metadata === "object" && !Array.isArray(tournament.metadata)
      ? tournament.metadata
      : {};
  const modal = openModal({
    title: isEdit ? "Edit Tournament" : "Create Tournament",
    body: `
      <form id="tournamentForm" class="stack-form">
        <label>Tournament Name<input name="tournament_name" required value="${escapeHtml(
          tournament?.tournament_name || ""
        )}" /></label>
        <label>Tournament Code<input name="tournament_code" value="${escapeHtml(
          tournament?.tournament_code || ""
        )}" /></label>
        <label>Venue<input name="venue_name" value="${escapeHtml(
          tournament?.venue_name || ""
        )}" /></label>
        <div class="form-grid">
          <label>City<input name="city" value="${escapeHtml(tournament?.city || "")}" /></label>
          <label>State<input name="state" value="${escapeHtml(tournament?.state || "")}" /></label>
        </div>
        <div class="form-grid">
          <label>Country<input name="country" value="${escapeHtml(tournament?.country || "India")}" /></label>
          <label>Status
            <select name="status">
              <option value="draft" ${tournament?.status === "draft" || !tournament ? "selected" : ""}>draft</option>
              <option value="registration_open" ${tournament?.status === "registration_open" ? "selected" : ""}>registration_open</option>
            </select>
          </label>
        </div>
        <div class="form-grid">
          <label>Start Date<input type="date" name="start_date" required value="${escapeHtml(
            tournament?.start_date || ""
          )}" /></label>
          <label>End Date<input type="date" name="end_date" required value="${escapeHtml(
            tournament?.end_date || ""
          )}" /></label>
        </div>
        <div class="form-grid">
          <label>UPI ID<input name="payment_upi_id" placeholder="academy@upi" value="${escapeHtml(
            metadata.payment_upi_id || ""
          )}" /></label>
          <label>UPI QR Image URL<input name="payment_upi_qr_url" placeholder="https://..." value="${escapeHtml(
            metadata.payment_upi_qr_url || ""
          )}" /></label>
        </div>
        <div class="form-grid">
          <label>Bank Name<input name="payment_bank_name" value="${escapeHtml(
            metadata.payment_bank_name || ""
          )}" /></label>
          <label>Account Name<input name="payment_account_name" value="${escapeHtml(
            metadata.payment_account_name || ""
          )}" /></label>
        </div>
        <div class="form-grid">
          <label>Account Number<input name="payment_account_number" value="${escapeHtml(
            metadata.payment_account_number || ""
          )}" /></label>
          <label>IFSC<input name="payment_ifsc" value="${escapeHtml(
            metadata.payment_ifsc || ""
          )}" /></label>
        </div>
        <label>Payment Note<textarea name="payment_note" rows="2" placeholder="Optional payment instructions shown on the public registration page">${escapeHtml(
          metadata.payment_note || ""
        )}</textarea></label>
        <label>Notes<textarea name="notes" rows="3">${escapeHtml(
          tournament?.notes || ""
        )}</textarea></label>
        <button class="btn btn-primary" type="submit">${isEdit ? "Save Tournament" : "Create Tournament"}</button>
      </form>
    `
  });

  modal.querySelector("#tournamentForm").onsubmit = async (event) => {
    event.preventDefault();

    try {
      const rawPayload = Object.fromEntries(new FormData(event.currentTarget).entries());
      const payload = {
        ...rawPayload,
        metadata: {
          payment_upi_id: rawPayload.payment_upi_id || null,
          payment_upi_qr_url: rawPayload.payment_upi_qr_url || null,
          payment_bank_name: rawPayload.payment_bank_name || null,
          payment_account_name: rawPayload.payment_account_name || null,
          payment_account_number: rawPayload.payment_account_number || null,
          payment_ifsc: rawPayload.payment_ifsc || null,
          payment_note: rawPayload.payment_note || null
        }
      };

      delete payload.payment_upi_id;
      delete payload.payment_upi_qr_url;
      delete payload.payment_bank_name;
      delete payload.payment_account_name;
      delete payload.payment_account_number;
      delete payload.payment_ifsc;
      delete payload.payment_note;

      const savedTournament = isEdit
        ? await tournamentApi.updateTournament(state.selectedTournamentId, payload)
        : await tournamentApi.createTournament(payload);
      setSelectedTournamentId(savedTournament.id);
      state.lastActionResult = {
        title: isEdit ? "Tournament updated" : "Tournament created",
        message: savedTournament.tournament_name,
        payload: savedTournament
      };
      setNotice(isEdit ? "Tournament updated successfully" : "Tournament created successfully", "success");
      closeModal();
      await refreshWorkspace({ keepSelection: true });
    } catch (error) {
      alert(error.message);
    }
  };
}

async function deleteSelectedTournament() {
  const tournament = getSelectedTournament();

  if (!tournament) {
    return;
  }

  const confirmationText = getDeleteConfirmationText(tournament);
  const userInput = window.prompt(
    `To permanently delete this tournament, type:\n${confirmationText}`
  );

  if (userInput === null) {
    return;
  }

  if (userInput.trim() !== confirmationText) {
    alert("Delete confirmation did not match. Tournament was not deleted.");
    return;
  }

  try {
    const payload = await tournamentApi.deleteTournament(tournament.id);

    state.lastActionResult = {
      title: "Tournament deleted",
      dry_run: false,
      message: payload.message,
      payload
    };
    setSelectedTournamentId(null);
    setNotice(`Tournament "${tournament.tournament_name}" deleted successfully`, "success");
    await refreshWorkspace({ keepSelection: false });
  } catch (error) {
    alert(error.message);
  }
}

function openEventModal(eventRecord = null) {
  if (!state.selectedTournamentId) {
    return;
  }

  const metadata =
    eventRecord?.metadata && typeof eventRecord.metadata === "object"
      ? eventRecord.metadata
      : {};
  const registrationEnabled =
    typeof metadata.registration_enabled === "boolean"
      ? metadata.registration_enabled
      : String(eventRecord?.status || "").toLowerCase() === "registration_open";
  const registrationFee = metadata.registration_fee ?? 0;
  const feeType = metadata.fee_type || "inclusive_gst";
  const gstPercent = metadata.gst_percent ?? 0;
  const mode = eventRecord ? "edit" : "create";

  const modal = openModal({
    title: eventRecord ? "Edit Event" : "Create Event",
    body: `
      <form id="eventForm" class="stack-form">
        <label>Event Name<input name="event_name" required value="${escapeHtml(
          eventRecord?.event_name || ""
        )}" /></label>
        <div class="form-grid">
          <label>Category<input name="category_name" value="${escapeHtml(
            eventRecord?.category_name || ""
          )}" /></label>
          <label>Event Code<input name="event_code" value="${escapeHtml(
            eventRecord?.event_code || ""
          )}" /></label>
        </div>
        <div class="form-grid">
          <label>Format
            <select name="format">
              <option value="singles" ${eventRecord?.format === "singles" || !eventRecord ? "selected" : ""}>singles</option>
              <option value="doubles" ${eventRecord?.format === "doubles" ? "selected" : ""}>doubles</option>
            </select>
          </label>
          <label>Status
            <select name="status">
              <option value="draft" ${eventRecord?.status === "draft" || !eventRecord ? "selected" : ""}>draft</option>
              <option value="registration_open" ${eventRecord?.status === "registration_open" ? "selected" : ""}>registration_open</option>
              <option value="draw_pending" ${eventRecord?.status === "draw_pending" ? "selected" : ""}>draw_pending</option>
              <option value="draw_generated" ${eventRecord?.status === "draw_generated" ? "selected" : ""}>draw_generated</option>
              <option value="in_progress" ${eventRecord?.status === "in_progress" ? "selected" : ""}>in_progress</option>
              <option value="completed" ${eventRecord?.status === "completed" ? "selected" : ""}>completed</option>
            </select>
          </label>
        </div>
        <div class="form-grid">
          <label>Gender<input name="gender" value="${escapeHtml(
            eventRecord?.gender || ""
          )}" /></label>
          <label>Age Group<input name="age_group" value="${escapeHtml(
            eventRecord?.age_group || ""
          )}" /></label>
        </div>
        <div class="form-grid">
          <label>Best Of Sets
            <select name="best_of_sets">
              <option value="1" ${Number(eventRecord?.best_of_sets) === 1 ? "selected" : ""}>1</option>
              <option value="3" ${Number(eventRecord?.best_of_sets ?? 3) === 3 ? "selected" : ""}>3</option>
              <option value="5" ${Number(eventRecord?.best_of_sets) === 5 ? "selected" : ""}>5</option>
            </select>
          </label> 
          <label>Draw Size<input type="number" name="draw_size" min="2" value="${escapeHtml(
            eventRecord?.draw_size || ""
          )}" /></label>
        </div>
        <div class="form-grid">
          <label>Points Per Set<input type="number" name="points_per_set" min="1" value="${escapeHtml(
            String(eventRecord?.points_per_set ?? 21)
          )}" /></label>
          <label>Max Points Per Set<input type="number" name="max_points_per_set" min="1" value="${escapeHtml(
            String(eventRecord?.max_points_per_set ?? 30)
          )}" /></label>
        </div>
        <div class="form-grid">
          <label>Open Registration
            <select name="registration_enabled">
              <option value="true" ${registrationEnabled ? "selected" : ""}>true</option>
              <option value="false" ${!registrationEnabled ? "selected" : ""}>false</option>
            </select>
          </label>
          <label>Registration Fee<input type="number" name="registration_fee" min="0" step="0.01" value="${escapeHtml(
            String(registrationFee)
          )}" /></label>
        </div>
        <div class="form-grid">
          <label>Fee Type
            <select name="fee_type">
              <option value="inclusive_gst" ${feeType === "inclusive_gst" ? "selected" : ""}>inclusive_gst</option>
              <option value="exclusive_gst" ${feeType === "exclusive_gst" ? "selected" : ""}>exclusive_gst</option>
            </select>
          </label>
          <label>GST Percent<input type="number" name="gst_percent" min="0" step="0.01" value="${escapeHtml(
            String(gstPercent)
          )}" /></label>
        </div>
        <label>Sort Order<input type="number" name="sort_order" min="0" value="${escapeHtml(
          String(eventRecord?.sort_order ?? getSelectedEvents().length)
        )}" /></label>
        <button class="btn btn-primary" type="submit">${eventRecord ? "Save Event" : "Create Event"}</button>
      </form>
    `
  });

  modal.querySelector("#eventForm").onsubmit = async (event) => {
    event.preventDefault();

    try {
      const rawPayload = Object.fromEntries(new FormData(event.currentTarget).entries());
      const payload = {
        ...rawPayload,
        metadata: {
          registration_enabled: rawPayload.registration_enabled === "true",
          registration_fee: Number(rawPayload.registration_fee || 0),
          fee_type: rawPayload.fee_type || "inclusive_gst",
          gst_percent: Number(rawPayload.gst_percent || 0)
        }
      };

      delete payload.registration_enabled;
      delete payload.registration_fee;
      delete payload.fee_type;
      delete payload.gst_percent;

      if (mode === "edit" && eventRecord?.id) {
        await tournamentApi.updateEvent(state.selectedTournamentId, eventRecord.id, payload);
        setNotice("Event updated successfully", "success");
      } else {
        await tournamentApi.createEvent(state.selectedTournamentId, payload);
        setNotice("Event created successfully", "success");
      }
      closeModal();
      await refreshSelectedTournament();
    } catch (error) {
      alert(error.message);
    }
  };
}

function openCourtModal() {
  if (!state.selectedTournamentId) {
    return;
  }

  const modal = openModal({
    title: "Add Court",
    body: `
      <form id="courtForm" class="stack-form">
        <label>Court Name<input name="court_name" required /></label>
        <div class="form-grid">
          <label>Sort Order<input type="number" name="sort_order" min="0" value="${escapeHtml(
            String(state.courts.length)
          )}" /></label>
          <label>Status
            <select name="status">
              <option value="available">available</option>
              <option value="disabled">disabled</option>
            </select>
          </label>
        </div>
        <label>Notes<textarea name="notes" rows="2"></textarea></label>
        <button class="btn btn-primary" type="submit">Save Court</button>
      </form>
    `
  });

  modal.querySelector("#courtForm").onsubmit = async (event) => {
    event.preventDefault();

    try {
      const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
      await tournamentApi.createCourt(state.selectedTournamentId, payload);
      setNotice("Court added successfully", "success");
      closeModal();
      await refreshSelectedTournament();
    } catch (error) {
      alert(error.message);
    }
  };
}

function openCourtRefereeModal(court) {
  if (!state.selectedTournamentId) {
    return;
  }

  const modal = openModal({
    title: `Assign Referee • ${court.court_name}`,
    body: `
      <form id="courtRefereeForm" class="stack-form">
        <p class="field-note">Only the assigned referee will see matches on this court inside the referee console.</p>
        <label>Referee
          <select name="referee_user_id">
            <option value="">Unassigned</option>
            ${state.referees
              .map(
                (referee) => `
                  <option
                    value="${escapeHtml(String(referee.id))}"
                    ${String(court.referee_user_id || "") === String(referee.id) ? "selected" : ""}
                  >
                    ${escapeHtml(getRefereeOptionLabel(referee))}
                  </option>
                `
              )
              .join("")}
          </select>
        </label>
        <button class="btn btn-primary" type="submit">Save Referee Assignment</button>
      </form>
    `
  });

  modal.querySelector("#courtRefereeForm").onsubmit = async (event) => {
    event.preventDefault();

    try {
      const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
      await tournamentApi.assignCourtReferee(
        state.selectedTournamentId,
        court.id,
        {
          referee_user_id: payload.referee_user_id || null
        }
      );

      setNotice("Court referee assignment saved", "success");
      closeModal();
      await refreshSelectedTournament();
    } catch (error) {
      alert(error.message);
    }
  };
}

async function openParticipantsModal(eventId) {
  const event = getSelectedEvent(eventId);

  if (!event) {
    return;
  }

  try {
    const participants =
      (await tournamentApi.listParticipants(state.selectedTournamentId, eventId)) || [];

    const modal = openModal({
      title: `${event.event_name} Participants`,
      wide: true,
      body: `
        <div class="split-modal">
          <section>
            <p class="eyebrow">Registered teams</p>
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>Seed</th>
                    <th>Draw</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${
                    participants.length
                      ? participants
                          .map(
                            (participant) => `
                              <tr>
                                <td>${escapeHtml(participant.display_name || participant.team_name || "-")}</td>
                                <td>${escapeHtml(String(participant.seed_number || "-"))}</td>
                                <td>${escapeHtml(String(participant.draw_position || "-"))}</td>
                                <td>${escapeHtml(participant.status || "-")}</td>
                              </tr>
                            `
                          )
                          .join("")
                      : "<tr><td colspan='4'>No participants yet</td></tr>"
                  }
                </tbody>
              </table>
            </div>
          </section>
          <section>
            <p class="eyebrow">Add participant</p>
              <form id="participantForm" class="stack-form">
                <label>Team Name<input name="team_name" /></label>
                <label>Player 1 (Academy)
                  <select name="player1_id">
                    ${renderPlayerOptions()}
                  </select>
                </label>
                <label>Player 1 (Outside Academy)
                  <input name="player1_name" placeholder="Enter player name if not in academy" />
                </label>
                ${
                  event.format === "doubles"
                    ? `
                        <label>Player 2 (Academy)
                          <select name="player2_id">
                            ${renderPlayerOptions()}
                          </select>
                        </label>
                        <label>Player 2 (Outside Academy)
                          <input name="player2_name" placeholder="Enter player name if not in academy" />
                        </label>
                      `
                    : ""
                }
                <div class="form-grid">
                  <label>Seed Number<input type="number" name="seed_number" min="1" /></label>
                  <label>Draw Position<input type="number" name="draw_position" min="1" /></label>
                </div>
                <label>Coach ID<input name="coach_id" /></label>
                <p class="field-note">Choose an academy player or type an outside player name for each slot.</p>
                <button class="btn btn-primary" type="submit">Add Participant</button>
              </form>
            </section>
        </div>
      `
    });

    modal.querySelector("#participantForm").onsubmit = async (submitEvent) => {
      submitEvent.preventDefault();

        try {
          const payload = Object.fromEntries(new FormData(submitEvent.currentTarget).entries());

          if (!payload.team_name) {
            payload.team_name = [
              getPlayerName(payload.player1_id) || payload.player1_name,
              getPlayerName(payload.player2_id) || payload.player2_name
            ]
              .map((value) => (hasText(value) ? String(value).trim() : null))
              .filter(hasText)
              .join(" / ");
          }

          await tournamentApi.registerParticipant(eventId, payload);
        setNotice("Participant added successfully", "success");
        closeModal();
        await refreshSelectedTournament();
        await openParticipantsModal(eventId);
      } catch (error) {
        alert(error.message);
      }
    };
  } catch (error) {
    alert(error.message);
  }
}

async function generateDraw(eventId, clearExisting = false) {
  try {
    const payload = await tournamentApi.generateDraw(
      state.selectedTournamentId,
      eventId,
      { clear_existing: clearExisting }
    );

    state.lastActionResult = {
      title: "Draw generated",
      dry_run: false,
      payload
    };
    setNotice("Draw generation completed", "success");
    await refreshSelectedTournament();
  } catch (error) {
    if (
      !clearExisting &&
      /existing|clear/i.test(error.message) &&
      window.confirm("A pending draw already exists. Rebuild it from scratch?")
    ) {
      await generateDraw(eventId, true);
      return;
    }

    alert(error.message);
  }
}

async function processByes(eventId = null) {
  if (!state.selectedTournamentId) {
    return;
  }

  try {
    const payload = await tournamentApi.processByes(state.selectedTournamentId, {
      event_id: eventId
    });

    state.lastActionResult = {
      title: "Bye processing",
      dry_run: false,
      payload
    };
    setNotice("Bye processing completed", "success");
    await refreshSelectedTournament();
  } catch (error) {
    alert(error.message);
  }
}

async function runScheduler(dryRun, eventId = null) {
  if (!state.selectedTournamentId) {
    return;
  }

  try {
    const payload = await tournamentApi.runScheduler(state.selectedTournamentId, {
      event_id: eventId,
      dry_run: dryRun
    });

    state.lastActionResult = {
        title: dryRun ? "Court assignment preview" : "Court assignment run",
      dry_run: dryRun,
      message: payload.message,
      payload
    };
      setNotice(
        dryRun ? "Court assignment preview completed" : "Matches assigned to available courts",
        "success"
      );
    await refreshSelectedTournament();
  } catch (error) {
    alert(error.message);
  }
}

function openAssignCourtModal(match) {
  const availableCourts = state.courts.filter(
    (court) => court.status === "available" || court.id === match.court_id
  );

  const modal = openModal({
    title: `Assign Court • Match #${match.match_number}`,
    body: `
      <form id="assignCourtForm" class="stack-form">
        <p>${escapeHtml(getSideName(match, 1))} vs ${escapeHtml(getSideName(match, 2))}</p>
        <label>Court
          <select name="court_id" required>
            <option value="">Select a court</option>
            ${availableCourts
              .map(
                (court) => `
                  <option value="${court.id}" ${court.id === match.court_id ? "selected" : ""}>
                    ${escapeHtml(court.court_name)} (${escapeHtml(court.status)})
                  </option>
                `
              )
              .join("")}
          </select>
        </label>
        <button class="btn btn-primary" type="submit">Assign Court</button>
      </form>
    `
  });

  modal.querySelector("#assignCourtForm").onsubmit = async (event) => {
    event.preventDefault();

    try {
      const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
      await tournamentApi.assignCourt(match.id, payload);
      setNotice("Court assigned successfully", "success");
      closeModal();
      await refreshSelectedTournament();
    } catch (error) {
      alert(error.message);
    }
  };
}

async function startMatch(match) {
  if (!window.confirm(`Start match #${match.match_number}?`)) {
    return;
  }

  try {
    await tournamentApi.startMatch(match.id);
    setNotice("Match started", "success");
    await refreshSelectedTournament();
  } catch (error) {
    alert(error.message);
  }
}

async function openRegistrationsModal(eventId) {
  const event = getSelectedEvent(eventId);

  if (!event) {
    return;
  }

  const registrations = getRegistrationsForEvent(eventId);
  const summary = summarizeRegistrationsForEvent(eventId);

  const modal = openModal({
    title: `${event.event_name} Registrations`,
    wide: true,
    body: `
      <div class="stack-form">
        <div class="result-tags">
          <span class="result-tag">Total: ${escapeHtml(String(summary.total))}</span>
          <span class="result-tag">Paid: ${escapeHtml(String(summary.paid))}</span>
          <span class="result-tag">Pending: ${escapeHtml(String(summary.pending))}</span>
          <span class="result-tag">Rejected: ${escapeHtml(String(summary.rejected))}</span>
        </div>
        <div class="registration-review-list">
          ${
            registrations.length
              ? registrations
                  .map(
                    (registration) => {
                      const paymentReview = getRegistrationPaymentReviewBadge(registration);

                      return `
                      <article class="registration-review-card">
                        <div class="registration-review-header">
                          <div>
                            <h4>${escapeHtml(registration.player_name || "-")}</h4>
                            <p class="table-subtitle">${escapeHtml(registration.gender || "-")} • ${escapeHtml(
                              String(registration.age || "-")
                            )}</p>
                            <div class="registration-review-badges">
                              <span class="status-pill status-${statusTone(registration.payment_status)}">${escapeHtml(
                                registration.payment_status || "-"
                              )}</span>
                              <span class="result-tag tone-${escapeHtml(paymentReview.tone)}">${escapeHtml(
                                paymentReview.label
                              )}</span>
                            </div>
                          </div>
                        </div>

                        <div class="registration-review-grid">
                          <div class="registration-review-meta">
                            <div class="registration-review-meta-item">
                              <span>Email</span>
                              <strong>${escapeHtml(registration.email || "-")}</strong>
                            </div>
                            <div class="registration-review-meta-item">
                              <span>Phone</span>
                              <strong>${escapeHtml(registration.phone_number || "-")}</strong>
                            </div>
                            <div class="registration-review-meta-item">
                              <span>Entry</span>
                              <strong>${escapeHtml(registration.event?.entry_type || "-")}</strong>
                            </div>
                            <div class="registration-review-meta-item">
                              <span>Payment Method</span>
                              <strong>${escapeHtml(registration.payment_method || "-")}</strong>
                            </div>
                            <div class="registration-review-meta-item">
                              <span>Partner</span>
                              <strong>${escapeHtml(registration.event?.partner_name || "-")}</strong>
                            </div>
                            <div class="registration-review-meta-item">
                              <span>Submitted</span>
                              <strong>${escapeHtml(formatDate(registration.created_at))}</strong>
                            </div>
                            <div class="registration-review-meta-item">
                              <span>Participant</span>
                              <strong>${
                                registration.participant?.display_name
                                  ? escapeHtml(registration.participant.display_name)
                                  : "Not added yet"
                              }</strong>
                            </div>
                            <div class="registration-review-meta-item">
                              <span>Proof</span>
                              ${
                                hasText(registration.payment_proof_url)
                                  ? `<a class="btn btn-secondary btn-sm" href="${escapeHtml(
                                      registration.payment_proof_url
                                    )}" target="_blank" rel="noopener noreferrer">Open Proof</a>`
                                  : '<strong>-</strong>'
                              }
                            </div>
                          </div>

                          <form class="registration-review-form stack-form" data-registration-id="${escapeHtml(
                            registration.id
                          )}" data-entry-id="${escapeHtml(
                            registration.event?.entry_row_id || ""
                          )}" data-participant-id="${escapeHtml(
                            registration.participant?.id || ""
                          )}">
                            <div class="registration-review-controls">
                              <label>
                                Payment
                                <select name="payment_status">
                                  <option value="pending" ${
                                    registration.payment_status === "pending" ? "selected" : ""
                                  }>pending</option>
                                  <option value="paid" ${
                                    registration.payment_status === "paid" ? "selected" : ""
                                  }>paid</option>
                                  <option value="rejected" ${
                                    registration.payment_status === "rejected" ? "selected" : ""
                                  }>rejected</option>
                                </select>
                              </label>
                              <label>
                                Entry
                                <select name="entry_status">
                                  <option value="submitted" ${
                                    registration.event?.status === "submitted" ? "selected" : ""
                                  }>submitted</option>
                                  <option value="approved" ${
                                    registration.event?.status === "approved" ? "selected" : ""
                                  }>approved</option>
                                  <option value="rejected" ${
                                    registration.event?.status === "rejected" ? "selected" : ""
                                  }>rejected</option>
                                </select>
                              </label>
                            </div>
                            <label>
                              Notes
                              <textarea name="notes" rows="3" placeholder="Optional review note">${escapeHtml(
                                registration.notes || ""
                              )}</textarea>
                            </label>
                            <div class="registration-review-actions">
                              <button class="btn btn-primary btn-sm" type="submit">Save Review</button>
                              <button
                                class="btn btn-secondary btn-sm"
                                type="button"
                                data-registration-action="approve-participant"
                                ${
                                  registration.participant?.id
                                    ? "disabled"
                                    : registration.payment_status === "paid"
                                      ? ""
                                      : "disabled"
                                }
                              >
                                ${
                                  registration.participant?.id
                                    ? "Participant Added"
                                    : "Approve & Add"
                                }
                              </button>
                            </div>
                          </form>
                        </div>
                      </article>
                    `;
                    }
                  )
                  .join("")
              : `<div class="empty-panel compact">No registrations submitted yet.</div>`
          }
        </div>
      </div>
    `
  });

  modal.querySelectorAll(".registration-review-form").forEach((form) => {
    const paymentSelect = form.querySelector('select[name="payment_status"]');
    const approveButton = form.querySelector('[data-registration-action="approve-participant"]');
    const participantId = form.dataset.participantId;

    const syncApproveButtonState = () => {
      if (!approveButton) {
        return;
      }

      if (participantId) {
        approveButton.disabled = true;
        approveButton.textContent = "Participant Added";
        return;
      }

      const isPaid = paymentSelect?.value === "paid";
      approveButton.disabled = !isPaid;
      approveButton.textContent = "Approve & Add";
    };

    paymentSelect?.addEventListener("change", syncApproveButtonState);
    syncApproveButtonState();

    form.onsubmit = async (submitEvent) => {
      submitEvent.preventDefault();

      const formElement = submitEvent.currentTarget;
      const registrationId = formElement.dataset.registrationId;
      const entryId = formElement.dataset.entryId;
      const formData = new FormData(formElement);
      const payload = {
        payment_status: formData.get("payment_status"),
        notes: formData.get("notes")
      };

      if (entryId) {
        payload.entries = [
          {
            id: entryId,
            status: formData.get("entry_status")
          }
        ];
      }

      try {
        await tournamentApi.updateRegistration(state.selectedTournamentId, registrationId, payload);
        setNotice("Registration updated successfully", "success");
        await refreshSelectedTournament();
        await openRegistrationsModal(eventId);
      } catch (error) {
        alert(error.message);
      }
    };

    approveButton?.addEventListener("click", async () => {
      const formElement = form;
      const registrationId = formElement.dataset.registrationId;
      const formData = new FormData(formElement);

      try {
        await tournamentApi.approveRegistrationParticipant(
          state.selectedTournamentId,
          registrationId,
          {
            payment_status: formData.get("payment_status"),
            notes: formData.get("notes")
          }
        );
        setNotice("Registration approved and added to participants", "success");
        await refreshSelectedTournament();
        await openRegistrationsModal(eventId);
      } catch (error) {
        alert(error.message);
      }
    });
  });
}

function clampScoreValue(value, maxValue) {
  const numericValue = Number(value);

  if (Number.isNaN(numericValue)) {
    return 0;
  }

  return Math.min(Math.max(0, numericValue), maxValue);
}

function renderScoreInputField({ label, inputName, inputValue, maxPoints }) {
  return `
    <div class="score-input-group">
      <span class="score-player-label">${escapeHtml(label)}</span>
      <div class="score-stepper">
        <button
          class="score-stepper-btn"
          type="button"
          data-score-action="decrement"
          data-target="${escapeHtml(inputName)}"
        >
          -1
        </button>
        <input
          class="score-stepper-input"
          type="number"
          inputmode="numeric"
          min="0"
          max="${escapeHtml(String(maxPoints))}"
          name="${escapeHtml(inputName)}"
          value="${escapeHtml(String(inputValue))}"
        />
        <button
          class="score-stepper-btn is-primary"
          type="button"
          data-score-action="increment"
          data-target="${escapeHtml(inputName)}"
        >
          +1
        </button>
        <button
          class="score-stepper-btn"
          type="button"
          data-score-action="reset"
          data-target="${escapeHtml(inputName)}"
        >
          Reset
        </button>
      </div>
    </div>
  `;
}

async function openScoringModal(match) {
  try {
    const response = await tournamentApi.getMatchSets(match.id);
    const event = response.event;
    const sets = response.sets || [];
    const setMap = new Map(sets.map((set) => [set.set_number, set]));

    const modal = openModal({
      title: `Live Scoring • Match #${match.match_number}`,
      wide: true,
      body: `
        <div class="scoreboard-header">
          <div>
            <p class="eyebrow">${escapeHtml(event.event_name || match.event_name || "")}</p>
            <h4>${escapeHtml(
              resolveParticipantRecordName(response.participant1, getSideName(match, 1))
            )} vs ${escapeHtml(
              resolveParticipantRecordName(response.participant2, getSideName(match, 2))
            )}</h4>
          </div>
          <p class="scoreboard-meta">Best of ${escapeHtml(String(event.best_of_sets))} • First to ${escapeHtml(
            String(event.points_per_set)
          )} (cap ${escapeHtml(String(event.max_points_per_set))})</p>
        </div>
        <form id="scoreForm" class="stack-form">
          <p class="field-note">Tap +1 on mobile to update rally-by-rally, then save the set scores.</p>
          <div class="score-grid">
            ${Array.from({ length: event.best_of_sets }, (_, index) => {
              const setNumber = index + 1;
              const set = setMap.get(setNumber);

              return `
                <div class="score-card">
                  <h5>Set ${setNumber}</h5>
                  <div class="form-grid">
                    ${renderScoreInputField({
                      label: resolveParticipantRecordName(response.participant1, "Side A"),
                      inputName: `participant1_score_${setNumber}`,
                      inputValue: set?.participant1_score ?? 0,
                      maxPoints: event.max_points_per_set
                    })}
                    ${renderScoreInputField({
                      label: resolveParticipantRecordName(response.participant2, "Side B"),
                      inputName: `participant2_score_${setNumber}`,
                      inputValue: set?.participant2_score ?? 0,
                      maxPoints: event.max_points_per_set
                    })}
                  </div>
                </div>
              `;
            }).join("")}
          </div>
          <button class="btn btn-primary" type="submit">Save Scores</button>
        </form>
      `
    });

    const scoreForm = modal.querySelector("#scoreForm");

    scoreForm.addEventListener("click", (clickEvent) => {
      const trigger = clickEvent.target.closest("[data-score-action]");

      if (!trigger) {
        return;
      }

      const inputName = trigger.dataset.target;
      const input = scoreForm.elements.namedItem(inputName);

      if (!(input instanceof HTMLInputElement)) {
        return;
      }

      const maxValue = Number(input.max || event.max_points_per_set || 30);
      const currentValue = clampScoreValue(input.value, maxValue);
      let nextValue = currentValue;

      switch (trigger.dataset.scoreAction) {
        case "increment":
          nextValue = clampScoreValue(currentValue + 1, maxValue);
          break;
        case "decrement":
          nextValue = clampScoreValue(currentValue - 1, maxValue);
          break;
        case "reset":
          nextValue = 0;
          break;
        default:
          return;
      }

      input.value = String(nextValue);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    });

    scoreForm.addEventListener("input", (inputEvent) => {
      const target = inputEvent.target;

      if (!(target instanceof HTMLInputElement) || target.type !== "number") {
        return;
      }

      const maxValue = Number(target.max || event.max_points_per_set || 30);
      target.value = String(clampScoreValue(target.value, maxValue));
    });

    scoreForm.onsubmit = async (eventSubmit) => {
      eventSubmit.preventDefault();

      try {
        const formData = new FormData(eventSubmit.currentTarget);
        const payload = [];

        for (let setNumber = 1; setNumber <= event.best_of_sets; setNumber += 1) {
          const participant1Score = Number(formData.get(`participant1_score_${setNumber}`) || 0);
          const participant2Score = Number(formData.get(`participant2_score_${setNumber}`) || 0);

          if (participant1Score > 0 || participant2Score > 0 || setMap.has(setNumber)) {
            payload.push({
              set_number: setNumber,
              participant1_score: participant1Score,
              participant2_score: participant2Score
            });
          }
        }

        if (!payload.length) {
          alert("Enter at least one set score");
          return;
        }

        await tournamentApi.updateMatchSets(match.id, { sets: payload });
        setNotice("Scores saved successfully", "success");
        closeModal();
        await refreshSelectedTournament();
      } catch (error) {
        alert(error.message);
      }
    };
  } catch (error) {
    alert(error.message);
  }
}

async function openCompleteMatchModal(match) {
  const modal = openModal({
    title: `Complete Match • Match #${match.match_number}`,
    body: `
      <form id="completeMatchForm" class="stack-form">
        <label>Result Type
          <select name="result_type">
            <option value="normal">normal</option>
            <option value="walkover">walkover</option>
            <option value="retired">retired</option>
            <option value="disqualified">disqualified</option>
          </select>
        </label>
        <label>Winner
          <select name="winner_id">
            <option value="">Auto derive from set scores</option>
            <option value="${match.participant1_id}">${escapeHtml(getSideName(match, 1) || "Side A")}</option>
            <option value="${match.participant2_id}">${escapeHtml(getSideName(match, 2) || "Side B")}</option>
          </select>
        </label>
        <label>Score Summary<input name="score_summary" value="${escapeHtml(match.score_summary || "")}" /></label>
        <button class="btn btn-primary" type="submit">Complete Match</button>
      </form>
    `
  });

  modal.querySelector("#completeMatchForm").onsubmit = async (event) => {
    event.preventDefault();

    try {
      const formData = new FormData(event.currentTarget);
      await tournamentApi.completeMatch(match.id, {
        winner_id: formData.get("winner_id") || null,
        result_type: formData.get("result_type"),
        score_summary: formData.get("score_summary") || null
      });

      setNotice("Match completed successfully", "success");
      closeModal();
      await refreshSelectedTournament();
    } catch (error) {
      alert(error.message);
    }
  };
}

async function renderTournamentPage(page) {
  setActivePage(page);
  clearNotice();
  await refreshWorkspace({ keepSelection: true });
}

export async function renderTournaments() {
  await renderTournamentPage("overview");
}

export async function renderTournamentSetup() {
  await renderTournamentPage("setup");
}

export async function renderTournamentBrackets() {
  await renderTournamentPage("brackets");
}

export async function renderTournamentOperations() {
  await renderTournamentPage("operations");
}

export async function renderTournamentCourts() {
  await renderTournamentPage("courts");
}

export async function renderTournamentScoring() {
  await renderTournamentPage("scoring");
}

export async function renderTournamentResults() {
  await renderTournamentPage("results");
}
