import tournamentDb from "../../../config/tournamentDb.js";
import razorpay from "../../../config/razorpay.js";
import { env, hasRazorpayConfig } from "../../../config/env.js";
import { ensureTournamentByLookup, ensureTournamentExists } from "./tournamentLookup.service.js";
import {
  AppError,
  buildExternalPlayerId,
  canonicalTeamKey,
  normalizeInteger,
  normalizeText
} from "../utils/tournament.utils.js";
import crypto from "crypto";
import {
  sendPaymentConfirmedEmail,
  sendRegistrationDecisionEmail,
  sendRegistrationReceivedEmail
} from "./registrationEmail.service.js";
import { registerParticipantForEvent } from "./participantRegistration.service.js";
import { enrichParticipantsWithDisplayNames } from "./participantDisplay.service.js";

const PAYMENT_STATUSES = ["pending", "paid", "rejected"];
const ENTRY_STATUSES = ["submitted", "approved", "rejected"];
const ENTRY_TYPES = ["singles", "doubles"];
const FEE_TYPES = ["inclusive_gst", "exclusive_gst"];
const GENDER_VALUES = ["Girls", "Boys"];
const PAYMENT_METHODS = ["online", "upi", "bank_transfer"];

function triggerBackgroundEmail(task) {
  Promise.resolve(task).catch(() => null);
}

function normalizePaymentStatus(value, fallback = "pending") {
  const normalized = normalizeText(value)?.toLowerCase() || fallback;

  if (!PAYMENT_STATUSES.includes(normalized)) {
    throw new AppError("payment_status must be pending, paid, or rejected", 400);
  }

  return normalized;
}

function normalizeEntryStatus(value, fallback = "submitted") {
  const normalized = normalizeText(value)?.toLowerCase() || fallback;

  if (!ENTRY_STATUSES.includes(normalized)) {
    throw new AppError("entry status must be submitted, approved, or rejected", 400);
  }

  return normalized;
}

function normalizeGender(value) {
  const normalized = normalizeText(value);

  if (!normalized) {
    throw new AppError("gender is required", 400);
  }

  const matched = GENDER_VALUES.find(
    (gender) => gender.toLowerCase() === normalized.toLowerCase()
  );

  if (!matched) {
    throw new AppError("gender must be Boys or Girls", 400);
  }

  return matched;
}

function normalizeEntryType(value) {
  const normalized = normalizeText(value)?.toLowerCase();

  if (!normalized || !ENTRY_TYPES.includes(normalized)) {
    throw new AppError("entry_type must be singles or doubles", 400);
  }

  return normalized;
}

function normalizeFeeType(value) {
  const normalized = normalizeText(value)?.toLowerCase() || "inclusive_gst";
  return FEE_TYPES.includes(normalized) ? normalized : "inclusive_gst";
}

function normalizePaymentMethod(value, fallback = "online") {
  const normalized = normalizeText(value)?.toLowerCase() || fallback;

  if (!PAYMENT_METHODS.includes(normalized)) {
    throw new AppError("payment_method must be online, upi, or bank_transfer", 400);
  }

  return normalized;
}

function normalizeRegistrationPlayerKey(playerName, phoneNumber) {
  const normalizedName = normalizeText(playerName)?.toLowerCase() || "";
  const normalizedPhone = normalizeText(phoneNumber)?.replace(/\s+/g, "") || "";
  return `${normalizedName}::${normalizedPhone}`;
}

function parseMoney(value, fallback = 0) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.round(parsed * 100) / 100;
}

function calculatePayableAmount({ registrationFee, feeType, gstPercent }) {
  const base = parseMoney(registrationFee, 0);
  const gst = parseMoney(gstPercent, 0);

  if (feeType === "exclusive_gst") {
    const payable = base + (base * gst) / 100;
    return Math.round(payable * 100) / 100;
  }

  return base;
}

