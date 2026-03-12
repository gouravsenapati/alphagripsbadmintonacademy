import { publicTournamentApi } from "./services/publicTournamentApi.js";

function getApp() {
  return document.getElementById("drawSheetApp");
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

function formatLongDate(value) {
  if (!value) {
    return "";
  }

  return new Date(value).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

function formatDateRange(startDate, endDate) {
  if (!startDate && !endDate) {
    return "";
  }

  if (startDate && endDate) {
    return `${formatLongDate(startDate)} - ${formatLongDate(endDate)}`;
  }

  return formatLongDate(startDate || endDate);
}

function getQueryParams() {
  const params = new URLSearchParams(window.location.search);
  const storedTournamentLookup =
    (typeof localStorage !== "undefined" &&
      (localStorage.getItem("ag_public_tournament_lookup") ||
        localStorage.getItem("ag_selected_tournament_id"))) ||
    "";
  const storedEventId =
    (typeof localStorage !== "undefined" && localStorage.getItem("ag_public_draw_event_id")) || "";

  return {
    tournamentLookup:
      params.get("tournament") || params.get("tournamentId") || storedTournamentLookup || "",
    eventId: params.get("eventId") || storedEventId || ""
  };
}

function updateQuery(params) {
  const url = new URL(window.location.href);

  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      url.searchParams.set(key, value);
    } else {
      url.searchParams.delete(key);
    }
  });

  window.history.replaceState({}, "", url);

  if (typeof localStorage !== "undefined") {
    if (params.tournament) {
      localStorage.setItem("ag_public_tournament_lookup", params.tournament);
    }

    if (params.eventId) {
      localStorage.setItem("ag_public_draw_event_id", params.eventId);
    }
  }
}

