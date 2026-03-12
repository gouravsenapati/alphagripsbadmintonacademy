import tournamentDb from "../../../config/tournamentDb.js";
import {
  AppError,
  deriveAcademyId,
  normalizeBoolean,
  normalizeInteger,
  normalizeText,
  toPlainMetadata
} from "../utils/tournament.utils.js";
import {
  ensureTournamentByLookup,
  ensureTournamentExists,
  fetchCourtsMap,
  fetchEventsMap,
  fetchParticipantsMap
} from "./tournamentLookup.service.js";
import { buildParticipantDisplayMap } from "./participantDisplay.service.js";
import { withCourtRefereeInfo } from "./courtAssignment.service.js";

function summarizeMatchesByEvent(matches) {
  const summaryByEvent = {};

  for (const match of matches || []) {
    const current = summaryByEvent[match.event_id] || {
      total_matches: 0,
      pending_matches: 0,
      scheduled_matches: 0,
      in_progress_matches: 0,
      completed_matches: 0
    };

    current.total_matches += 1;
    if (match.status === "pending") current.pending_matches += 1;
    if (match.status === "scheduled") current.scheduled_matches += 1;
    if (match.status === "in_progress") current.in_progress_matches += 1;
    if (match.status === "completed") current.completed_matches += 1;

    summaryByEvent[match.event_id] = current;
  }

  return summaryByEvent;
}

function toPublicTournament(tournament) {
  const metadata = tournament?.metadata && typeof tournament.metadata === "object"
    ? tournament.metadata
    : {};

  return {
    id: tournament.id,
    tournament_name: tournament.tournament_name,
    tournament_code: tournament.tournament_code,
    venue_name: tournament.venue_name,
    city: tournament.city,
    state: tournament.state,
    country: tournament.country,
    start_date: tournament.start_date,
    end_date: tournament.end_date,
    status: tournament.status,
    payment_config: {
      upi_id: metadata.payment_upi_id || null,
      upi_qr_url: metadata.payment_upi_qr_url || null,
      bank_name: metadata.payment_bank_name || null,
      account_name: metadata.payment_account_name || null,
      account_number: metadata.payment_account_number || null,
      ifsc: metadata.payment_ifsc || null,
      payment_note: metadata.payment_note || null
    }
  };
}

function toPublicEvent(event) {
  return {
    id: event.id,
    event_name: event.event_name,
    event_code: event.event_code,
    category_name: event.category_name,
    gender: event.gender,
    age_group: event.age_group,
    format: event.format,
    status: event.status,
    draw_type: event.draw_type,
    draw_size: event.draw_size,
    best_of_sets: event.best_of_sets,
    points_per_set: event.points_per_set,
    max_points_per_set: event.max_points_per_set,
    seeding_enabled: event.seeding_enabled,
    third_place_match: event.third_place_match,
    sort_order: event.sort_order,
    participant_count: event.participant_count || 0,
    match_summary: event.match_summary || {
      total_matches: 0,
      pending_matches: 0,
      scheduled_matches: 0,
      in_progress_matches: 0,
      completed_matches: 0
    }
  };
}

function toPublicCourt(court) {
  return {
    id: court.id,
    court_name: court.court_name,
    sort_order: court.sort_order,
    status: court.status,
    referee_name: court.referee_name || null
  };
}

function toPublicMatch(match) {
  return {
    id: match.id,
    event_id: match.event_id,
    event_name: match.event_name,
    round_number: match.round_number,
    round_name: match.round_name,
    match_number: match.match_number,
    bracket_position: match.bracket_position,
    participant1_name: match.participant1_name,
    participant2_name: match.participant2_name,
    winner_name: match.winner_name,
    loser_name: match.loser_name,
    court_name: match.court_name,
    status: match.status,
    result_type: match.result_type,
    scheduled_at: match.scheduled_at,
    started_at: match.started_at,
    completed_at: match.completed_at,
    score_status: match.score_status,
    score_summary: match.score_summary
  };
}

export async function listTournaments({ academyId = null } = {}) {
  let query = tournamentDb
    .from("tournaments")
    .select("*")
    .order("start_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (academyId) {
    query = query.eq("academy_id", academyId);
  }

  const { data, error } = await query;

  if (error) {
    throw new AppError(error.message, 500);
  }

  return data || [];
}