function buildRegistrationSnapshot(event) {
  const metadata =
    event?.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
      ? event.metadata
      : {};
  const statusOpensRegistration =
    normalizeText(event?.status)?.toLowerCase() === "registration_open";
  const registrationEnabled =
    statusOpensRegistration || metadata.registration_enabled === true;
  const registrationFee = parseMoney(metadata.registration_fee, 0);
  const feeType = normalizeFeeType(metadata.fee_type);
  const gstPercent = parseMoney(metadata.gst_percent, 0);
  const payableAmount = calculatePayableAmount({
    registrationFee,
    feeType,
    gstPercent
  });

  return {
    event_id: event.id,
    event_name: event.event_name,
    event_code: event.event_code || null,
    format: event.format,
    entry_type: normalizeEntryType(event.format),
    gender: event.gender || null,
    age_group: event.age_group || null,
    registration_enabled: registrationEnabled,
    registration_fee: registrationFee,
    fee_type: feeType,
    gst_percent: gstPercent,
    payable_amount: payableAmount,
    fee_label:
      feeType === "exclusive_gst"
        ? `Rs ${payableAmount.toFixed(2)} (base Rs ${registrationFee.toFixed(
            2
          )} + GST ${gstPercent}%)`
        : `Rs ${registrationFee.toFixed(2)} (incl. GST)`
  };
}

function buildRegistrationNotes({ existingNotes, pricing }) {
  const notes = [];
  const normalizedNotes = normalizeText(existingNotes);

  if (normalizedNotes) {
    notes.push(normalizedNotes);
  }

  notes.push(
    `Fee snapshot: Rs ${pricing.registration_fee.toFixed(2)} | ${pricing.fee_type} | GST ${pricing.gst_percent}% | Payable Rs ${pricing.payable_amount.toFixed(2)}`
  );

  return notes.join("\n");
}

function appendRegistrationNote(existingNotes, line) {
  return [normalizeText(existingNotes), normalizeText(line)].filter(Boolean).join("\n");
}

function appendUniqueRegistrationNote(existingNotes, line) {
  const normalizedExisting = normalizeText(existingNotes) || "";
  const normalizedLine = normalizeText(line);

  if (!normalizedLine) {
    return normalizedExisting;
  }

  if (
    normalizedExisting
      .toLowerCase()
      .split("\n")
      .map((entry) => entry.trim())
      .includes(normalizedLine.toLowerCase())
  ) {
    return normalizedExisting;
  }

  return [normalizedExisting, normalizedLine].filter(Boolean).join("\n");
}

function extractRegistrationEmail(notes) {
  const normalizedNotes = normalizeText(notes) || "";
  const match = normalizedNotes.match(/Contact email:\s*(.+)/i);
  return match ? normalizeText(match[1]) : null;
}

function extractPaymentMethod(notes) {
  const normalizedNotes = normalizeText(notes) || "";
  const match = normalizedNotes.match(/Payment method:\s*(online|upi|bank_transfer|cash)/i);
  return match ? match[1].toLowerCase() : "online";
}

function toRegistrationResponse(registration, entry = null, participant = null) {
  const safeEntry = entry || {};
  const safeParticipant = participant || null;

  return {
    id: registration.id,
    tournament_id: registration.tournament_id,
    player_name: registration.player_name,
    age: registration.age,
    gender: registration.gender,
    phone_number: registration.phone_number,
    parent_name: registration.parent_name,
    payment_status: registration.payment_status,
    payment_proof_url: registration.payment_proof_url,
    payment_method: extractPaymentMethod(registration.notes),
    email: extractRegistrationEmail(registration.notes),
    notes: registration.notes,
    created_at: registration.created_at,
    updated_at: registration.updated_at,
    event: {
      entry_row_id: safeEntry.id || null,
      id: safeEntry.event_id || null,
      event_name: safeEntry.event_name || null,
      entry_type: safeEntry.entry_type || null,
      partner_name: safeEntry.partner_name || null,
      status: safeEntry.status || null
    },
    participant: safeParticipant
      ? {
          id: safeParticipant.id,
          display_name: safeParticipant.display_name || safeParticipant.team_name || null,
          status: safeParticipant.status || null
        }
      : null
  };
}

async function getTournamentEventsByName(tournamentId) {
  const { data: events, error } = await tournamentDb
    .from("events")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new AppError(error.message, 500);
  }

  return new Map((events || []).map((event) => [event.event_name, event]));
}

