import express from "express";
import supabase from "../../config/db.js";
import { auth } from "../../middleware/auth.middleware.js";
import { applyAcademyFilter } from "../../middleware/academyFilter.js";

const router = express.Router();

const ACADEMY_MATCH_RESULTS_TABLE = "academy_match_results";
const ALLOWED_RESULT_TYPES = new Map([
  ["normal", "normal"],
  ["walkover", "walkover"],
  ["ab", "ab"]
]);

function normalizeText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text ? text : null;
}

function normalizeInteger(value, fieldName, { required = false } = {}) {
  if (value === null || value === undefined || value === "") {
    if (required) {
      throw new Error(`${fieldName} is required`);
    }

    return null;
  }

  const numericValue = Number(value);

  if (!Number.isInteger(numericValue) || numericValue <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }

  return numericValue;
}

function normalizeDate(value, fieldName, { required = false } = {}) {
  const normalizedValue = normalizeText(value);

  if (!normalizedValue) {
    if (required) {
      throw new Error(`${fieldName} is required`);
    }

    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    throw new Error(`${fieldName} must be in YYYY-MM-DD format`);
  }

  return normalizedValue;
}

function normalizeResultType(value) {
  const normalized = normalizeText(value) || "normal";
  const resolved = ALLOWED_RESULT_TYPES.get(normalized.toLowerCase());

  if (!resolved) {
    const error = new Error("result_type is invalid");
    error.statusCode = 400;
    throw error;
  }

  return resolved;
}

function buildMissingTableError() {
  const error = new Error(
    "Academy match matrix table is not available yet. Run Backend/sql/20260309_public_academy_match_matrix.sql in Supabase first."
  );
  error.statusCode = 500;
  return error;
}

function handleMatchMatrixError(error, res) {
  if (
    /relation .*academy_match_results.* does not exist/i.test(error.message || "") ||
    /could not find the table 'public\.academy_match_results'/i.test(error.message || "")
  ) {
    return res.status(500).json({ error: buildMissingTableError().message });
  }

  return res.status(error.statusCode || 500).json({ error: error.message });
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function reverseScoreRaw(scoreRaw) {
  const normalized = normalizeText(scoreRaw);

  if (!normalized) {
    return null;
  }

  return normalized
    .split(",")
    .map((segment) => {
      const trimmed = segment.trim();
      const match = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);

      if (!match) {
        return trimmed;
      }

      return `${match[2]}-${match[1]}`;
    })
    .join(", ");
}

function canonicalizePair({ player1Id, player2Id, scoreRaw }) {
  if (player1Id === player2Id) {
    const error = new Error("Players must be different");
    error.statusCode = 400;
    throw error;
  }

  if (player1Id < player2Id) {
    return {
      player1Id,
      player2Id,
      scoreRaw
    };
  }

  return {
    player1Id: player2Id,
    player2Id: player1Id,
    scoreRaw: reverseScoreRaw(scoreRaw)
  };
}

async function listScopedCategories(req) {
  let query = supabase
    .from("categories")
    .select("id,name")
    .order("name", { ascending: true });
  query = applyAcademyFilter(query, req);

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data || [];
}

async function listScopedPlayersByCategory(categoryId, req) {
  if (!categoryId) {
    return [];
  }

  let query = supabase
    .from("players")
    .select("id,name,category_id,status")
    .eq("category_id", categoryId)
    .eq("status", "active")
    .order("name", { ascending: true });
  query = applyAcademyFilter(query, req);

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data || [];
}

async function listScopedPlayersByIds(playerIds, req) {
  if (!playerIds.length) {
    return [];
  }

  let query = supabase
    .from("players")
    .select("id,name,category_id,status")
    .in("id", playerIds);
  query = applyAcademyFilter(query, req);

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data || [];
}

async function listAvailableDates(categoryId, req) {
  if (!categoryId) {
    return [];
  }

  let query = supabase
    .from(ACADEMY_MATCH_RESULTS_TABLE)
    .select("match_date")
    .eq("category_id", categoryId)
    .order("match_date", { ascending: false });
  query = applyAcademyFilter(query, req);

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return [...new Set((data || []).map((row) => row.match_date).filter(Boolean))];
}

