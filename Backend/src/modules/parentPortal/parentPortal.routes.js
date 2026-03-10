import crypto from "crypto";
import express from "express";
import supabase from "../../config/db.js";
import razorpay from "../../config/razorpay.js";
import { env, hasRazorpayConfig } from "../../config/env.js";
import { auth } from "../../middleware/auth.middleware.js";
import { applyAcademyFilter } from "../../middleware/academyFilter.js";

const router = express.Router();

function normalizeText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text ? text : null;
}

function normalizeInteger(value, fieldName, { required = false, min = 1 } = {}) {
  if (value === null || value === undefined || value === "") {
    if (required) {
      throw new Error(`${fieldName} is required`);
    }

    return null;
  }

  const numericValue = Number(value);

  if (!Number.isInteger(numericValue) || numericValue < min) {
    throw new Error(`${fieldName} must be a whole number`);
  }

  return numericValue;
}

function normalizePhone(value) {
  const text = normalizeText(value);
  return text ? text.replace(/\D+/g, "") : null;
}

function getRoleName(req) {
  return String(req.user?.role || req.user?.role_name || "").trim().toLowerCase();
}

function isParentRoleName(roleName) {
  return String(roleName || "").trim().toLowerCase().startsWith("parent");
}

function canAccessParentPortal(req) {
  return (
    isParentRoleName(getRoleName(req)) ||
    String(req.user?.role_id || "").trim() === "4"
  );
}

function ensureParentPortalAccess(req) {
  if (!canAccessParentPortal(req)) {
    const error = new Error("You do not have access to the parent portal");
    error.statusCode = 403;
    throw error;
  }
}

function formatBillingLabel(invoice) {
  if (!invoice?.invoice_month || !invoice?.invoice_year) {
    return null;
  }

  return new Date(invoice.invoice_year, invoice.invoice_month - 1, 1).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric"
  });
}

function calculateInvoiceStatus({ totalAmount, paidAmount, currentStatus }) {
  if (currentStatus === "cancelled") {
    return "cancelled";
  }

  const total = Number(totalAmount || 0);
  const paid = Number(paidAmount || 0);

  if (paid <= 0) {
    return currentStatus === "draft" ? "draft" : "issued";
  }

  if (paid >= total) {
    return "paid";
  }

  return "partial";
}

function formatReceiptNumber(paymentId, paymentDate) {
  const date = paymentDate ? new Date(paymentDate) : new Date();
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("");

  return `AG-PR-${stamp}-${String(paymentId).padStart(5, "0")}`;
}

