import supabase from "../../../config/db.js";
import {
  AppError,
  formatExternalPlayerName,
  isExternalPlayerId,
  normalizeText,
  uniqueValues
} from "../utils/tournament.utils.js";

function buildGeneratedTeamName(participant) {
  const ids = [participant?.player1_id, participant?.player2_id]
    .map((value) => formatExternalPlayerName(value) || normalizeText(value))
    .filter(Boolean);

  if (!ids.length) {
    return null;
  }

  return ids.join(" / ");
}

function isGeneratedLabel(teamName, participant) {
  const normalizedTeamName = normalizeText(teamName);

  if (!normalizedTeamName) {
    return true;
  }

  return [
    buildGeneratedTeamName(participant),
    normalizeText(participant?.player1_id),
    normalizeText(participant?.player2_id)
  ]
    .filter(Boolean)
    .includes(normalizedTeamName);
}

export async function fetchPlayerNameMap(playerIds) {
  const ids = uniqueValues((playerIds || []).map((value) => normalizeText(value))).filter(
    (value) => !isExternalPlayerId(value)
  );

  if (!ids.length) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("players_view")
    .select("id,name")
    .in("id", ids);

  // Tournament draws should still render even when the academy players view is unavailable.
  if (error) {
    console.error("[tournament] player name lookup fallback:", error.message);
    return new Map();
  }

  return new Map(
    (data || []).map((player) => [String(player.id), normalizeText(player.name) || String(player.id)])
  );
}

export function resolveParticipantDisplayName(
  participant,
  playerNameMap = new Map()
) {
  if (!participant) {
    return null;
  }

  const savedLabel = normalizeText(participant.display_name || participant.team_name);
  const playerNames = [participant.player1_id, participant.player2_id]
    .map((playerId) => {
      if (playerId === null || playerId === undefined) {
        return null;
      }

      return (
        playerNameMap.get(String(playerId)) ||
        formatExternalPlayerName(playerId) ||
        null
      );
    })
    .filter(Boolean);

  if (playerNames.length && isGeneratedLabel(savedLabel, participant)) {
    return playerNames.join(" / ");
  }

  return savedLabel || playerNames.join(" / ") || buildGeneratedTeamName(participant);
}

export async function enrichParticipantsWithDisplayNames(participants) {
  const list = participants || [];
  const playerNameMap = await fetchPlayerNameMap(
    list.flatMap((participant) => [participant.player1_id, participant.player2_id])
  );

  return list.map((participant) => ({
    ...participant,
    display_name: resolveParticipantDisplayName(participant, playerNameMap)
  }));
}

export async function buildParticipantDisplayMap(participants) {
  const enrichedParticipants = await enrichParticipantsWithDisplayNames(participants);

  return new Map(
    enrichedParticipants.map((participant) => [participant.id, participant.display_name])
  );
}