function groupMatchesByRound(matches) {
  const groups = matches.reduce((accumulator, match) => {
    const key = Number(match.round_number);

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

function getSideLabel(match, sideNumber) {
  const explicitName = match[`participant${sideNumber}_name`] || "";

  if (hasText(explicitName) && explicitName !== "-") {
    return explicitName;
  }

  const oppositeName = match[`participant${sideNumber === 1 ? 2 : 1}_name`] || "";

  if (!hasText(explicitName) && hasText(oppositeName) && match.result_type === "bye") {
    return "Bye";
  }

  if (!hasText(explicitName) && hasText(oppositeName) && sideNumber === 2) {
    return "Bye";
  }

  return "";
}

function getFinalOutcome(matches) {
  if (!matches.length) {
    return null;
  }

  const groups = groupMatchesByRound(matches);
  const roundNumbers = Object.keys(groups)
    .map(Number)
    .sort((left, right) => left - right);
  const finalMatch = (groups[roundNumbers[roundNumbers.length - 1]] || [])[0];

  if (!finalMatch || finalMatch.status !== "completed" || !hasText(finalMatch.winner_name)) {
    return null;
  }

  const winnerOnSideOne = finalMatch.winner_name === getSideLabel(finalMatch, 1);

  return {
    winnerName: winnerOnSideOne ? getSideLabel(finalMatch, 1) : getSideLabel(finalMatch, 2),
    runnerUpName: winnerOnSideOne ? getSideLabel(finalMatch, 2) : getSideLabel(finalMatch, 1),
    scoreSummary:
      finalMatch.score_summary || finalMatch.result_type || finalMatch.round_name || ""
  };
}

function getTournamentHeading(event) {
  return event?.event_name || [event?.category_name, event?.age_group].filter(hasText).join(" • ");
}

function buildSvgText(value) {
  return escapeHtml(value || "");
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

function renderScoreBadge(x, centerY, label, options = {}) {
  if (!hasText(label)) {
    return "";
  }

  const width = options.width || Math.min(168, Math.max(58, label.length * 7 + 24));
  const height = options.height || 22;
  const textX = x + width / 2;
  const textY = centerY + 5;

  return `
    <g class="score-badge">
      <rect
        x="${x}"
        y="${centerY - height / 2}"
        rx="6"
        ry="6"
        width="${width}"
        height="${height}"
        fill="#ffffff"
        stroke="#171717"
        stroke-width="1.4"
      />
      <text
        x="${textX}"
        y="${textY}"
        text-anchor="middle"
        font-size="11"
        font-weight="700"
      >${buildSvgText(label)}</text>
    </g>
  `;
}

function renderOfficialBracketSvg(event, matches) {
  if (!matches.length) {
    return `
      <div class="sheet-empty">
        <p>No draw is generated for this event yet.</p>
      </div>
    `;
  }

  const groups = groupMatchesByRound(matches);
  const roundNumbers = Object.keys(groups)
    .map(Number)
    .sort((left, right) => left - right);
  const firstRoundMatches = groups[roundNumbers[0]] || [];

  if (!firstRoundMatches.length) {
    return `
      <div class="sheet-empty">
        <p>No first-round slots are available for this event.</p>
      </div>
    `;
  }

  const slotRowHeight = 44;
  const matchGap = 20;
  const topY = 170;
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
  const svgHeight = topY + firstRoundMatches.length * (slotRowHeight * 2 + matchGap) + 120;

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
      <text x="${numberX}" y="${pairTop + textBaselineOffset}" text-anchor="end" font-size="18" font-weight="700">${matchIndex * 2 + 1})</text>
      <text x="${labelX}" y="${pairTop + textBaselineOffset}" font-size="17">${buildSvgText(
        getSideLabel(match, 1)
      )}</text>
      <line x1="${labelX - 4}" y1="${sideOneLineY}" x2="${roundBoundaryStartX}" y2="${sideOneLineY}" stroke="#171717" stroke-width="2.3" />

      <text x="${numberX}" y="${pairTop + slotRowHeight + textBaselineOffset}" text-anchor="end" font-size="18" font-weight="700">${matchIndex * 2 + 2})</text>
      <text x="${labelX}" y="${pairTop + slotRowHeight + textBaselineOffset}" font-size="17">${buildSvgText(
        getSideLabel(match, 2)
      )}</text>
      <line x1="${labelX - 4}" y1="${sideTwoLineY}" x2="${roundBoundaryStartX}" y2="${sideTwoLineY}" stroke="#171717" stroke-width="2.3" />
      <line x1="${roundBoundaryStartX}" y1="${sideOneLineY}" x2="${roundBoundaryStartX}" y2="${sideTwoLineY}" stroke="#171717" stroke-width="2.3" />
    `);

    const firstRoundScore = getMatchScoreLabel(match);

    if (firstRoundScore) {
      const badgeWidth = Math.min(168, Math.max(58, firstRoundScore.length * 7 + 24));
      scoreBadges.push(
        renderScoreBadge(roundBoundaryStartX - badgeWidth - 14, pairCenter, firstRoundScore, {
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
        <line x1="${boundaryX - roundStepX}" y1="${topChildCenter}" x2="${joinX}" y2="${topChildCenter}" stroke="#171717" stroke-width="2.3" />
        <line x1="${boundaryX - roundStepX}" y1="${bottomChildCenter}" x2="${joinX}" y2="${bottomChildCenter}" stroke="#171717" stroke-width="2.3" />
        <line x1="${joinX}" y1="${topChildCenter}" x2="${joinX}" y2="${bottomChildCenter}" stroke="#171717" stroke-width="2.3" />
        <line x1="${joinX}" y1="${matchCenter}" x2="${boundaryX}" y2="${matchCenter}" stroke="#171717" stroke-width="2.3" />
      `);

      const sideOne = getSideLabel(match, 1);
      const sideTwo = getSideLabel(match, 2);

      if (hasText(sideOne)) {
        roundTexts.push(`
          <text x="${boundaryX - roundStepX + 10}" y="${topChildCenter - 8}" font-size="14">${buildSvgText(
            sideOne
          )}</text>
        `);
      }

      if (hasText(sideTwo)) {
        roundTexts.push(`
          <text x="${boundaryX - roundStepX + 10}" y="${bottomChildCenter - 8}" font-size="14">${buildSvgText(
            sideTwo
          )}</text>
        `);
      }

      const scoreLabel = getMatchScoreLabel(match);

      if (scoreLabel) {
        const badgeWidth = Math.min(168, Math.max(58, scoreLabel.length * 7 + 24));
        scoreBadges.push(
          renderScoreBadge(boundaryX - badgeWidth - 14, matchCenter, scoreLabel, {
            width: badgeWidth
          })
        );
      }
    });

    roundCenters[roundIndex] = currentCenters;
  }

  const finalOutcome = getFinalOutcome(matches);
  const championY = roundCenters[maxRounds - 1]?.[0] || topY;
  const championName = finalOutcome?.winnerName || "";

  const championLine = `
    <line x1="${lastBoundaryX}" y1="${championY}" x2="${championLineEndX}" y2="${championY}" stroke="#171717" stroke-width="2.3" />
    ${
      hasText(championName)
        ? `<text x="${championLineEndX + 14}" y="${championY - 8}" font-size="18" font-weight="700">${buildSvgText(
            championName
          )}</text>`
        : ""
    }
  `;

  return `
    <div class="sheet-svg-wrap">
      <svg
        class="sheet-svg"
        viewBox="0 0 ${svgWidth} ${svgHeight}"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="${escapeHtml(event.event_name)} draw sheet"
      >
        ${firstRoundLines.join("")}
        ${roundTexts.join("")}
        ${connectorLines.join("")}
        ${scoreBadges.join("")}
        ${championLine}
      </svg>
    </div>
  `;
}

function getViewerUrl(tournamentLookup) {
  const url = new URL("/Public/tournament/viewer.html", window.location.origin);
  url.searchParams.set("tournament", tournamentLookup);
  return url.toString();
}