export async function createTournament({ req, input }) {
  const tournamentName = normalizeText(input.tournament_name);
  const startDate = normalizeText(input.start_date);
  const endDate = normalizeText(input.end_date);

  if (!tournamentName) {
    throw new AppError("tournament_name is required", 400);
  }

  if (!startDate || !endDate) {
    throw new AppError("start_date and end_date are required", 400);
  }

  const payload = {
    academy_id: deriveAcademyId(req, input),
    tournament_name: tournamentName,
    tournament_code: normalizeText(input.tournament_code),
    venue_name: normalizeText(input.venue_name),
    city: normalizeText(input.city),
    state: normalizeText(input.state),
    country: normalizeText(input.country) || "India",
    start_date: startDate,
    end_date: endDate,
    status: normalizeText(input.status) || "draft",
    created_by: normalizeText(input.created_by) || String(req.user?.id || ""),
    notes: normalizeText(input.notes),
    metadata: toPlainMetadata(input.metadata)
  };

  const { data, error } = await tournamentDb
    .from("tournaments")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    throw new AppError(error.message, 500);
  }

  return data;
}

export async function updateTournament({ tournamentId, req, input }) {
  const existingTournament = await ensureTournamentExists(tournamentId);
  const tournamentName = normalizeText(input.tournament_name);
  const startDate = normalizeText(input.start_date);
  const endDate = normalizeText(input.end_date);
  const mergedMetadata = {
    ...(
      existingTournament.metadata &&
      typeof existingTournament.metadata === "object" &&
      !Array.isArray(existingTournament.metadata)
        ? existingTournament.metadata
        : {}
    ),
    ...toPlainMetadata(input.metadata)
  };

  const payload = {
    academy_id: deriveAcademyId(req, input) ?? existingTournament.academy_id,
    tournament_name: tournamentName ?? existingTournament.tournament_name,
    tournament_code:
      normalizeText(input.tournament_code) ?? existingTournament.tournament_code,
    venue_name: normalizeText(input.venue_name) ?? existingTournament.venue_name,
    city: normalizeText(input.city) ?? existingTournament.city,
    state: normalizeText(input.state) ?? existingTournament.state,
    country: normalizeText(input.country) ?? existingTournament.country,
    start_date: startDate ?? existingTournament.start_date,
    end_date: endDate ?? existingTournament.end_date,
    status: normalizeText(input.status) ?? existingTournament.status,
    notes: normalizeText(input.notes) ?? existingTournament.notes,
    metadata: mergedMetadata
  };

  const { data, error } = await tournamentDb
    .from("tournaments")
    .update(payload)
    .eq("id", tournamentId)
    .select("*")
    .single();

  if (error) {
    throw new AppError(error.message, 500);
  }

  return data;
}

export async function deleteTournament(tournamentId) {
  const tournament = await ensureTournamentExists(tournamentId);

  const { data: matches, error: matchesError } = await tournamentDb
    .from("matches")
    .select("id,status,result_type,started_at,scheduled_at")
    .eq("tournament_id", tournamentId);

  if (matchesError) {
    throw new AppError(matchesError.message, 500);
  }

  const blockingMatches = (matches || []).filter((match) => {
    if (["scheduled", "in_progress"].includes(match.status)) {
      return true;
    }

    if (match.started_at || match.scheduled_at) {
      return true;
    }

    if (match.status === "completed" && match.result_type !== "bye") {
      return true;
    }

    return false;
  });

  if (blockingMatches.length) {
    throw new AppError(
      "Only tournaments without scheduled, live, or played matches can be deleted. Cancel/archive active tournaments instead.",
      409
    );
  }

  const deleteByTournament = async (table) => {
    const { error, count } = await tournamentDb
      .from(table)
      .delete({ count: "exact" })
      .eq("tournament_id", tournamentId);

    if (error) {
      throw new AppError(error.message, 500);
    }

    return count || 0;
  };

  const deletedCounts = {
    match_sets: await deleteByTournament("match_sets"),
    matches: await deleteByTournament("matches"),
    participants: await deleteByTournament("participants"),
    courts: await deleteByTournament("courts"),
    events: await deleteByTournament("events")
  };

  const { data, error } = await tournamentDb
    .from("tournaments")
    .delete()
    .eq("id", tournamentId)
    .select("id,tournament_name")
    .single();

  if (error) {
    throw new AppError(error.message, 500);
  }

  return {
    id: data.id,
    tournament_name: data.tournament_name,
    deleted_counts: deletedCounts,
    message: "Tournament deleted permanently"
  };
}