async function listResults(categoryId, matchDate, req) {
  if (!categoryId || !matchDate) {
    return [];
  }

  let query = supabase
    .from(ACADEMY_MATCH_RESULTS_TABLE)
    .select("*")
    .eq("category_id", categoryId)
    .eq("match_date", matchDate)
    .order("player1_id", { ascending: true })
    .order("player2_id", { ascending: true });
  query = applyAcademyFilter(query, req);

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data || [];
}

async function listAllResultsForCategory(categoryId, req) {
  if (!categoryId) {
    return [];
  }

  let query = supabase
    .from(ACADEMY_MATCH_RESULTS_TABLE)
    .select("*")
    .eq("category_id", categoryId)
    .order("match_date", { ascending: false })
    .order("player1_id", { ascending: true })
    .order("player2_id", { ascending: true });
  query = applyAcademyFilter(query, req);

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data || [];
}

function parseScoreRaw(scoreRaw) {
  const normalized = normalizeText(scoreRaw);

  if (!normalized) {
    return [];
  }

  return normalized
    .split(",")
    .map((segment) => {
      const trimmed = segment.trim();
      const match = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);

      if (!match) {
        return null;
      }

      return {
        player1Points: Number(match[1]),
        player2Points: Number(match[2])
      };
    })
    .filter(Boolean);
}

function buildStreakMap(results) {
  const streaks = new Map();
  const sorted = [...results]
    .filter((result) => String(result.result_type || "normal").toLowerCase() === "normal")
    .sort((a, b) => {
      if (a.match_date === b.match_date) {
        return Number(b.id) - Number(a.id);
      }
      return String(b.match_date || "").localeCompare(String(a.match_date || ""));
    });

  for (const result of sorted) {
    const player1Id = String(result.player1_id);
    const player2Id = String(result.player2_id);
    const winnerId = String(result.winner_id || "");

    if (!streaks.has(player1Id)) streaks.set(player1Id, []);
    if (!streaks.has(player2Id)) streaks.set(player2Id, []);

    const player1Streak = streaks.get(player1Id);
    const player2Streak = streaks.get(player2Id);

    if (player1Streak.length < 5) {
      player1Streak.push(winnerId === player1Id ? "W" : "L");
    }
    if (player2Streak.length < 5) {
      player2Streak.push(winnerId === player2Id ? "W" : "L");
    }
  }

  return streaks;
}

