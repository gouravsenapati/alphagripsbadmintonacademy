import { api } from "./api.js";

function buildQuery(params = {}) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") {
      searchParams.set(key, value);
    }
  }

  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

export const tournamentApi = {
  listTournaments() {
    return api.get("/tournaments");
  },

  getTournamentStaffMeta(tournamentId) {
    return api.get(`/tournaments/staff/meta${buildQuery({ tournamentId })}`);
  },

  listTournamentStaff(tournamentId) {
    return api.get(`/tournaments/staff${buildQuery({ tournamentId })}`);
  },

  createTournamentStaff(payload) {
    return api.post("/tournaments/staff", payload);
  },

  updateTournamentStaff(userId, payload) {
    return api.patch(`/tournaments/staff/${userId}`, payload);
  },

  deleteTournamentStaff(userId, tournamentId) {
    return api.delete(`/tournaments/staff/${userId}${buildQuery({ tournamentId })}`);
  },

  listPlayers() {
    return api.get("/players");
  },

  createTournament(payload) {
    return api.post("/tournaments", payload);
  },

  updateTournament(tournamentId, payload) {
    return api.patch(`/tournaments/${tournamentId}`, payload);
  },

  deleteTournament(tournamentId) {
    return api.delete(`/tournaments/${tournamentId}`);
  },

  getOverview(tournamentId) {
    return api.get(`/tournaments/${tournamentId}/overview`);
  },

  listCourts(tournamentId) {
    return api.get(`/tournaments/${tournamentId}/courts`);
  },

  listReferees(tournamentId) {
    return api.get(`/tournaments/${tournamentId}/referees`);
  },

  createEvent(tournamentId, payload) {
    return api.post(`/tournaments/${tournamentId}/events`, payload);
  },

  updateEvent(tournamentId, eventId, payload) {
    return api.patch(`/tournaments/${tournamentId}/events/${eventId}`, payload);
  },

  listRegistrations(tournamentId) {
    return api.get(`/tournaments/${tournamentId}/registrations`);
  },

  updateRegistration(tournamentId, registrationId, payload) {
    return api.patch(`/tournaments/${tournamentId}/registrations/${registrationId}`, payload);
  },

  approveRegistrationParticipant(tournamentId, registrationId, payload) {
    return api.post(
      `/tournaments/${tournamentId}/registrations/${registrationId}/approve-participant`,
      payload
    );
  },

  createCourt(tournamentId, payload) {
    return api.post(`/tournaments/${tournamentId}/courts`, payload);
  },

  assignCourtReferee(tournamentId, courtId, payload) {
    return api.put(`/tournaments/${tournamentId}/courts/${courtId}/referee`, payload);
  },

  listParticipants(tournamentId, eventId) {
    return api.get(`/tournaments/${tournamentId}/events/${eventId}/participants`);
  },

  registerParticipant(eventId, payload) {
    return api.post(`/events/${eventId}/register-participant`, payload);
  },

  listReadyMatches(tournamentId, params = {}) {
    return api.get(`/tournaments/${tournamentId}/ready-matches${buildQuery(params)}`);
  },

  listMatches(tournamentId, params = {}) {
    return api.get(`/tournaments/${tournamentId}/matches${buildQuery(params)}`);
  },

  generateDraw(tournamentId, eventId, payload) {
    return api.post(`/tournaments/${tournamentId}/events/${eventId}/draw/generate`, payload);
  },

  processByes(tournamentId, payload) {
    return api.post(`/tournaments/${tournamentId}/byes/process`, payload);
  },

  runScheduler(tournamentId, payload) {
    return api.post(`/tournaments/${tournamentId}/scheduler/run`, payload);
  },

  assignCourt(matchId, payload) {
    return api.post(`/matches/${matchId}/assign-court`, payload);
  },

  startMatch(matchId) {
    return api.post(`/matches/${matchId}/start`, {});
  },

  getMatchSets(matchId) {
    return api.get(`/matches/${matchId}/sets`);
  },

  updateMatchSets(matchId, payload) {
    return api.put(`/matches/${matchId}/sets`, payload);
  },

  completeMatch(matchId, payload) {
    return api.post(`/matches/${matchId}/complete`, payload);
  }
};