export async function getTournamentOverview(tournamentId) {
  const [
    tournament,
    { data: events, error: eventsError },
    { data: courts, error: courtsError },
    { data: participants, error: participantsError },
    { data: matches, error: matchesError }
  ] = await Promise.all([
    ensureTournamentExists(tournamentId),
    tournamentDb
      .from("events")
      .select("*")
      .eq("tournament_id", tournamentId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    tournamentDb
      .from("courts")
      .select("*")
      .eq("tournament_id", tournamentId)
      .order("sort_order", { ascending: true })
      .order("court_name", { ascending: true }),
    tournamentDb
      .from("participants")
      .select("id,event_id,status")
      .eq("tournament_id", tournamentId),
    tournamentDb
      .from("matches")
      .select("id,event_id,status,result_type,round_number,match_number")
      .eq("tournament_id", tournamentId)
  ]);

  if (eventsError || courtsError || participantsError || matchesError) {
    throw new AppError(
      eventsError?.message ||
        courtsError?.message ||
        participantsError?.message ||
        matchesError?.message,
      500
    );
  }

  const participantCountByEvent = {};
  const matchSummaryByEvent = summarizeMatchesByEvent(matches || []);

  for (const participant of participants || []) {
    participantCountByEvent[participant.event_id] =
      (participantCountByEvent[participant.event_id] || 0) + 1;
  }

  return {
    tournament,
    events: (events || []).map((event) => ({
      ...event,
      participant_count: participantCountByEvent[event.id] || 0,
      match_summary: matchSummaryByEvent[event.id] || {
        total_matches: 0,
        pending_matches: 0,
        scheduled_matches: 0,
        in_progress_matches: 0,
        completed_matches: 0
      }
    })),
    courts: (courts || []).map(withCourtRefereeInfo)
  };
}

export async function getPublicTournamentOverview(tournamentLookup) {
  const tournament = await ensureTournamentByLookup(tournamentLookup);
  const overview = await getTournamentOverview(tournament.id);

  return {
    tournament: toPublicTournament(overview.tournament),
    events: (overview.events || []).map(toPublicEvent),
    courts: (overview.courts || []).map(toPublicCourt)
  };
}

export async function listPublicTournaments({ status = null } = {}) {
  const tournaments = await listTournaments();
  const normalizedStatus = normalizeText(status);

  return (tournaments || [])
    .filter((tournament) => tournament.status !== "cancelled")
    .filter((tournament) =>
      normalizedStatus ? tournament.status === normalizedStatus : true
    )
    .map(toPublicTournament);
}

export async function createEvent({ tournamentId, input }) {
  await ensureTournamentExists(tournamentId);

  const eventName = normalizeText(input.event_name);
  const format = normalizeText(input.format);
  const drawSize = normalizeInteger(input.draw_size, { allowNull: true, min: 2 });
  const bestOfSets = normalizeInteger(input.best_of_sets, {
    allowNull: true,
    min: 1,
    max: 5
  });
  const pointsPerSet = normalizeInteger(input.points_per_set, {
    allowNull: true,
    min: 1
  });
  const maxPointsPerSet = normalizeInteger(input.max_points_per_set, {
    allowNull: true,
    min: 1
  });
  const sortOrder = normalizeInteger(input.sort_order, { allowNull: true, min: 0 });

  if (!eventName) {
    throw new AppError("event_name is required", 400);
  }

  if (!["singles", "doubles"].includes(format)) {
    throw new AppError("format must be singles or doubles", 400);
  }

  if (
    Number.isNaN(drawSize) ||
    Number.isNaN(bestOfSets) ||
    Number.isNaN(pointsPerSet) ||
    Number.isNaN(maxPointsPerSet) ||
    Number.isNaN(sortOrder)
  ) {
    throw new AppError("Invalid event numeric values", 400);
  }

  const payload = {
    tournament_id: tournamentId,
    event_name: eventName,
    event_code: normalizeText(input.event_code),
    category_name: normalizeText(input.category_name),
    gender: normalizeText(input.gender),
    age_group: normalizeText(input.age_group),
    format,
    status: normalizeText(input.status) || "draft",
    draw_type: normalizeText(input.draw_type) || "single_elimination",
    draw_size: drawSize,
    best_of_sets: bestOfSets ?? 3,
    points_per_set: pointsPerSet ?? 21,
    max_points_per_set: maxPointsPerSet ?? 30,
    seeding_enabled: normalizeBoolean(input.seeding_enabled, false),
    third_place_match: normalizeBoolean(input.third_place_match, false),
    sort_order: sortOrder ?? 0,
    metadata: toPlainMetadata(input.metadata)
  };

  const { data, error } = await tournamentDb
    .from("events")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    throw new AppError(error.message, 500);
  }

  return data;
}