async function getCurrentUserRow(req) {
  const { data, error } = await supabase
    .from("app_users")
    .select("id,academy_id,role_id,name,email,phone,status,is_active")
    .eq("id", req.user?.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function listLinkedPlayerIds(req, userRow) {
  const roleName = getRoleName(req);

  if (!isParentRoleName(roleName)) {
    return [];
  }

  const linkedIds = new Set();

  try {
    const { data, error } = await supabase
      .from("parent_players")
      .select("player_id")
      .eq("academy_id", userRow.academy_id)
      .eq("parent_user_id", userRow.id);

    if (error) {
      if (!/does not exist/i.test(error.message || "") && !/Could not find the table/i.test(error.message || "")) {
        throw error;
      }
    } else {
      (data || []).forEach((row) => {
        if (row.player_id) {
          linkedIds.add(Number(row.player_id));
        }
      });
    }
  } catch (error) {
    if (!/does not exist/i.test(error.message || "")) {
      throw error;
    }
  }

  let query = supabase
    .from("players")
    .select("id,email,contact_number_1,contact_number_2,father_name,mother_name,status")
    .eq("academy_id", userRow.academy_id);
  query = applyAcademyFilter(query, req);

  const { data: players, error: playersError } = await query;

  if (playersError) {
    throw playersError;
  }

  const userEmail = String(userRow.email || "").trim().toLowerCase();
  const userPhone = normalizePhone(userRow.phone);
  const userName = String(userRow.name || "").trim().toLowerCase();

  (players || []).forEach((player) => {
    const playerEmail = String(player.email || "").trim().toLowerCase();
    const contactOne = normalizePhone(player.contact_number_1);
    const contactTwo = normalizePhone(player.contact_number_2);
    const fatherName = String(player.father_name || "").trim().toLowerCase();
    const motherName = String(player.mother_name || "").trim().toLowerCase();

    const emailMatch = userEmail && playerEmail && userEmail === playerEmail;
    const phoneMatch = userPhone && [contactOne, contactTwo].includes(userPhone);
    const nameMatch = userName && [fatherName, motherName].includes(userName);

    if (emailMatch || phoneMatch || nameMatch) {
      linkedIds.add(Number(player.id));
    }
  });

  return [...linkedIds];
}

async function listScopedPlayersByIds(playerIds, req) {
  if (!playerIds.length) {
    return [];
  }

  let query = supabase
    .from("players")
    .select("id,academy_id,category_id,name,dob,gender,father_name,mother_name,contact_number_1,contact_number_2,email,status")
    .in("id", playerIds);
  query = applyAcademyFilter(query, req);

  const { data, error } = await query.order("name", { ascending: true });

  if (error) {
    throw error;
  }

  const categoryIds = [...new Set((data || []).map((player) => player.category_id).filter(Boolean))];
  let categories = [];

  if (categoryIds.length) {
    const categoriesResponse = await supabase.from("categories").select("id,name").in("id", categoryIds);
    if (categoriesResponse.error) {
      throw categoriesResponse.error;
    }
    categories = categoriesResponse.data || [];
  }

  const categoryMap = new Map(categories.map((category) => [String(category.id), category.name]));

  return (data || []).map((player) => ({
    ...player,
    category_name: categoryMap.get(String(player.category_id || "")) || null
  }));
}

async function resolveAccessiblePlayers(req) {
  ensureParentPortalAccess(req);

  const userRow = await getCurrentUserRow(req);
  if (!userRow) {
    const error = new Error("User record not found");
    error.statusCode = 404;
    throw error;
  }

  const playerIds = await listLinkedPlayerIds(req, userRow);
  const players = await listScopedPlayersByIds(playerIds, req);

  return {
    user: userRow,
    players
  };
}

function ensurePlayerAccess(playerId, players) {
  const player = (players || []).find((row) => String(row.id) === String(playerId));
  if (!player) {
    const error = new Error("Child profile not found for this parent account");
    error.statusCode = 404;
    throw error;
  }
  return player;
}

async function buildAttendanceSection(player, academyId) {
  const { data: records, error: recordError } = await supabase
    .from("attendance_records")
    .select("id,session_id,status,notes,marked_at")
    .eq("academy_id", academyId)
    .eq("player_id", player.id)
    .order("marked_at", { ascending: false });

  if (recordError) {
    if (/does not exist/i.test(recordError.message || "")) {
      return {
        summary: {
          present_count: 0,
          absent_count: 0,
          late_count: 0,
          excused_count: 0,
          total_records: 0
        },
        recent_records: []
      };
    }

    throw recordError;
  }

  const sessionIds = [...new Set((records || []).map((record) => record.session_id).filter(Boolean))];
  let sessions = [];

  if (sessionIds.length) {
    const { data, error } = await supabase
      .from("batch_sessions")
      .select("id,batch_id,session_date,start_time,end_time,status")
      .in("id", sessionIds);

    if (error) {
      throw error;
    }

    sessions = data || [];
  }

  const batchIds = [...new Set(sessions.map((session) => session.batch_id).filter(Boolean))];
  let batches = [];

  if (batchIds.length) {
    const { data, error } = await supabase.from("batches").select("id,name").in("id", batchIds);
    if (error) {
      throw error;
    }
    batches = data || [];
  }

  const sessionMap = new Map(sessions.map((session) => [String(session.id), session]));
  const batchMap = new Map(batches.map((batch) => [String(batch.id), batch.name]));
  const summary = (records || []).reduce(
    (accumulator, record) => {
      accumulator.total_records += 1;
      const key = `${String(record.status || "").toLowerCase()}_count`;
      if (key in accumulator) {
        accumulator[key] += 1;
      }
      return accumulator;
    },
    {
      present_count: 0,
      absent_count: 0,
      late_count: 0,
      excused_count: 0,
      total_records: 0
    }
  );

  return {
    summary,
    recent_records: (records || []).slice(0, 8).map((record) => {
      const session = sessionMap.get(String(record.session_id)) || null;
      return {
        ...record,
        session_date: session?.session_date || null,
        start_time: session?.start_time || null,
        end_time: session?.end_time || null,
        batch_name: session?.batch_id ? batchMap.get(String(session.batch_id)) || null : null
      };
    })
  };
}

async function buildPerformanceSection(player, academyId) {
  const { data: records, error: recordError } = await supabase
    .from("player_fitness_test_records")
    .select("id,test_id,measured_on,attempt_number,result_value,notes")
    .eq("academy_id", academyId)
    .eq("player_id", player.id)
    .order("measured_on", { ascending: false })
    .order("attempt_number", { ascending: false });

  if (recordError) {
    if (/does not exist/i.test(recordError.message || "")) {
      return {
        summaries: [],
        recent_records: []
      };
    }

    throw recordError;
  }

  const testIds = [...new Set((records || []).map((record) => record.test_id).filter(Boolean))];
  let tests = [];

  if (testIds.length) {
    const { data, error } = await supabase
      .from("fitness_test_definitions")
      .select("id,test_name,metric_type,unit,lower_is_better")
      .in("id", testIds);

    if (error) {
      throw error;
    }

    tests = data || [];
  }

  const testMap = new Map(tests.map((test) => [String(test.id), test]));
  const summaryMap = new Map();

  (records || []).forEach((record) => {
    const test = testMap.get(String(record.test_id));
    if (!test) {
      return;
    }

    const key = String(record.test_id);
    const existing = summaryMap.get(key) || {
      test_id: record.test_id,
      test_name: test.test_name,
      metric_type: test.metric_type,
      unit: test.unit,
      lower_is_better: Boolean(test.lower_is_better),
      best_value: null,
      worst_value: null,
      latest_value: null,
      latest_date: null
    };

    const value = Number(record.result_value || 0);
    const isLower = Boolean(test.lower_is_better);

    if (existing.best_value === null) {
      existing.best_value = value;
      existing.worst_value = value;
    } else if (isLower) {
      existing.best_value = Math.min(existing.best_value, value);
      existing.worst_value = Math.max(existing.worst_value, value);
    } else {
      existing.best_value = Math.max(existing.best_value, value);
      existing.worst_value = Math.min(existing.worst_value, value);
    }

    if (!existing.latest_date || String(record.measured_on) >= String(existing.latest_date)) {
      existing.latest_date = record.measured_on;
      existing.latest_value = value;
    }

    summaryMap.set(key, existing);
  });

  return {
    summaries: [...summaryMap.values()].sort((left, right) =>
      String(left.test_name || "").localeCompare(String(right.test_name || ""))
    ),
    recent_records: (records || []).slice(0, 10).map((record) => ({
      ...record,
      test_name: testMap.get(String(record.test_id))?.test_name || null,
      unit: testMap.get(String(record.test_id))?.unit || null
    }))
  };
}

async function buildAcademyMatchesSection(player, academyId) {
  const { data: matches, error } = await supabase
    .from("academy_match_results")
    .select("*")
    .eq("academy_id", academyId)
    .or(`player1_id.eq.${player.id},player2_id.eq.${player.id}`)
    .order("match_date", { ascending: false });

  if (error) {
    if (/does not exist/i.test(error.message || "")) {
      return {
        recent_matches: [],
        summary: {
          total_matches: 0,
          wins: 0,
          losses: 0
        }
      };
    }

    throw error;
  }

  const playerIds = [
    ...new Set(
      (matches || [])
        .flatMap((match) => [match.player1_id, match.player2_id])
        .filter(Boolean)
    )
  ];
  const matchCategoryIds = [...new Set((matches || []).map((match) => match.category_id).filter(Boolean))];

  const playersResponse = playerIds.length
    ? await supabase.from("players").select("id,name,category_id").in("id", playerIds)
    : { data: [], error: null };

  if (playersResponse.error) {
    throw playersResponse.error;
  }

  const playerRows = playersResponse.data || [];
  const playerCategoryIds = [...new Set(playerRows.map((row) => row.category_id).filter(Boolean))];
  const categoryIds = [...new Set([...matchCategoryIds, ...playerCategoryIds])];
  const categoriesResponse = categoryIds.length
    ? await supabase.from("categories").select("id,name").in("id", categoryIds)
    : { data: [], error: null };

  if (categoriesResponse.error) {
    throw categoriesResponse.error;
  }

  const playerMap = new Map(playerRows.map((row) => [String(row.id), row]));
  const categoryMap = new Map((categoriesResponse.data || []).map((row) => [String(row.id), row.name]));
  const summary = {
    total_matches: (matches || []).length,
    wins: 0,
    losses: 0
  };

  const recentMatches = (matches || []).slice(0, 10).map((match) => {
    const isPlayerOne = Number(match.player1_id) === Number(player.id);
    const didWin = Number(match.winner_id) === Number(player.id);
    if (didWin) {
      summary.wins += 1;
    } else {
      summary.losses += 1;
    }

    const player1 = playerMap.get(String(match.player1_id)) || null;
    const player2 = playerMap.get(String(match.player2_id)) || null;
    const player1CategoryName =
      categoryMap.get(String(player1?.category_id || match.category_id || "")) ||
      categoryMap.get(String(match.category_id || "")) ||
      null;
    const player2CategoryName =
      categoryMap.get(String(player2?.category_id || match.category_id || "")) ||
      categoryMap.get(String(match.category_id || "")) ||
      null;

    return {
      id: match.id,
      match_date: match.match_date,
      category_name: categoryMap.get(String(match.category_id)) || player.category_name || null,
      opponent_name:
        playerMap.get(String(isPlayerOne ? match.player2_id : match.player1_id))?.name || null,
      score_raw: isPlayerOne ? match.score_raw : reverseScoreRaw(match.score_raw),
      display_score:
        String(match.result_type || "normal").toLowerCase() === "normal"
          ? (isPlayerOne ? match.score_raw : reverseScoreRaw(match.score_raw)) || "-"
          : String(match.result_type || "normal").toUpperCase(),
      player1_name: player1?.name || null,
      player1_category_name: player1CategoryName,
      player2_name: player2?.name || null,
      player2_category_name: player2CategoryName,
      result_type: match.result_type || "normal",
      result_label: didWin ? "Won" : "Lost"
    };
  });

  return {
    summary,
    recent_matches: recentMatches,
    match_log: recentMatches
  };
}

async function listCategoryPlayersForMatrix(categoryId, academyId) {
  if (!categoryId) {
    return [];
  }

  const { data, error } = await supabase
    .from("players")
    .select("id,name,category_id,status")
    .eq("academy_id", academyId)
    .eq("category_id", categoryId)
    .eq("status", "active")
    .order("name", { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}

async function listCategoryMatrixDates(categoryId, academyId) {
  if (!categoryId) {
    return [];
  }

  const { data, error } = await supabase
    .from("academy_match_results")
    .select("match_date")
    .eq("academy_id", academyId)
    .eq("category_id", categoryId)
    .order("match_date", { ascending: false });

  if (error) {
    if (/does not exist/i.test(error.message || "")) {
      return [];
    }

    throw error;
  }

  return [...new Set((data || []).map((row) => row.match_date).filter(Boolean))];
}

async function listCategoryMatrixResults(categoryId, matchDate, academyId) {
  if (!categoryId || !matchDate) {
    return [];
  }

  const { data, error } = await supabase
    .from("academy_match_results")
    .select("*")
    .eq("academy_id", academyId)
    .eq("category_id", categoryId)
    .eq("match_date", matchDate)
    .order("player1_id", { ascending: true })
    .order("player2_id", { ascending: true });

  if (error) {
    if (/does not exist/i.test(error.message || "")) {
      return [];
    }

    throw error;
  }

  return data || [];
}

async function listAcademyCategoriesForMatrix(academyId) {
  const { data, error } = await supabase
    .from("categories")
    .select("id,name")
    .eq("academy_id", academyId)
    .order("name", { ascending: true });

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

function buildMatrixStandingsSummary({ categories, selectedCategoryId, players, results }) {
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

async function buildAcademyMatrixSection(player, academyId, options = {}) {
  const [categories] = await Promise.all([listAcademyCategoriesForMatrix(academyId)]);

  const fallbackCategoryId = player?.category_id || categories[0]?.id || null;
  const requestedCategoryId = normalizeInteger(options.categoryId, "matrix_category_id", {
    required: false
  });
  const selectedCategoryId =
    requestedCategoryId &&
    categories.some((category) => String(category.id) === String(requestedCategoryId))
      ? requestedCategoryId
      : fallbackCategoryId;

  if (!selectedCategoryId) {
    return {
      category_id: null,
      category_name: null,
      categories,
      selected_match_date: null,
      available_dates: [],
      players: [],
      results: [],
      summary: null
    };
  }

  const [players, availableDates] = await Promise.all([
    listCategoryPlayersForMatrix(selectedCategoryId, academyId),
    listCategoryMatrixDates(selectedCategoryId, academyId)
  ]);

  const requestedDate = normalizeText(options.matchDate);
  const selectedMatchDate =
    requestedDate && availableDates.includes(requestedDate)
      ? requestedDate
      : availableDates[0] || null;
  const results = await listCategoryMatrixResults(selectedCategoryId, selectedMatchDate, academyId);
  const summary = buildMatrixStandingsSummary({
    categories,
    selectedCategoryId,
    players,
    results
  });

  const selectedCategory =
    categories.find((category) => String(category.id) === String(selectedCategoryId)) || null;

  return {
    category_id: selectedCategoryId,
    category_name: selectedCategory?.name || player?.category_name || null,
    categories,
    selected_match_date: selectedMatchDate,
    available_dates: availableDates,
    players,
    results,
    summary
  };
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

async function buildInvoicesSection(player, academyId) {
  const { data: invoices, error: invoiceError } = await supabase
    .from("invoices")
    .select("*")
    .eq("academy_id", academyId)
    .eq("player_id", player.id)
    .order("invoice_year", { ascending: false })
    .order("invoice_month", { ascending: false });

  if (invoiceError) {
    throw invoiceError;
  }

  const invoiceIds = [...new Set((invoices || []).map((invoice) => invoice.id).filter(Boolean))];
  const [paymentsResponse, receiptsResponse] = await Promise.all([
    invoiceIds.length
      ? supabase
          .from("invoice_payments")
          .select("id,invoice_id,payment_date,amount_paid,payment_method,reference_number,created_at")
          .in("invoice_id", invoiceIds)
      : Promise.resolve({ data: [], error: null }),
    invoiceIds.length
      ? supabase.from("invoice_receipts").select("*").in("invoice_id", invoiceIds)
      : Promise.resolve({ data: [], error: null })
  ]);

  if (paymentsResponse.error) {
    throw paymentsResponse.error;
  }
  if (receiptsResponse.error) {
    throw receiptsResponse.error;
  }

  const receiptByPaymentId = new Map((receiptsResponse.data || []).map((row) => [String(row.payment_id), row]));
  const paymentsByInvoiceId = new Map();

  (paymentsResponse.data || []).forEach((payment) => {
    const key = String(payment.invoice_id);
    const current = paymentsByInvoiceId.get(key) || [];
    current.push({
      ...payment,
      receipt: receiptByPaymentId.get(String(payment.id)) || null
    });
    paymentsByInvoiceId.set(key, current);
  });

  const enrichedInvoices = (invoices || []).map((invoice) => {
    const payments = paymentsByInvoiceId.get(String(invoice.id)) || [];
    const paidAmount = payments.reduce((sum, payment) => sum + Number(payment.amount_paid || 0), 0);
    const totalAmount = Number(invoice.total_amount || 0);

    return {
      ...invoice,
      billing_label: formatBillingLabel(invoice),
      paid_amount: Number(paidAmount.toFixed(2)),
      balance_amount: Number(Math.max(totalAmount - paidAmount, 0).toFixed(2)),
      effective_status: calculateInvoiceStatus({
        totalAmount,
        paidAmount,
        currentStatus: invoice.status
      }),
      payments
    };
  });

  return {
    summary: {
      total_invoices: enrichedInvoices.length,
      unpaid_invoices: enrichedInvoices.filter((invoice) => invoice.balance_amount > 0).length,
      outstanding_amount: Number(
        enrichedInvoices.reduce((sum, invoice) => sum + Number(invoice.balance_amount || 0), 0).toFixed(2)
      )
    },
    invoices: enrichedInvoices
  };
}

async function buildChildDashboard(player, options = {}) {
  const [attendance, performance, academyMatches, academyMatrix, invoices] = await Promise.all([
    buildAttendanceSection(player, player.academy_id),
    buildPerformanceSection(player, player.academy_id),
    buildAcademyMatchesSection(player, player.academy_id),
    buildAcademyMatrixSection(player, player.academy_id, options.matrix || {}),
    buildInvoicesSection(player, player.academy_id)
  ]);

  return {
    child: player,
    attendance,
    performance,
    academy_matches: academyMatches,
    academy_matrix: academyMatrix,
    invoices
  };
}

async function getAccessibleInvoice(invoiceId, req, players) {
  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  const allowedPlayerIds = new Set((players || []).map((player) => String(player.id)));
  if (!allowedPlayerIds.has(String(data.player_id))) {
    const accessError = new Error("Invoice not available for this parent account");
    accessError.statusCode = 404;
    throw accessError;
  }

  if (getRoleName(req) !== "super_admin" && Number(data.academy_id) !== Number(req.user?.academy_id)) {
    const accessError = new Error("Invoice not available for this academy");
    accessError.statusCode = 403;
    throw accessError;
  }

  return data;
}

async function sumInvoicePayments(invoiceId) {
  const { data, error } = await supabase
    .from("invoice_payments")
    .select("amount_paid")
    .eq("invoice_id", invoiceId);

  if (error) {
    throw error;
  }

  return (data || []).reduce((sum, row) => sum + Number(row.amount_paid || 0), 0);
}

router.get("/portal", auth, async (req, res) => {
  try {
    const { user, players } = await resolveAccessiblePlayers(req);
    const selectedPlayerId =
      normalizeInteger(req.query.player_id, "player_id", { required: false }) ||
      normalizeInteger(players[0]?.id, "player_id", { required: false });
    const selectedPlayer = selectedPlayerId ? ensurePlayerAccess(selectedPlayerId, players) : null;
    const dashboard = selectedPlayer
      ? await buildChildDashboard(selectedPlayer, {
          matrix: {
            categoryId: req.query.matrix_category_id,
            matchDate: req.query.matrix_date
          }
        })
      : null;

    res.json({
      parent: {
        id: user.id,
        name: user.name || null,
        email: user.email || null,
        phone: user.phone || null,
        academy_id: user.academy_id || null,
        role: getRoleName(req)
      },
      children: players,
      selected_child_id: selectedPlayer?.id || null,
      dashboard
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.get("/children/:playerId/dashboard", auth, async (req, res) => {
  try {
    const { players } = await resolveAccessiblePlayers(req);
    const player = ensurePlayerAccess(req.params.playerId, players);
    res.json(
      await buildChildDashboard(player, {
        matrix: {
          categoryId: req.query.matrix_category_id,
          matchDate: req.query.matrix_date
        }
      })
    );
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.post("/invoices/:invoiceId/create-payment-order", auth, async (req, res) => {
  try {
    ensureParentPortalAccess(req);

    if (!hasRazorpayConfig() || !razorpay) {
      return res.status(503).json({ error: "Online payment is not configured right now" });
    }

    const invoiceId = normalizeInteger(req.params.invoiceId, "invoice_id", { required: true });
    const { players } = await resolveAccessiblePlayers(req);
    const invoice = await getAccessibleInvoice(invoiceId, req, players);

    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const paidBefore = await sumInvoicePayments(invoice.id);
    const totalAmount = Number(invoice.total_amount || 0);
    const remainingBalance = Number(Math.max(totalAmount - paidBefore, 0).toFixed(2));

    if (remainingBalance <= 0) {
      return res.json({
        zero_amount: true,
        amount: 0,
        currency: "INR",
        key_id: env.RAZORPAY_KEY_ID
      });
    }

    const order = await razorpay.orders.create({
      amount: Math.round(remainingBalance * 100),
      currency: "INR",
      receipt: `parent-invoice-${invoice.id}-${Date.now()}`,
      notes: {
        invoice_id: String(invoice.id),
        player_id: String(invoice.player_id),
        academy_id: String(invoice.academy_id)
      }
    });

    res.json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: env.RAZORPAY_KEY_ID,
      invoice_id: invoice.id,
      payable_amount: remainingBalance,
      player_id: invoice.player_id
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message });
  }
});

router.post("/invoices/:invoiceId/verify-payment", auth, async (req, res) => {
  try {
    ensureParentPortalAccess(req);

    if (!hasRazorpayConfig()) {
      return res.status(503).json({ error: "Online payment is not configured right now" });
    }

    const invoiceId = normalizeInteger(req.params.invoiceId, "invoice_id", { required: true });
    const { players } = await resolveAccessiblePlayers(req);
    const invoice = await getAccessibleInvoice(invoiceId, req, players);

    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const razorpayOrderId = normalizeText(req.body.razorpay_order_id);
    const razorpayPaymentId = normalizeText(req.body.razorpay_payment_id);
    const razorpaySignature = normalizeText(req.body.razorpay_signature);

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      throw new Error("razorpay_order_id, razorpay_payment_id, and razorpay_signature are required");
    }

    const body = `${razorpayOrderId}|${razorpayPaymentId}`;
    const expectedSignature = crypto
      .createHmac("sha256", env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpaySignature) {
      return res.status(400).json({ error: "Payment verification failed" });
    }

    const paidBefore = await sumInvoicePayments(invoice.id);
    const totalAmount = Number(invoice.total_amount || 0);
    const remainingBalance = Number(Math.max(totalAmount - paidBefore, 0).toFixed(2));

    if (remainingBalance <= 0) {
      return res.status(409).json({ error: "Invoice is already fully paid" });
    }

    const paymentDate = new Date().toISOString().slice(0, 10);
    const { data: payment, error: paymentError } = await supabase
      .from("invoice_payments")
      .insert({
        academy_id: invoice.academy_id,
        invoice_id: invoice.id,
        player_id: invoice.player_id,
        payment_date: paymentDate,
        amount_paid: remainingBalance,
        payment_method: "online",
        reference_number: razorpayPaymentId,
        payment_proof_url: null,
        notes: `Parent portal online payment verified: order ${razorpayOrderId}`,
        received_by: req.user?.id || null
      })
      .select("*")
      .single();

    if (paymentError) {
      throw paymentError;
    }

    const { data: receipt, error: receiptError } = await supabase
      .from("invoice_receipts")
      .insert({
        academy_id: invoice.academy_id,
        invoice_id: invoice.id,
        payment_id: payment.id,
        receipt_number: formatReceiptNumber(payment.id, payment.payment_date),
        receipt_url: null
      })
      .select("*")
      .single();

    if (receiptError) {
      throw receiptError;
    }

    const totalPaid = Number((paidBefore + remainingBalance).toFixed(2));
    const nextStatus = calculateInvoiceStatus({
      totalAmount,
      paidAmount: totalPaid,
      currentStatus: invoice.status
    });

    const { error: invoiceUpdateError } = await supabase
      .from("invoices")
      .update({
        status: nextStatus,
        updated_at: new Date().toISOString()
      })
      .eq("id", invoice.id);

    if (invoiceUpdateError) {
      throw invoiceUpdateError;
    }

    res.json({
      success: true,
      payment,
      receipt,
      invoice_id: invoice.id,
      payment_status: nextStatus
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message });
  }
});

export default router;