async function getRegistrationEventForEntry({ tournamentId, entry, requireRegistrationEnabled = false }) {
  const eventName = normalizeText(entry?.event_name);

  if (!eventName) {
    throw new AppError("Registration entry is missing event information", 400);
  }

  const eventMap = await getTournamentEventsByName(tournamentId);
  const event = eventMap.get(eventName);

  if (!event) {
    throw new AppError("Event not found for registration", 404);
  }

  const registration = buildRegistrationSnapshot(event);

  if (requireRegistrationEnabled && !registration.registration_enabled) {
    throw new AppError("Registration is not open for the selected event", 400);
  }

  return {
    ...event,
    registration
  };
}

function buildRegistrationParticipantSeed(registration, entry) {
  const player1Name = normalizeText(registration?.player_name);
  const player2Name =
    normalizeText(entry?.entry_type)?.toLowerCase() === "doubles"
      ? normalizeText(entry?.partner_name)
      : null;
  const player1Id = buildExternalPlayerId(player1Name);
  const player2Id = buildExternalPlayerId(player2Name);

  return {
    player1Name,
    player2Name,
    player1Id,
    player2Id,
    teamKey: canonicalTeamKey(player1Id, player2Id)
  };
}

function findExistingRegistrationParticipantRecord({ participants, registration, entry }) {
  const seed = buildRegistrationParticipantSeed(registration, entry);

  if (!seed.teamKey) {
    return null;
  }

  return (
    (participants || []).find(
      (participant) =>
        canonicalTeamKey(participant.player1_id, participant.player2_id) === seed.teamKey
    ) || null
  );
}

async function listRegistrationEnabledEvents(tournamentId) {
  const { data: events, error } = await tournamentDb
    .from("events")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new AppError(error.message, 500);
  }

  return (events || [])
    .map((event) => ({
      ...event,
      registration: buildRegistrationSnapshot(event)
    }))
    .filter((event) => event.registration.registration_enabled);
}

async function ensureRegistrationEvent({ tournamentId, eventId }) {
  const { data: event, error } = await tournamentDb
    .from("events")
    .select("*")
    .eq("id", eventId)
    .eq("tournament_id", tournamentId)
    .maybeSingle();

  if (error) {
    throw new AppError(error.message, 500);
  }

  if (!event) {
    throw new AppError("Selected event was not found for this tournament", 404);
  }

  const registration = buildRegistrationSnapshot(event);
  if (!registration.registration_enabled) {
    throw new AppError("Registration is not open for the selected event", 400);
  }

  return {
    ...event,
    registration
  };
}

async function ensureNoDuplicateRegistration({
  tournamentId,
  eventName,
  playerName,
  phoneNumber
}) {
  const playerKey = normalizeRegistrationPlayerKey(playerName, phoneNumber);
  const { data: registrations, error } = await tournamentDb
    .from("registrations")
    .select("id,player_name,phone_number,tournament_id")
    .eq("tournament_id", tournamentId);

  if (error) {
    throw new AppError(error.message, 500);
  }

  if (!registrations?.length) {
    return;
  }

  const matchingRegistrations = registrations
    .filter(
      (registration) =>
        normalizeRegistrationPlayerKey(
          registration.player_name,
          registration.phone_number
        ) === playerKey
    )
    .map((registration) => registration.id);

  if (!matchingRegistrations.length) {
    return;
  }

  const { data: entries, error: entryError } = await tournamentDb
    .from("registration_entries")
    .select("registration_id,event_name")
    .in("registration_id", matchingRegistrations)
    .eq("event_name", eventName);

  if (entryError) {
    throw new AppError(entryError.message, 500);
  }

  if ((entries || []).length) {
    throw new AppError("Player already registered for this event", 409);
  }
}