export async function updateEvent({ tournamentId, eventId, input }) {
  await ensureTournamentExists(tournamentId);

  const { data: existingEvent, error: existingError } = await tournamentDb
    .from("events")
    .select("*")
    .eq("id", eventId)
    .eq("tournament_id", tournamentId)
    .maybeSingle();

  if (existingError) {
    throw new AppError(existingError.message, 500);
  }

  if (!existingEvent) {
    throw new AppError("Event not found for tournament", 404);
  }

  const eventName = normalizeText(input.event_name);
  const format = normalizeText(input.format);
  const drawSize = normalizeInteger(input.draw_size, { allowNull: true, min: 2 });
  const bestOfSets = normalizeInteger(input.best_of_sets, {
    allowNull: true,
    min: 1,
    max: 5
  });
  const pointsPerSet = normalizeInteger(input.points_per_set, {
    allowNull: true,
    min: 1
  });
  const maxPointsPerSet = normalizeInteger(input.max_points_per_set, {
    allowNull: true,
    min: 1
  });
  const sortOrder = normalizeInteger(input.sort_order, { allowNull: true, min: 0 });

  if (
    Number.isNaN(drawSize) ||
    Number.isNaN(bestOfSets) ||
    Number.isNaN(pointsPerSet) ||
    Number.isNaN(maxPointsPerSet) ||
    Number.isNaN(sortOrder)
  ) {
    throw new AppError("Invalid event numeric values", 400);
  }

  if (format && !["singles", "doubles"].includes(format)) {
    throw new AppError("format must be singles or doubles", 400);
  }

  const mergedMetadata = {
    ...(existingEvent.metadata && typeof existingEvent.metadata === "object"
      ? existingEvent.metadata
      : {}),
    ...toPlainMetadata(input.metadata)
  };

  const payload = {
    event_name: eventName ?? existingEvent.event_name,
    event_code: normalizeText(input.event_code) ?? existingEvent.event_code,
    category_name: normalizeText(input.category_name) ?? existingEvent.category_name,
    gender: normalizeText(input.gender) ?? existingEvent.gender,
    age_group: normalizeText(input.age_group) ?? existingEvent.age_group,
    format: format ?? existingEvent.format,
    status: normalizeText(input.status) ?? existingEvent.status,
    draw_type: normalizeText(input.draw_type) ?? existingEvent.draw_type,
    draw_size: drawSize ?? existingEvent.draw_size,
    best_of_sets: bestOfSets ?? existingEvent.best_of_sets,
    points_per_set: pointsPerSet ?? existingEvent.points_per_set,
    max_points_per_set: maxPointsPerSet ?? existingEvent.max_points_per_set,
    seeding_enabled:
      input.seeding_enabled !== undefined
        ? normalizeBoolean(input.seeding_enabled, false)
        : existingEvent.seeding_enabled,
    third_place_match:
      input.third_place_match !== undefined
        ? normalizeBoolean(input.third_place_match, false)
        : existingEvent.third_place_match,
    sort_order: sortOrder ?? existingEvent.sort_order,
    metadata: mergedMetadata
  };

  const { data, error } = await tournamentDb
    .from("events")
    .update(payload)
    .eq("id", eventId)
    .eq("tournament_id", tournamentId)
    .select("*")
    .single();

  if (error) {
    throw new AppError(error.message, 500);
  }

  return data;
}

