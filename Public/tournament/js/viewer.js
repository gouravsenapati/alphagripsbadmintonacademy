import { publicTournamentApi } from "./services/publicTournamentApi.js";

const state = {
  tournamentLookup: new URLSearchParams(window.location.search).get("tournament") || "",
  overview: null,
  matches: [],
  activeEventId: "",
  loading: true,
  error: ""
};

const TOURNAMENT_HUB_URL = "/Public/tournament.html#tournamentList";

function getApp() {
  return document.getElementById("viewerApp");
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

function formatDateTime(value) {
  if (!value) {
    return "Time pending";
  }

  return new Date(value).toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function statusTone(status) {
  switch (status) {
    case "completed":
      return "success";
    case "scheduled":
    case "in_progress":
      return "accent";
    case "cancelled":
      return "danger";
    case "draft":
    case "draw_pending":
      return "warning";
    default:
      return "neutral";
  }
}

function getTournament() {
  return state.overview?.tournament || null;
}

function getEvents() {
  return state.overview?.events || [];
}

function getSelectedEventId() {
  return state.activeEventId || getEvents()[0]?.id || "";
}

function getSelectedEvent() {
  return getEvents().find((event) => event.id === getSelectedEventId()) || null;
}

function getPublicDrawSheetUrl(eventId = getSelectedEventId()) {
  if (!hasText(state.tournamentLookup)) {
    return "";
  }

  const url = new URL("/Public/tournament/draw-sheet.html", window.location.origin);
  url.searchParams.set("tournament", state.tournamentLookup);

  if (hasText(eventId)) {
    url.searchParams.set("eventId", eventId);
  }

  return url.toString();
}

function rememberViewerContext(eventId = getSelectedEventId()) {
  if (typeof localStorage === "undefined" || !hasText(state.tournamentLookup)) {
    return;
  }

  localStorage.setItem("ag_public_tournament_lookup", state.tournamentLookup);

  if (hasText(eventId)) {
    localStorage.setItem("ag_public_draw_event_id", eventId);
  }
}

function getMatchesForEvent(eventId) {
  return (state.matches || []).filter((match) => match.event_id === eventId);
}

function groupMatchesByRound(matches) {
  const groups = matches.reduce((accumulator, match) => {
    const key = Number(match.round_number) || 0;

    if (!accumulator[key]) {
      accumulator[key] = [];
    }

    accumulator[key].push(match);
    return accumulator;
  }, {});

  Object.values(groups).forEach((roundMatches) => {
    roundMatches.sort((left, right) => Number(left.match_number) - Number(right.match_number));
  });

  return groups;
}

function getSideName(match, sideNumber) {
  return match[`participant${sideNumber}_name`] || "TBD";
}

function getBracketSideLabel(match, sideNumber) {
  const explicitName = match[`participant${sideNumber}_name`] || "";

  if (hasText(explicitName) && explicitName !== "-") {
    return explicitName;
  }

  const ownName = match[`participant${sideNumber}_name`] || "";
  const oppositeName = match[`participant${sideNumber === 1 ? 2 : 1}_name`] || "";

  if (!hasText(ownName) && hasText(oppositeName) && match.result_type === "bye") {
    return "Bye";
  }

  if (!hasText(ownName) && hasText(oppositeName) && sideNumber === 2) {
    return "Bye";
  }

  return "";
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

  if (!finalMatch || finalMatch.status !== "completed" || !hasText(finalMatch.winner_name)) {
    return null;
  }

  return {
    winner: finalMatch.winner_name,
    runnerUp:
      finalMatch.winner_name === getSideName(finalMatch, 1)
        ? getSideName(finalMatch, 2)
        : getSideName(finalMatch, 1),
    result: finalMatch.score_summary || finalMatch.result_type || "-"
  };
}

function getMatchScoreLabel(match) {
  if (hasText(match?.score_summary)) {
    return match.score_summary;
  }

  if (match?.result_type === "bye") {
    return "BYE";
  }

  if (match?.result_type === "walkover") {
    return "WO";
  }

  return "";
}

function renderViewerScoreBadge(x, centerY, label, options = {}) {
  if (!hasText(label)) {
    return "";
  }

  const width = options.width || Math.min(168, Math.max(58, label.length * 7 + 24));
  const height = options.height || 22;
  const textX = x + width / 2;
  const textY = centerY + 5;

  return `
    <g class="viewer-score-badge">
      <rect
        x="${x}"
        y="${centerY - height / 2}"
        rx="6"
        ry="6"
        width="${width}"
        height="${height}"
      />
      <text
        x="${textX}"
        y="${textY}"
        text-anchor="middle"
      >${escapeHtml(label)}</text>
    </g>
  `;
}

function renderOfficialViewerBracket(event, matches) {
  if (!matches.length) {
    return `<div class="viewer-empty">Draw not generated yet for this event.</div>`;
  }

  const groups = groupMatchesByRound(matches);
  const roundNumbers = Object.keys(groups)
    .map(Number)
    .sort((left, right) => left - right);
  const firstRoundMatches = groups[roundNumbers[0]] || [];

  if (!firstRoundMatches.length) {
    return `<div class="viewer-empty">No first-round slots are available for this event.</div>`;
  }

  const slotRowHeight = 44;
  const matchGap = 20;
  const topY = 126;
  const numberX = 62;
  const labelX = 112;
  const roundBoundaryStartX = 610;
  const roundStepX = 150;
  const joinStepX = 66;
  const textBaselineOffset = 22;
  const slotLineOffset = 30;
  const maxRounds = roundNumbers.length;
  const lastBoundaryX = roundBoundaryStartX + roundStepX * Math.max(0, maxRounds - 1);
  const championLineEndX = lastBoundaryX + 128;
  const svgWidth = championLineEndX + 180;
  const svgHeight = topY + firstRoundMatches.length * (slotRowHeight * 2 + matchGap) + 96;

  const firstRoundCenters = [];
  const firstRoundLines = [];
  const scoreBadges = [];

  firstRoundMatches.forEach((match, matchIndex) => {
    const pairTop = topY + matchIndex * (slotRowHeight * 2 + matchGap);
    const sideOneLineY = pairTop + slotLineOffset;
    const sideTwoLineY = pairTop + slotRowHeight + slotLineOffset;
    const pairCenter = (sideOneLineY + sideTwoLineY) / 2;

    firstRoundCenters.push(pairCenter);

    firstRoundLines.push(`
      <text x="${numberX}" y="${pairTop + textBaselineOffset}" text-anchor="end" class="viewer-draw-number">${matchIndex * 2 + 1})</text>
      <text x="${labelX}" y="${pairTop + textBaselineOffset}" class="viewer-draw-name">${escapeHtml(
        getBracketSideLabel(match, 1)
      )}</text>
      <line x1="${labelX - 4}" y1="${sideOneLineY}" x2="${roundBoundaryStartX}" y2="${sideOneLineY}" class="viewer-draw-line" />

      <text x="${numberX}" y="${pairTop + slotRowHeight + textBaselineOffset}" text-anchor="end" class="viewer-draw-number">${matchIndex * 2 + 2})</text>
      <text x="${labelX}" y="${pairTop + slotRowHeight + textBaselineOffset}" class="viewer-draw-name">${escapeHtml(
        getBracketSideLabel(match, 2)
      )}</text>
      <line x1="${labelX - 4}" y1="${sideTwoLineY}" x2="${roundBoundaryStartX}" y2="${sideTwoLineY}" class="viewer-draw-line" />
      <line x1="${roundBoundaryStartX}" y1="${sideOneLineY}" x2="${roundBoundaryStartX}" y2="${sideTwoLineY}" class="viewer-draw-line" />
    `);

    const firstRoundScore = getMatchScoreLabel(match);

    if (firstRoundScore) {
      const badgeWidth = Math.min(168, Math.max(58, firstRoundScore.length * 7 + 24));
      scoreBadges.push(
        renderViewerScoreBadge(roundBoundaryStartX - badgeWidth - 14, pairCenter, firstRoundScore, {
          width: badgeWidth
        })
      );
    }
  });

  const roundCenters = {
    0: firstRoundCenters
  };
  const connectorLines = [];
  const roundTexts = [];

  for (let roundIndex = 1; roundIndex < maxRounds; roundIndex += 1) {
    const previousCenters = roundCenters[roundIndex - 1];
    const boundaryX = roundBoundaryStartX + roundStepX * roundIndex;
    const joinX = boundaryX - joinStepX;
    const currentCenters = [];
    const currentRoundMatches = groups[roundNumbers[roundIndex]] || [];

    currentRoundMatches.forEach((match, matchIndex) => {
      const topChildCenter = previousCenters[matchIndex * 2];
      const bottomChildCenter = previousCenters[matchIndex * 2 + 1];
      const matchCenter = (topChildCenter + bottomChildCenter) / 2;

      currentCenters.push(matchCenter);

      connectorLines.push(`
        <line x1="${boundaryX - roundStepX}" y1="${topChildCenter}" x2="${joinX}" y2="${topChildCenter}" class="viewer-draw-line" />
        <line x1="${boundaryX - roundStepX}" y1="${bottomChildCenter}" x2="${joinX}" y2="${bottomChildCenter}" class="viewer-draw-line" />
        <line x1="${joinX}" y1="${topChildCenter}" x2="${joinX}" y2="${bottomChildCenter}" class="viewer-draw-line" />
        <line x1="${joinX}" y1="${matchCenter}" x2="${boundaryX}" y2="${matchCenter}" class="viewer-draw-line" />
      `);

      const sideOne = getBracketSideLabel(match, 1);
      const sideTwo = getBracketSideLabel(match, 2);

      if (hasText(sideOne)) {
        roundTexts.push(`
          <text x="${boundaryX - roundStepX + 10}" y="${topChildCenter - 8}" class="viewer-draw-advance">${escapeHtml(
            sideOne
          )}</text>
        `);
      }

      if (hasText(sideTwo)) {
        roundTexts.push(`
          <text x="${boundaryX - roundStepX + 10}" y="${bottomChildCenter - 8}" class="viewer-draw-advance">${escapeHtml(
            sideTwo
          )}</text>
        `);
      }

      const scoreLabel = getMatchScoreLabel(match);

      if (scoreLabel) {
        const badgeWidth = Math.min(168, Math.max(58, scoreLabel.length * 7 + 24));
        scoreBadges.push(
          renderViewerScoreBadge(boundaryX - badgeWidth - 14, matchCenter, scoreLabel, {
            width: badgeWidth
          })
        );
      }
    });

    roundCenters[roundIndex] = currentCenters;
  }

  const champion = getChampionForEvent(event.id);
  const championY = roundCenters[maxRounds - 1]?.[0] || topY;

  const championLine = `
    <line x1="${lastBoundaryX}" y1="${championY}" x2="${championLineEndX}" y2="${championY}" class="viewer-draw-line" />
    ${
      champion?.winner
        ? `<text x="${championLineEndX + 14}" y="${championY - 8}" class="viewer-draw-champion">${escapeHtml(
            champion.winner
          )}</text>`
        : ""
    }
  `;

  return `
    <div class="viewer-bracket-surface">
      <div class="viewer-bracket-scroll">
        <svg
          class="viewer-bracket-svg"
          viewBox="0 0 ${svgWidth} ${svgHeight}"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label="${escapeHtml(event.event_name)} bracket"
        >
          ${firstRoundLines.join("")}
          ${roundTexts.join("")}
          ${connectorLines.join("")}
          ${scoreBadges.join("")}
          ${championLine}
        </svg>
      </div>
    </div>
  `;
}

function renderHero() {
  const tournament = getTournament();

  if (!tournament) {
    return "";
  }

  const locationLine = [tournament.venue_name, tournament.city, tournament.country]
    .filter(hasText)
    .join(", ");

  return `
    <section class="viewer-hero">
      <div>
        <p class="viewer-kicker">AlphaGrips Tournament Viewer</p>
        <h1>${escapeHtml(tournament.tournament_name)}</h1>
        <p class="viewer-copy">
          Live draws, court board, and results for players, coaches, and spectators.
        </p>
        <p class="viewer-meta">
          ${escapeHtml(formatDate(tournament.start_date))} - ${escapeHtml(formatDate(tournament.end_date))}
          ${locationLine ? ` • ${escapeHtml(locationLine)}` : ""}
        </p>
      </div>
      <div class="viewer-hero-actions">
        <span class="status-pill status-${statusTone(tournament.status)}">${escapeHtml(
          tournament.status || "active"
        )}</span>
        ${
          hasText(tournament.tournament_code)
            ? `<span class="viewer-code">Code: ${escapeHtml(tournament.tournament_code)}</span>`
            : ""
        }
      </div>
    </section>
  `;
}

function renderStats() {
  const matches = state.matches || [];
  const totals = matches.reduce(
    (summary, match) => {
      summary[match.status] = (summary[match.status] || 0) + 1;
      return summary;
    },
    {
      pending: 0,
      scheduled: 0,
      in_progress: 0,
      completed: 0
    }
  );

  return `
    <section class="viewer-stats">
      <article class="viewer-stat-card">
        <span>Events</span>
        <strong>${getEvents().length}</strong>
      </article>
      <article class="viewer-stat-card">
        <span>Scheduled</span>
        <strong>${totals.scheduled}</strong>
      </article>
      <article class="viewer-stat-card">
        <span>Live</span>
        <strong>${totals.in_progress}</strong>
      </article>
      <article class="viewer-stat-card">
        <span>Completed</span>
        <strong>${totals.completed}</strong>
      </article>
    </section>
  `;
}

function renderEventTabs() {
  const events = getEvents();

  if (!events.length) {
    return "";
  }

  return `
    <section class="viewer-toolbar">
      <div class="viewer-chip-row">
        ${events
          .map(
            (event) => `
              <button
                class="viewer-chip ${getSelectedEventId() === event.id ? "active" : ""}"
                data-action="select-event"
                data-event-id="${event.id}"
                type="button"
              >
                ${escapeHtml(event.event_name)}
              </button>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderBracketSection() {
  const event = getSelectedEvent();

  if (!event) {
    return `
      <section class="viewer-panel">
        <div class="viewer-panel-head">
          <div>
            <p class="viewer-kicker">Draws</p>
            <h2>No event selected</h2>
          </div>
        </div>
      </section>
    `;
  }

  const matches = getMatchesForEvent(event.id);
  const groups = groupMatchesByRound(matches);
  const roundNumbers = Object.keys(groups)
    .map(Number)
    .sort((left, right) => left - right);
  const champion = getChampionForEvent(event.id);

  return `
    <section class="viewer-panel">
      <div class="viewer-panel-head">
        <div>
          <p class="viewer-kicker">Draws</p>
          <h2>${escapeHtml(event.event_name)} draw</h2>
        </div>
        <div class="viewer-panel-actions">
          <a
            class="viewer-link-btn"
            href="${escapeHtml(getPublicDrawSheetUrl(event.id))}"
            target="_blank"
            rel="noopener"
          >
            Open Draw Sheet
          </a>
          ${
            champion
              ? `
                  <div class="viewer-outcome">
                    <span>Winner: ${escapeHtml(champion.winner)}</span>
                    <span>Runner-up: ${escapeHtml(champion.runnerUp)}</span>
                    <span>${escapeHtml(champion.result)}</span>
                  </div>
                `
              : `<span class="viewer-note">Final not decided yet</span>`
          }
        </div>
      </div>
      ${
        roundNumbers.length
          ? `
              <div class="viewer-bracket">
                ${roundNumbers
                  .map(
                    (roundNumber) => `
                      <section class="viewer-round">
                        <h3>${escapeHtml(
                          groups[roundNumber][0]?.round_name || `Round ${roundNumber}`
                        )}</h3>
                        <div class="viewer-round-stack">
                          ${groups[roundNumber]
                            .map(
                              (match) => `
                                <article class="viewer-match-card">
                                  <div class="viewer-match-top">
                                    <strong>Match #${escapeHtml(String(match.match_number))}</strong>
                                    <span class="status-pill status-${statusTone(match.status)}">${escapeHtml(
                                      match.status
                                    )}</span>
                                  </div>
                                  <div class="viewer-side ${
                                    match.winner_name === getSideName(match, 1) ? "is-winner" : ""
                                  }">${escapeHtml(getSideName(match, 1))}</div>
                                  <div class="viewer-side ${
                                    match.winner_name === getSideName(match, 2) ? "is-winner" : ""
                                  }">${escapeHtml(getSideName(match, 2))}</div>
                                  <div class="viewer-match-meta">
                                    <span>${escapeHtml(match.score_summary || match.result_type || "-")}</span>
                                    <span>${escapeHtml(match.court_name || "Court pending")}</span>
                                  </div>
                                </article>
                              `
                            )
                            .join("")}
                        </div>
                      </section>
                    `
                  )
                  .join("")}
              </div>
            `
          : `<div class="viewer-empty">Draw not generated yet for this event.</div>`
      }
    </section>
  `;
}

function renderCourtBoard() {
  const activeMatches = (state.matches || []).filter((match) =>
    ["scheduled", "in_progress"].includes(match.status)
  );

  return `
    <section class="viewer-panel">
      <div class="viewer-panel-head">
        <div>
          <p class="viewer-kicker">Courts</p>
          <h2>Live court board</h2>
        </div>
      </div>
      ${
        activeMatches.length
          ? `
              <div class="viewer-board">
                ${activeMatches
                  .map(
                    (match) => `
                      <article class="viewer-board-card">
                        <div class="viewer-board-top">
                          <strong>${escapeHtml(match.court_name || "Court pending")}</strong>
                          <span class="status-pill status-${statusTone(match.status)}">${escapeHtml(
                            match.status
                          )}</span>
                        </div>
                        <h3>${escapeHtml(match.event_name || "Event")}</h3>
                        <p>${escapeHtml(getSideName(match, 1))} vs ${escapeHtml(getSideName(match, 2))}</p>
                        <span>${escapeHtml(formatDateTime(match.scheduled_at))}</span>
                      </article>
                    `
                  )
                  .join("")}
              </div>
            `
          : `<div class="viewer-empty">No matches are currently assigned to courts.</div>`
      }
    </section>
  `;
}

function renderResults() {
  const events = getEvents();
  const completedMatches = (state.matches || []).filter((match) => match.status === "completed");

  return `
    <section class="viewer-panel">
      <div class="viewer-panel-head">
        <div>
          <p class="viewer-kicker">Results</p>
          <h2>Champions and completed matches</h2>
        </div>
      </div>
      <div class="viewer-results-grid">
        ${events
          .map((event) => {
            const champion = getChampionForEvent(event.id);

            return `
              <article class="viewer-result-card">
                <p class="viewer-kicker">${escapeHtml(event.format)}</p>
                <h3>${escapeHtml(event.event_name)}</h3>
                ${
                  champion
                    ? `
                        <strong>${escapeHtml(champion.winner)}</strong>
                        <span>Runner-up: ${escapeHtml(champion.runnerUp)}</span>
                        <span>${escapeHtml(champion.result)}</span>
                      `
                    : `<span>Champion not decided yet</span>`
                }
              </article>
            `;
          })
          .join("")}
      </div>
      ${
        completedMatches.length
          ? `
              <div class="viewer-table-wrap">
                <table class="viewer-table">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Round</th>
                      <th>Match</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${completedMatches
                      .slice()
                      .sort((left, right) => {
                        const leftTime = new Date(left.completed_at || 0).getTime();
                        const rightTime = new Date(right.completed_at || 0).getTime();
                        return rightTime - leftTime;
                      })
                      .slice(0, 12)
                      .map(
                        (match) => `
                          <tr>
                            <td>${escapeHtml(match.event_name || "-")}</td>
                            <td>${escapeHtml(match.round_name || `Round ${match.round_number}`)}</td>
                            <td>${escapeHtml(getSideName(match, 1))} vs ${escapeHtml(
                              getSideName(match, 2)
                            )}</td>
                            <td>${escapeHtml(match.score_summary || match.result_type || "-")}</td>
                          </tr>
                        `
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>
            `
          : ""
      }
    </section>
  `;
}

function renderEmptyState() {
  getApp().innerHTML = `
    <section class="viewer-shell">
      <div class="viewer-empty hero">
        <p class="viewer-kicker">Tournament Viewer</p>
        <h1>Open a tournament link to continue</h1>
        <p>Add <code>?tournament=&lt;code-or-id&gt;</code> to the URL to load a tournament viewer page.</p>
      </div>
    </section>
  `;
}

function renderError() {
  getApp().innerHTML = `
    <section class="viewer-shell">
      <div class="viewer-empty hero">
        <p class="viewer-kicker">Tournament Viewer</p>
        <h1>Unable to load tournament</h1>
        <p>${escapeHtml(state.error || "Something went wrong.")}</p>
      </div>
    </section>
  `;
}

function renderLoading() {
  getApp().innerHTML = `
    <section class="viewer-shell">
      <div class="viewer-empty hero">
        <p class="viewer-kicker">Tournament Viewer</p>
        <h1>Loading tournament...</h1>
      </div>
    </section>
  `;
}

function renderViewer() {
  const tournament = getTournament();

  if (!tournament) {
    renderEmptyState();
    return;
  }

  getApp().innerHTML = `
    <section class="viewer-shell">
      ${renderHero()}
      ${renderStats()}
      ${renderEventTabs()}
      ${renderBracketSection()}
      ${renderCourtBoard()}
      ${renderResults()}
    </section>
  `;

  document.querySelectorAll('[data-action="select-event"]').forEach((button) => {
    button.addEventListener("click", () => {
      state.activeEventId = button.dataset.eventId || "";
      rememberViewerContext(state.activeEventId);
      renderViewer();
    });
  });
}

async function init() {
  if (!hasText(state.tournamentLookup)) {
    window.location.replace(TOURNAMENT_HUB_URL);
    return;
  }

  state.loading = true;
  renderLoading();

  try {
    const [overview, matches] = await Promise.all([
      publicTournamentApi.getOverview(state.tournamentLookup),
      publicTournamentApi.listMatches(state.tournamentLookup)
    ]);

    state.overview = overview;
    state.matches = matches || [];
    state.activeEventId = overview?.events?.[0]?.id || "";
    state.error = "";
    rememberViewerContext(state.activeEventId);
    renderViewer();
  } catch (error) {
    state.error = error.message;
    renderError();
  } finally {
    state.loading = false;
  }
}

init();