async function getRegistrationWithEntry({ tournamentId, registrationId }) {
  const { data: registration, error: registrationError } = await tournamentDb
    .from("registrations")
    .select("*")
    .eq("id", registrationId)
    .eq("tournament_id", tournamentId)
    .maybeSingle();

  if (registrationError) {
    throw new AppError(registrationError.message, 500);
  }

  if (!registration) {
    throw new AppError("Registration not found for tournament", 404);
  }

  const { data: entry, error: entryError } = await tournamentDb
    .from("registration_entries")
    .select("*")
    .eq("registration_id", registrationId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (entryError) {
    throw new AppError(entryError.message, 500);
  }

  return { registration, entry };
}

async function syncRegistrationEntryToParticipant({
  tournamentId,
  registration,
  entry,
  event
}) {
  if (!entry) {
    throw new AppError("Registration entry not found", 404);
  }

  const { data: existingParticipants, error: participantsError } = await tournamentDb
    .from("participants")
    .select("*")
    .eq("tournament_id", tournamentId)
    .eq("event_id", event.id);

  if (participantsError) {
    throw new AppError(participantsError.message, 500);
  }

  let participant = findExistingRegistrationParticipantRecord({
    participants: existingParticipants || [],
    registration,
    entry
  });
  let participantCreated = false;

  if (!participant) {
    participant = await registerParticipantForEvent({
      tournamentId,
      eventId: event.id,
      input: {
        player1_name: registration.player_name,
        player2_name:
          normalizeText(entry.entry_type)?.toLowerCase() === "doubles"
            ? entry.partner_name
            : null,
        status: "active",
        metadata: {
          source: "public_registration",
          registration_id: registration.id,
          registration_entry_id: entry.id
        }
      }
    });
    participantCreated = true;
  }

  const { data: updatedEntry, error: entryUpdateError } = await tournamentDb
    .from("registration_entries")
    .update({
      status: "approved"
    })
    .eq("id", entry.id)
    .eq("registration_id", registration.id)
    .select("*")
    .single();

  if (entryUpdateError) {
    throw new AppError(entryUpdateError.message, 500);
  }

  const [enrichedParticipant] = await enrichParticipantsWithDisplayNames([participant]);

  return {
    participant: enrichedParticipant || participant,
    participantCreated,
    updatedEntry: {
      ...updatedEntry,
      event_id: event.id
    }
  };
}

export async function listRegistrationEventOptions(tournamentLookup) {
  const tournament = await ensureTournamentByLookup(tournamentLookup);
  const events = await listRegistrationEnabledEvents(tournament.id);

  return {
    tournament_id: tournament.id,
    events: events.map((event) => event.registration)
  };
}

export async function createTournamentRegistration({ tournamentLookup, input }) {
  const tournament = await ensureTournamentByLookup(tournamentLookup);
  const eventId = normalizeText(input.event_id);
  const playerName = normalizeText(input.player_name);
  const age = normalizeInteger(input.age, { allowNull: true, min: 1, max: 99 });
  const phoneNumber = normalizeText(input.phone_number);
  const parentName = normalizeText(input.parent_name);
  const paymentProofUrl = normalizeText(input.payment_proof_url);
  const paymentMethod = normalizePaymentMethod(input.payment_method);
  const rawNotes = normalizeText(input.notes);
  const gender = normalizeGender(input.gender);
  const email = normalizeText(input.email)?.toLowerCase();

  if (!eventId) {
    throw new AppError("event_id is required", 400);
  }

  if (!playerName) {
    throw new AppError("player_name is required", 400);
  }

  if (Number.isNaN(age)) {
    throw new AppError("age must be a valid whole number", 400);
  }

  if (!email) {
    throw new AppError("email is required", 400);
  }

  const event = await ensureRegistrationEvent({
    tournamentId: tournament.id,
    eventId
  });

  const partnerName =
    event.registration.entry_type === "doubles"
      ? normalizeText(input.partner_name)
      : null;

  if (event.registration.entry_type === "doubles" && !partnerName) {
    throw new AppError("partner_name is required for doubles registration", 400);
  }

  await ensureNoDuplicateRegistration({
    tournamentId: tournament.id,
    eventName: event.event_name,
    playerName,
    phoneNumber
  });

  const registrationPayload = {
    tournament_id: tournament.id,
    player_name: playerName,
    age,
    gender,
    phone_number: phoneNumber,
    parent_name: parentName,
    payment_status: "pending",
    payment_proof_url: paymentProofUrl,
    notes: appendRegistrationNote(
      appendRegistrationNote(
        buildRegistrationNotes({
          existingNotes: rawNotes,
          pricing: event.registration
        }),
        `Contact email: ${email}`
      ),
      `Payment method: ${paymentMethod}`
    )
  };

  const { data: registration, error: registrationError } = await tournamentDb
    .from("registrations")
    .insert(registrationPayload)
    .select("*")
    .single();

  if (registrationError) {
    throw new AppError(registrationError.message, 500);
  }

  const entryPayload = {
    registration_id: registration.id,
    event_name: event.event_name,
    entry_type: event.registration.entry_type,
    partner_name: partnerName,
    status: "submitted"
  };

  const { data: entryRow, error: entryError } = await tournamentDb
    .from("registration_entries")
    .insert(entryPayload)
    .select("*")
    .single();

  if (entryError) {
    throw new AppError(entryError.message, 500);
  }

  const registrationResponse = toRegistrationResponse(
    registration,
    {
      ...entryRow,
      event_id: event.id
    }
  );

  triggerBackgroundEmail(
    sendRegistrationReceivedEmail({
      to: email,
      tournament,
      registration: registrationResponse,
      event: registrationResponse.event,
      pricing: event.registration
    })
  );

  return {
    message: "Registration submitted successfully",
    registration: registrationResponse,
    pricing: event.registration,
    email_delivery: {
      sent: false,
      reason: "queued"
    }
  };
}

export async function createRegistrationPaymentOrder({
  tournamentLookup,
  registrationId
}) {
  if (!hasRazorpayConfig() || !razorpay) {
    throw new AppError("Online payments are not configured", 503);
  }

  const tournament = await ensureTournamentByLookup(tournamentLookup);
  const { registration, entry } = await getRegistrationWithEntry({
    tournamentId: tournament.id,
    registrationId
  });

  if (extractPaymentMethod(registration.notes) !== "online") {
    throw new AppError("This registration is not using online payment", 400);
  }

  const event = await ensureRegistrationEvent({
    tournamentId: tournament.id,
    eventId: entry?.event_id || null
  }).catch(async () => {
    const { data: events, error } = await tournamentDb
      .from("events")
      .select("*")
      .eq("tournament_id", tournament.id)
      .eq("event_name", entry?.event_name)
      .limit(1);

    if (error) {
      throw new AppError(error.message, 500);
    }

    const fallbackEvent = events?.[0];
    if (!fallbackEvent) {
      throw new AppError("Event not found for payment", 404);
    }

    return {
      ...fallbackEvent,
    registration: buildRegistrationSnapshot(fallbackEvent)
      };
    });

  const payableAmount = event.registration.payable_amount;

  if (payableAmount <= 0) {
    let updatedNotes = appendRegistrationNote(
      registration.notes,
      "Online payment skipped because payable amount is zero."
    );

    const { data: updatedRegistration, error: updateError } = await tournamentDb
      .from("registrations")
      .update({
        payment_status: "paid",
        notes: updatedNotes,
        updated_at: new Date().toISOString()
      })
      .eq("id", registrationId)
      .select("*")
      .single();

    if (updateError) {
      throw new AppError(updateError.message, 500);
    }

    const participantSync = await syncRegistrationEntryToParticipant({
      tournamentId: tournament.id,
      registration: updatedRegistration,
      entry,
      event
    });

    updatedNotes = appendUniqueRegistrationNote(
      updatedRegistration.notes,
      participantSync.participantCreated
        ? `Online payment auto-added to participants: ${participantSync.participant.id}`
        : `Online payment matched existing participant: ${participantSync.participant.id}`
    );

    let finalRegistration = updatedRegistration;

    if (updatedNotes !== (updatedRegistration.notes || "")) {
      const { data: notedRegistration, error: notesUpdateError } = await tournamentDb
        .from("registrations")
        .update({
          notes: updatedNotes,
          updated_at: new Date().toISOString()
        })
        .eq("id", registrationId)
        .select("*")
        .single();

      if (notesUpdateError) {
        throw new AppError(notesUpdateError.message, 500);
      }

      finalRegistration = notedRegistration;
    }

    const updatedResponse = toRegistrationResponse(
      finalRegistration,
      participantSync.updatedEntry,
      participantSync.participant
    );
    const emailAddress = updatedResponse.email;
    let emailDelivery = { sent: false, reason: "missing_email" };

    if (emailAddress) {
      emailDelivery = await sendPaymentConfirmedEmail({
        to: emailAddress,
        tournament,
        registration: updatedResponse,
        event: updatedResponse.event,
        pricing: event.registration
      });
    }

    return {
      zero_amount: true,
      key_id: env.RAZORPAY_KEY_ID,
      amount: 0,
      currency: "INR",
      registration: updatedResponse,
      pricing: event.registration,
      email_delivery: emailDelivery
    };
  }

  const order = await razorpay.orders.create({
    amount: Math.round(payableAmount * 100),
    currency: "INR",
    receipt: String(registrationId).slice(0, 40),
    notes: {
      tournament_id: tournament.id,
      registration_id: registrationId,
      event_name: entry?.event_name || event.event_name || ""
    }
  });

  const updatedNotes = appendRegistrationNote(
    registration.notes,
    `Online payment order created: ${order.id}`
  );

  const { error: updateError } = await tournamentDb
    .from("registrations")
    .update({
      notes: updatedNotes,
      updated_at: new Date().toISOString()
    })
    .eq("id", registrationId);

  if (updateError) {
    throw new AppError(updateError.message, 500);
  }

  return {
    key_id: env.RAZORPAY_KEY_ID,
    order_id: order.id,
    amount: order.amount,
    currency: order.currency,
    registration_id: registrationId,
    pricing: event.registration,
    player_name: registration.player_name,
    event_name: entry?.event_name || event.event_name
  };
}

export async function verifyRegistrationPayment({
  tournamentLookup,
  registrationId,
  input
}) {
  if (!hasRazorpayConfig()) {
    throw new AppError("Online payments are not configured", 503);
  }

  const tournament = await ensureTournamentByLookup(tournamentLookup);
  const { registration, entry } = await getRegistrationWithEntry({
    tournamentId: tournament.id,
    registrationId
  });

  const razorpayOrderId = normalizeText(input.razorpay_order_id);
  const razorpayPaymentId = normalizeText(input.razorpay_payment_id);
  const razorpaySignature = normalizeText(input.razorpay_signature);

  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    throw new AppError(
      "razorpay_order_id, razorpay_payment_id, and razorpay_signature are required",
      400
    );
  }

  const body = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expectedSignature = crypto
    .createHmac("sha256", env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest("hex");

  if (expectedSignature !== razorpaySignature) {
    throw new AppError("Invalid payment signature", 400);
  }

  const updatedNotes = appendRegistrationNote(
    registration.notes,
    `Online payment verified: order ${razorpayOrderId}, payment ${razorpayPaymentId}`
  );

  const { data: updatedRegistration, error: updateError } = await tournamentDb
    .from("registrations")
    .update({
      payment_status: "paid",
      notes: updatedNotes,
      updated_at: new Date().toISOString()
    })
    .eq("id", registrationId)
    .select("*")
    .single();

  if (updateError) {
    throw new AppError(updateError.message, 500);
  }

  const event = await getRegistrationEventForEntry({
    tournamentId: tournament.id,
    entry
  });

  const participantSync = await syncRegistrationEntryToParticipant({
    tournamentId: tournament.id,
    registration: updatedRegistration,
    entry,
    event
  });

  const participantNote = appendUniqueRegistrationNote(
    updatedRegistration.notes,
    participantSync.participantCreated
      ? `Online payment auto-added to participants: ${participantSync.participant.id}`
      : `Online payment matched existing participant: ${participantSync.participant.id}`
  );

  let finalRegistration = updatedRegistration;

  if (participantNote !== (updatedRegistration.notes || "")) {
    const { data: notedRegistration, error: notesUpdateError } = await tournamentDb
      .from("registrations")
      .update({
        notes: participantNote,
        updated_at: new Date().toISOString()
      })
      .eq("id", registrationId)
      .select("*")
      .single();

    if (notesUpdateError) {
      throw new AppError(notesUpdateError.message, 500);
    }

    finalRegistration = notedRegistration;
  }

  const updatedResponse = toRegistrationResponse(
    finalRegistration,
    participantSync.updatedEntry,
    participantSync.participant
  );
  const emailAddress = updatedResponse.email;
  let emailDelivery = { sent: false, reason: "missing_email" };

  if (emailAddress) {
    emailDelivery = await sendPaymentConfirmedEmail({
      to: emailAddress,
      tournament,
      registration: updatedResponse,
      event: updatedResponse.event,
      pricing: event.registration
    });
  }

  return {
    message: "Payment verified successfully",
    registration: updatedResponse,
    email_delivery: emailDelivery
  };
}

export async function listTournamentRegistrations(tournamentId) {
  await ensureTournamentExists(tournamentId);

  const { data: registrations, error } = await tournamentDb
    .from("registrations")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new AppError(error.message, 500);
  }

  const registrationIds = (registrations || []).map((registration) => registration.id);

  let entryRows = [];
  if (registrationIds.length) {
    const { data, error: entryError } = await tournamentDb
      .from("registration_entries")
      .select("*")
      .in("registration_id", registrationIds)
      .order("created_at", { ascending: true });

    if (entryError) {
      throw new AppError(entryError.message, 500);
    }

    entryRows = data || [];
  }

  const eventMap = await getTournamentEventsByName(tournamentId);
  const entryByRegistration = new Map();

  for (const entry of entryRows) {
    if (!entryByRegistration.has(entry.registration_id)) {
      entryByRegistration.set(entry.registration_id, {
        ...entry,
        event_id: eventMap.get(entry.event_name)?.id || null
      });
    }
  }

  const eventIds = [...new Set(
    [...entryByRegistration.values()].map((entry) => entry.event_id).filter(Boolean)
  )];
  let participants = [];

  if (eventIds.length) {
    const { data, error: participantsError } = await tournamentDb
      .from("participants")
      .select("*")
      .eq("tournament_id", tournamentId)
      .in("event_id", eventIds);

    if (participantsError) {
      throw new AppError(participantsError.message, 500);
    }

    participants = await enrichParticipantsWithDisplayNames(data || []);
  }

  const participantsByEventId = participants.reduce((map, participant) => {
    if (!map.has(participant.event_id)) {
      map.set(participant.event_id, []);
    }

    map.get(participant.event_id).push(participant);
    return map;
  }, new Map());

  return (registrations || []).map((registration) => {
    const entry = entryByRegistration.get(registration.id) || null;
    const participant =
      entry?.event_id
        ? findExistingRegistrationParticipantRecord({
            participants: participantsByEventId.get(entry.event_id) || [],
            registration,
            entry
          })
        : null;

    return toRegistrationResponse(registration, entry, participant);
  });
}