function buildStandingsSummary({ categories, selectedCategoryId, players, results }) {
  const expectedMatches = players.length > 1 ? (players.length * (players.length - 1)) / 2 : 0;
  const completedMatches = results.length;
  const remainingMatches = Math.max(expectedMatches - completedMatches, 0);
  const isComplete = expectedMatches > 0 && completedMatches >= expectedMatches;

  const standingMap = new Map(
    players.map((player) => [
      String(player.id),
      {
        player_id: player.id,
        player_name: player.name,
        matches_played: 0,
        wins: 0,
        losses: 0,
        sets_won: 0,
        sets_lost: 0,
        set_difference: 0,
        points_scored: 0,
        points_allowed: 0,
        point_difference: 0
      }
    ])
  );

  results.forEach((result) => {
    const player1Standing = standingMap.get(String(result.player1_id));
    const player2Standing = standingMap.get(String(result.player2_id));

    if (!player1Standing || !player2Standing) {
      return;
    }

    player1Standing.matches_played += 1;
    player2Standing.matches_played += 1;

    if (Number(result.winner_id) === Number(result.player1_id)) {
      player1Standing.wins += 1;
      player2Standing.losses += 1;
    } else if (Number(result.winner_id) === Number(result.player2_id)) {
      player2Standing.wins += 1;
      player1Standing.losses += 1;
    }

    if (String(result.result_type || "normal").toLowerCase() !== "normal") {
      return;
    }

    parseScoreRaw(result.score_raw).forEach((segment) => {
      player1Standing.points_scored += segment.player1Points;
      player1Standing.points_allowed += segment.player2Points;
      player2Standing.points_scored += segment.player2Points;
      player2Standing.points_allowed += segment.player1Points;

      if (segment.player1Points > segment.player2Points) {
        player1Standing.sets_won += 1;
        player2Standing.sets_lost += 1;
      } else if (segment.player2Points > segment.player1Points) {
        player2Standing.sets_won += 1;
        player1Standing.sets_lost += 1;
      }
    });
  });

  const standings = Array.from(standingMap.values())
    .map((standing) => ({
      ...standing,
      set_difference: standing.sets_won - standing.sets_lost,
      point_difference: standing.points_scored - standing.points_allowed
    }))
    .sort((left, right) => {
      if (right.wins !== left.wins) {
        return right.wins - left.wins;
      }

      if (right.set_difference !== left.set_difference) {
        return right.set_difference - left.set_difference;
      }

      if (right.point_difference !== left.point_difference) {
        return right.point_difference - left.point_difference;
      }

      if (right.points_scored !== left.points_scored) {
        return right.points_scored - left.points_scored;
      }

      return String(left.player_name || "").localeCompare(String(right.player_name || ""));
    })
    .map((standing, index) => ({
      ...standing,
      rank: index + 1
    }));

  const selectedCategoryIndex = categories.findIndex(
    (category) => String(category.id) === String(selectedCategoryId || "")
  );
  const moveUpTarget = selectedCategoryIndex > 0 ? categories[selectedCategoryIndex - 1] : null;
  const moveDownTarget =
    selectedCategoryIndex >= 0 && selectedCategoryIndex < categories.length - 1
      ? categories[selectedCategoryIndex + 1]
      : null;

  const standingsWithRecommendations = standings.map((standing, index) => {
    let recommendation = "Stay";

    if (isComplete && index === 0 && moveUpTarget) {
      recommendation = `Move Up to ${moveUpTarget.name}`;
    } else if (isComplete && index === standings.length - 1 && moveDownTarget) {
      recommendation = `Move Down to ${moveDownTarget.name}`;
    } else if (isComplete && index === 0 && !moveUpTarget) {
      recommendation = "Top Group";
    } else if (isComplete && index === standings.length - 1 && !moveDownTarget) {
      recommendation = "Bottom Group";
    }

    return {
      ...standing,
      recommendation
    };
  });

  return {
    expected_matches: expectedMatches,
    completed_matches: completedMatches,
    remaining_matches: remainingMatches,
    is_complete: isComplete,
    tie_break_rule: "Wins, set difference, point difference, then total points scored",
    standings: standingsWithRecommendations
  };
}