function renderToolbar(state) {
  return `
    <section class="sheet-toolbar">
      <div class="sheet-toolbar-group">
        <div>
          <strong>AlphaGrips Draw Sheet</strong>
          <small>Official knockout view for players, coaches, and spectators</small>
        </div>
        ${
          state.events.length
            ? `
              <select class="sheet-select" id="drawSheetEventSelect">
                ${state.events
                  .map(
                    (event) => `
                      <option value="${event.id}" ${state.event?.id === event.id ? "selected" : ""}>
                        ${escapeHtml(event.event_name)}
                      </option>
                    `
                  )
                  .join("")}
              </select>
            `
            : ""
        }
      </div>
      <div class="sheet-toolbar-group">
        <a class="sheet-btn" href="${escapeHtml(getViewerUrl(state.tournamentLookup))}">Back to Viewer</a>
        <button class="sheet-btn primary" id="printDrawSheet" type="button">Print Sheet</button>
      </div>
    </section>
  `;
}

function renderOutcomeSummary(matches) {
  const finalOutcome = getFinalOutcome(matches);

  if (!finalOutcome) {
    return "";
  }

  return `
    <section class="sheet-outcome">
      <div class="sheet-outcome-item">
        <span>Winner</span>
        <strong>${escapeHtml(finalOutcome.winnerName || "-")}</strong>
      </div>
      <div class="sheet-outcome-item">
        <span>Runner-up</span>
        <strong>${escapeHtml(finalOutcome.runnerUpName || "-")}</strong>
      </div>
      <div class="sheet-outcome-item">
        <span>Result</span>
        <strong>${escapeHtml(finalOutcome.scoreSummary || "-")}</strong>
      </div>
    </section>
  `;
}

function renderSheet(state) {
  const tournament = state.overview?.tournament || {};
  const locationLine = [tournament.venue_name, tournament.city, tournament.country]
    .filter(hasText)
    .join(", ");

  return `
    ${renderToolbar(state)}
    <section class="sheet-paper">
      <header class="sheet-header">
        <h1>${escapeHtml(tournament.tournament_name || "Tournament")}</h1>
        <p>${escapeHtml(formatDateRange(tournament.start_date, tournament.end_date) || "Dates pending")}</p>
        <h2>${escapeHtml(getTournamentHeading(state.event) || state.event?.event_name || "Draw Sheet")}</h2>
        <div class="sheet-meta">
          ${locationLine ? `<span>${escapeHtml(locationLine)}</span>` : ""}
          ${state.event?.format ? `<span>${escapeHtml(state.event.format)}</span>` : ""}
          ${state.event?.draw_size ? `<span>Draw ${escapeHtml(String(state.event.draw_size))}</span>` : ""}
        </div>
        ${renderOutcomeSummary(state.matches)}
      </header>

      ${renderOfficialBracketSvg(state.event, state.matches)}

      <footer class="sheet-footer">
        <div>
          <strong>Referee</strong>
          <div class="referee-line"></div>
        </div>
        <div class="sheet-note">
          <p>Generated from the AlphaGrips tournament engine.</p>
          <p>Open this page again anytime to print the latest public draw state.</p>
        </div>
      </footer>
    </section>
  `;
}

function renderLoading() {
  getApp().innerHTML = `
    <section class="sheet-loading">
      <p>Loading draw sheet...</p>
    </section>
  `;
}

function renderError(message) {
  getApp().innerHTML = `
    <section class="sheet-empty">
      <p>${escapeHtml(message)}</p>
    </section>
  `;
}

async function bootstrap() {
  const { tournamentLookup, eventId } = getQueryParams();

  if (!tournamentLookup) {
    renderError("Open this page from the tournament viewer or add ?tournament=<code-or-id> to the URL.");
    return;
  }

  renderLoading();

  try {
    const [overview, matches] = await Promise.all([
      publicTournamentApi.getOverview(tournamentLookup),
      publicTournamentApi.listMatches(tournamentLookup)
    ]);

    const events = overview.events || [];
    const event = events.find((entry) => entry.id === eventId) || events[0] || null;

    if (!event) {
      renderError("No events are available for this tournament yet.");
      return;
    }

    const eventMatches = (matches || []).filter((match) => match.event_id === event.id);
    updateQuery({
      tournament: tournamentLookup,
      eventId: event.id
    });

    getApp().innerHTML = renderSheet({
      overview,
      tournamentLookup,
      event,
      events,
      matches: eventMatches
    });

    const printButton = document.getElementById("printDrawSheet");
    const eventSelect = document.getElementById("drawSheetEventSelect");

    if (printButton) {
      printButton.onclick = () => window.print();
    }

    if (eventSelect) {
      eventSelect.onchange = () => {
        updateQuery({
          tournament: tournamentLookup,
          eventId: eventSelect.value
        });
        bootstrap();
      };
    }

    document.title = `${event.event_name || "Draw Sheet"} | AlphaGrips`;
  } catch (error) {
    renderError(error.message || "Failed to load the draw sheet.");
  }
}

bootstrap();