export async function updateTournamentRegistration({
  tournamentId,
  registrationId,
  input
}) {
  const tournament = await ensureTournamentExists(tournamentId);

  const { data: registration, error: registrationError } = await tournamentDb
    .from("registrations")
    .select("*")
    .eq("id", registrationId)
    .eq("tournament_id", tournamentId)
    .maybeSingle();

  if (registrationError) {
    throw new AppError(registrationError.message, 500);
  }

  if (!registration) {
    throw new AppError("Registration not found for tournament", 404);
  }

  const updatePayload = {
    payment_status: normalizePaymentStatus(input.payment_status, registration.payment_status),
    payment_proof_url:
      normalizeText(input.payment_proof_url) ?? registration.payment_proof_url,
    notes: normalizeText(input.notes) ?? registration.notes,
    updated_at: new Date().toISOString()
  };

  const { data: updatedRegistration, error: updateError } = await tournamentDb
    .from("registrations")
    .update(updatePayload)
    .eq("id", registrationId)
    .select("*")
    .single();

  if (updateError) {
    throw new AppError(updateError.message, 500);
  }

  if (Array.isArray(input.entries) && input.entries.length) {
    for (const entry of input.entries) {
      const entryId = normalizeText(entry.id);
      if (!entryId) {
        throw new AppError("entry id is required when updating entry statuses", 400);
      }

      const { error: entryError } = await tournamentDb
        .from("registration_entries")
        .update({
          status: normalizeEntryStatus(entry.status)
        })
        .eq("id", entryId)
        .eq("registration_id", registrationId);

      if (entryError) {
        throw new AppError(entryError.message, 500);
      }
    }
  }

  const { data: updatedEntry, error: entriesError } = await tournamentDb
    .from("registration_entries")
    .select("*")
    .eq("registration_id", registrationId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (entriesError) {
    throw new AppError(entriesError.message, 500);
  }

  const event = updatedEntry
    ? await getRegistrationEventForEntry({
        tournamentId,
        entry: updatedEntry
      }).catch(() => null)
    : null;
  const eventId = event?.id || null;
  const response = toRegistrationResponse(
    updatedRegistration,
    updatedEntry ? { ...updatedEntry, event_id: eventId } : null
  );
  const emailAddress = response.email;
  let emailDelivery = null;

  if (emailAddress) {
    const decision =
      updatedEntry?.status && updatedEntry.status !== "submitted" ? updatedEntry.status : null;

    if (decision) {
      emailDelivery = await sendRegistrationDecisionEmail({
        to: emailAddress,
        tournament,
        registration: response,
        event: response.event,
        decision
      });
    } else if (
      registration.payment_status !== updatedRegistration.payment_status &&
      updatedRegistration.payment_status === "paid"
    ) {
      emailDelivery = await sendPaymentConfirmedEmail({
        to: emailAddress,
        tournament,
        registration: response,
        event: response.event,
        pricing: event?.registration || null
      });
    }
  }

  return {
    ...response,
    email_delivery: emailDelivery
  };
}

export async function approveRegistrationToParticipant({
  tournamentId,
  registrationId,
  input = {}
}) {
  const tournament = await ensureTournamentExists(tournamentId);
  const { registration, entry } = await getRegistrationWithEntry({
    tournamentId,
    registrationId
  });

  if (!entry) {
    throw new AppError("Registration entry not found", 404);
  }

  const requestedPaymentStatus = normalizePaymentStatus(
    input.payment_status,
    registration.payment_status
  );

  if (requestedPaymentStatus !== "paid") {
    throw new AppError(
      "Only paid registrations can be approved into the participant list",
      409
    );
  }

  const event = await getRegistrationEventForEntry({
    tournamentId,
    entry
  });

  const participantSync = await syncRegistrationEntryToParticipant({
    tournamentId,
    registration,
    entry,
    event
  });
  const participant = participantSync.participant;
  const participantCreated = participantSync.participantCreated;

  const updatedNotes = appendRegistrationNote(
    normalizeText(input.notes) ?? registration.notes,
    participantCreated
      ? `Approved and added to participants: ${participant.id}`
      : `Participant already exists in event: ${participant.id}`
  );

  const { data: updatedRegistration, error: registrationUpdateError } = await tournamentDb
    .from("registrations")
    .update({
      payment_status: "paid",
      notes: updatedNotes,
      updated_at: new Date().toISOString()
    })
    .eq("id", registrationId)
    .select("*")
    .single();

  if (registrationUpdateError) {
    throw new AppError(registrationUpdateError.message, 500);
  }

  const response = toRegistrationResponse(
    updatedRegistration,
    participantSync.updatedEntry,
    participant
  );
  const emailAddress = response.email;
  let emailDelivery = null;

  if (emailAddress) {
    emailDelivery = await sendRegistrationDecisionEmail({
      to: emailAddress,
      tournament,
      registration: response,
      event: response.event,
      decision: "approved"
    });
  }

  return {
    message: participantCreated
      ? "Registration approved and participant added"
      : "Registration already had a participant in this event",
    registration: response,
    participant_created: participantCreated,
    email_delivery: emailDelivery
  };
}