export async function listCourts(tournamentId) {
  await ensureTournamentExists(tournamentId);

  const { data, error } = await tournamentDb
    .from("courts")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("sort_order", { ascending: true })
    .order("court_name", { ascending: true });

  if (error) {
    throw new AppError(error.message, 500);
  }

  return (data || []).map(withCourtRefereeInfo);
}

export async function createCourt({ tournamentId, input }) {
  await ensureTournamentExists(tournamentId);

  const courtName = normalizeText(input.court_name);
  const sortOrder = normalizeInteger(input.sort_order, { allowNull: true, min: 0 });

  if (!courtName) {
    throw new AppError("court_name is required", 400);
  }

  if (Number.isNaN(sortOrder)) {
    throw new AppError("sort_order must be a non-negative integer", 400);
  }

  const payload = {
    tournament_id: tournamentId,
    court_name: courtName,
    sort_order: sortOrder ?? 0,
    status: normalizeText(input.status) || "available",
    notes: normalizeText(input.notes),
    metadata: toPlainMetadata(input.metadata)
  };

  const { data, error } = await tournamentDb
    .from("courts")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    throw new AppError(error.message, 500);
  }

  return data;
}

export async function listReadyMatches({ tournamentId, eventId = null }) {
  await ensureTournamentExists(tournamentId);

  let query = tournamentDb
    .from("ready_matches")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("round_number", { ascending: true })
    .order("match_number", { ascending: true });

  if (eventId) {
    query = query.eq("event_id", eventId);
  }

  const { data, error } = await query;

  if (error) {
    throw new AppError(error.message, 500);
  }

  const participantsMap = await fetchParticipantsMap(
    (data || []).flatMap((match) => [match.participant1_id, match.participant2_id])
  );
  const participantDisplayMap = await buildParticipantDisplayMap(
    [...participantsMap.values()]
  );

  return (data || []).map((match) => ({
    ...match,
    participant1_name:
      participantDisplayMap.get(match.participant1_id) || match.participant1_name || null,
    participant2_name:
      participantDisplayMap.get(match.participant2_id) || match.participant2_name || null
  }));
}

export async function enrichMatches(matches) {
  const participantsMap = await fetchParticipantsMap(
    matches.flatMap((match) => [
      match.participant1_id,
      match.participant2_id,
      match.winner_id,
      match.loser_id
    ])
  );
  const courtsMap = await fetchCourtsMap(matches.map((match) => match.court_id));
  const eventsMap = await fetchEventsMap(matches.map((match) => match.event_id));
  const participantDisplayMap = await buildParticipantDisplayMap(
    [...participantsMap.values()]
  );

  return matches.map((match) => ({
    ...match,
    event_name: eventsMap.get(match.event_id)?.event_name || null,
    participant1_name: participantDisplayMap.get(match.participant1_id) || null,
    participant2_name: participantDisplayMap.get(match.participant2_id) || null,
    winner_name: participantDisplayMap.get(match.winner_id) || null,
    loser_name: participantDisplayMap.get(match.loser_id) || null,
    court_name: courtsMap.get(match.court_id)?.court_name || null
  }));
}

export async function listMatches({
  tournamentId,
  eventId = null,
  status = null,
  roundNumber = null
}) {
  await ensureTournamentExists(tournamentId);

  let query = tournamentDb
    .from("matches")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("round_number", { ascending: true })
    .order("match_number", { ascending: true })
    .order("created_at", { ascending: true });

  if (eventId) {
    query = query.eq("event_id", eventId);
  }

  if (status) {
    query = query.eq("status", status);
  }

  if (roundNumber !== null) {
    query = query.eq("round_number", roundNumber);
  }

  const { data, error } = await query;

  if (error) {
    throw new AppError(error.message, 500);
  }

  return enrichMatches(data || []);
}

export async function listPublicMatches({
  tournamentLookup,
  eventId = null,
  status = null,
  roundNumber = null
}) {
  const tournament = await ensureTournamentByLookup(tournamentLookup);
  const matches = await listMatches({
    tournamentId: tournament.id,
    eventId,
    status,
    roundNumber
  });

  return matches.map(toPublicMatch);
}

export {
  approveRegistrationToParticipant,
  createRegistrationPaymentOrder,
  verifyRegistrationPayment,
  createTournamentRegistration,
  listRegistrationEventOptions,
  listTournamentRegistrations,
  updateTournamentRegistration
} from "./registration.service.js";