async function getScopedResult(resultId, req) {
  let query = supabase.from(ACADEMY_MATCH_RESULTS_TABLE).select("*").eq("id", resultId);
  query = applyAcademyFilter(query, req);

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

router.get("/", auth, async (req, res) => {
  try {
    const categories = await listScopedCategories(req);
    const selectedCategoryId =
      normalizeInteger(req.query.category_id, "category_id") ||
      normalizeInteger(categories[0]?.id, "category_id");
    const selectedMatchDate = normalizeDate(
      req.query.match_date || getToday(),
      "match_date",
      { required: true }
    );

    const [players, availableDates, results] = await Promise.all([
      listScopedPlayersByCategory(selectedCategoryId, req),
      listAvailableDates(selectedCategoryId, req),
      listResults(selectedCategoryId, selectedMatchDate, req)
    ]);
    const summary = buildStandingsSummary({
      categories,
      selectedCategoryId,
      players,
      results
    });

    res.json({
      categories,
      selected_category_id: selectedCategoryId,
      selected_match_date: selectedMatchDate,
      available_dates: availableDates,
      players,
      results,
      summary
    });
  } catch (error) {
    handleMatchMatrixError(error, res);
  }
});

router.get("/player-log", auth, async (req, res) => {
  try {
    const categories = await listScopedCategories(req);
    const selectedCategoryId =
      normalizeInteger(req.query.category_id, "category_id") ||
      normalizeInteger(categories[0]?.id, "category_id");

    const players = await listScopedPlayersByCategory(selectedCategoryId, req);
    const selectedPlayerId =
      normalizeInteger(req.query.player_id, "player_id") ||
      normalizeInteger(players[0]?.id, "player_id");

    const allResults = await listAllResultsForCategory(selectedCategoryId, req);
    const filteredResults = selectedPlayerId
      ? allResults.filter(
          (result) =>
            Number(result.player1_id) === selectedPlayerId ||
            Number(result.player2_id) === selectedPlayerId
        )
      : [];

    const playerIds = [...new Set(
      filteredResults.flatMap((result) => [result.player1_id, result.player2_id]).filter(Boolean)
    )];
    const scopedPlayers = await listScopedPlayersByIds(playerIds, req);
    const playerMap = new Map(
      scopedPlayers.map((player) => [String(player.id), player])
    );
    const selectedCategoryName =
      categories.find((category) => String(category.id) === String(selectedCategoryId || ""))?.name ||
      null;

    const matchLog = filteredResults.map((result) => {
      const player1 = playerMap.get(String(result.player1_id));
      const player2 = playerMap.get(String(result.player2_id));
      const selectedIsPlayer1 = Number(result.player1_id) === Number(selectedPlayerId);
      const resultType = String(result.result_type || "normal").toLowerCase();
      const isWin = Number(result.winner_id) === Number(selectedPlayerId);

      let displayScore = "-";
      if (resultType === "normal") {
        displayScore = selectedIsPlayer1
          ? result.score_raw || "-"
          : reverseScoreRaw(result.score_raw) || "-";
      } else if (resultType === "walkover") {
        displayScore = `WO ${isWin ? "✓" : "✕"}`;
      } else if (resultType === "ab") {
        displayScore = `AB ${isWin ? "✓" : "✕"}`;
      }

      return {
        id: result.id,
        match_date: result.match_date,
        player1_name: player1?.name || "-",
        player1_category_name: selectedCategoryName || "-",
        player2_name: player2?.name || "-",
        player2_category_name: selectedCategoryName || "-",
        score_raw: result.score_raw,
        display_score: displayScore,
        result_type: resultType,
        result_label: isWin ? "Won" : "Lost",
        winner_id: result.winner_id
      };
    });

    const summary = {
      total_matches: matchLog.length,
      wins: matchLog.filter((match) => String(match.result_label).toLowerCase() === "won").length,
      losses: matchLog.filter((match) => String(match.result_label).toLowerCase() === "lost").length
    };

    res.json({
      categories,
      selected_category_id: selectedCategoryId,
      players,
      selected_player_id: selectedPlayerId,
      match_log: matchLog,
      summary
    });
  } catch (error) {
    handleMatchMatrixError(error, res);
  }
});

router.get("/standings", auth, async (req, res) => {
  try {
    const categories = await listScopedCategories(req);
    const selectedCategoryId = normalizeInteger(req.query.category_id, "category_id");
    const selectedMatchDate = normalizeDate(req.query.match_date, "match_date", {
      required: false
    });
    const selectedCategories = selectedCategoryId
      ? categories.filter((category) => Number(category.id) === selectedCategoryId)
      : categories;

    const rows = [];
    let availableDates = [];

    for (const category of selectedCategories) {
      const categoryId = Number(category.id);
      const players = await listScopedPlayersByCategory(categoryId, req);
      const results = selectedMatchDate
        ? await listResults(categoryId, selectedMatchDate, req)
        : await listAllResultsForCategory(categoryId, req);
      const normalResults = results.filter(
        (result) => String(result.result_type || "normal").toLowerCase() === "normal"
      );
      const summary = buildStandingsSummary({
        categories,
        selectedCategoryId: categoryId,
        players,
        results: normalResults
      });
      const streakMap = buildStreakMap(normalResults);

      summary.standings
        .filter((standing) => standing.matches_played > 0)
        .forEach((standing) => {
        const streak = (streakMap.get(String(standing.player_id)) || []).join(" ");
        rows.push({
          player_id: standing.player_id,
          player_name: standing.player_name,
          category_id: categoryId,
          category_name: category.name,
          wins: standing.wins,
          losses: standing.losses,
          total_matches: standing.matches_played,
          streak
        });
      });

      if (selectedCategoryId && String(category.id) === String(selectedCategoryId || "")) {
        availableDates = await listAvailableDates(categoryId, req);
      }
    }

    res.json({
      categories,
      rows,
      available_dates: availableDates,
      selected_match_date: selectedMatchDate || null
    });
  } catch (error) {
    handleMatchMatrixError(error, res);
  }
});

router.post("/results", auth, async (req, res) => {
  try {
    const academyId = normalizeInteger(req.user?.academy_id, "academy_id", { required: true });
    const categoryId = normalizeInteger(req.body.category_id, "category_id", { required: true });
    const matchDate = normalizeDate(req.body.match_date, "match_date", { required: true });
    const originalPlayer1Id = normalizeInteger(req.body.player1_id, "player1_id", {
      required: true
    });
    const originalPlayer2Id = normalizeInteger(req.body.player2_id, "player2_id", {
      required: true
    });
    const resultType = normalizeResultType(req.body.result_type);
    const winnerId = normalizeInteger(req.body.winner_id, "winner_id", { required: true });
    const notes = normalizeText(req.body.notes);
    const scoreRawInput = normalizeText(req.body.score_raw);
    const scoreRaw = resultType === "normal" ? scoreRawInput : null;

    if (resultType === "normal" && !scoreRaw) {
      const error = new Error("score_raw is required");
      error.statusCode = 400;
      throw error;
    }

    if (![originalPlayer1Id, originalPlayer2Id].includes(winnerId)) {
      const error = new Error("winner_id must be one of the selected players");
      error.statusCode = 400;
      throw error;
    }

    const players = await listScopedPlayersByIds([originalPlayer1Id, originalPlayer2Id], req);

    if (players.length !== 2) {
      const error = new Error("One or more players were not found");
      error.statusCode = 404;
      throw error;
    }

    const invalidCategoryPlayer = players.find(
      (player) => Number(player.category_id || 0) !== categoryId
    );

    if (invalidCategoryPlayer) {
      const error = new Error("Both players must belong to the selected category");
      error.statusCode = 400;
      throw error;
    }

    const canonical = canonicalizePair({
      player1Id: originalPlayer1Id,
      player2Id: originalPlayer2Id,
      scoreRaw
    });

    const { data, error } = await supabase
      .from(ACADEMY_MATCH_RESULTS_TABLE)
      .upsert(
        {
          academy_id: academyId,
          category_id: categoryId,
          match_date: matchDate,
          player1_id: canonical.player1Id,
          player2_id: canonical.player2Id,
          result_type: resultType,
          score_raw: canonical.scoreRaw,
          winner_id: winnerId,
          notes,
          created_by: normalizeInteger(req.user?.id, "created_by"),
          updated_at: new Date().toISOString()
        },
        {
          onConflict: "academy_id,category_id,match_date,player1_id,player2_id"
        }
      )
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    res.json(data);
  } catch (error) {
    handleMatchMatrixError(error, res);
  }
});

router.delete("/results/:id", auth, async (req, res) => {
  try {
    const existingResult = await getScopedResult(req.params.id, req);

    if (!existingResult) {
      return res.status(404).json({ error: "Match result not found" });
    }

    const { error } = await supabase
      .from(ACADEMY_MATCH_RESULTS_TABLE)
      .delete()
      .eq("id", req.params.id);

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      deleted_result_id: existingResult.id
    });
  } catch (error) {
    handleMatchMatrixError(error, res);
  }
});

export default router;
