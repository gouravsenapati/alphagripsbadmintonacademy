import express from "express";
import { auth } from "../../middleware/auth.middleware.js";
import {
  approveRegistrationParticipantHandler,
  assignCourtRefereeHandler,
  assignCourtHandler,
  claimRefereeCourtHandler,
  completeMatchHandler,
  completeRefereeMatchHandler,
  createTournamentStaffHandler,
  createCourtHandler,
  createEventHandler,
  updateEventHandler,
  createTournamentHandler,
  deleteTournamentStaffHandler,
  updateTournamentHandler,
  deleteTournamentHandler,
  getTournamentStaffMetaHandler,
  generateDrawHandler,
  getRefereeDashboardHandler,
  getRefereeMatchSetsHandler,
  getMatchSetsHandler,
  getTournamentOverviewHandler,
  listRegistrationsHandler,
  listCourtsHandler,
  listMatchesHandler,
  listParticipantsHandler,
  listRefereesHandler,
  listReadyMatchesHandler,
  listTournamentStaffHandler,
  listTournamentsHandler,
  processByesHandler,
  registerParticipantForTournamentEventHandler,
  releaseRefereeCourtHandler,
  runSchedulerHandler,
  startRefereeMatchHandler,
  startMatchHandler,
  updateTournamentStaffHandler,
  updateRegistrationHandler,
  updateRefereeMatchSetsHandler,
  updateMatchSetsHandler
} from "./controllers/tournaments.controller.js";

const router = express.Router();

router.get("/referee/dashboard", auth, getRefereeDashboardHandler);
router.post("/referee/courts/:courtId/claim", auth, claimRefereeCourtHandler);
router.post("/referee/courts/:courtId/release", auth, releaseRefereeCourtHandler);
router.post("/referee/matches/:matchId/start", auth, startRefereeMatchHandler);
router.get("/referee/matches/:matchId/sets", auth, getRefereeMatchSetsHandler);
router.put("/referee/matches/:matchId/sets", auth, updateRefereeMatchSetsHandler);
router.post("/referee/matches/:matchId/complete", auth, completeRefereeMatchHandler);

router.get("/", auth, listTournamentsHandler);
router.post("/", auth, createTournamentHandler);
router.get("/staff/meta", auth, getTournamentStaffMetaHandler);
router.get("/staff", auth, listTournamentStaffHandler);
router.post("/staff", auth, createTournamentStaffHandler);
router.patch("/staff/:userId", auth, updateTournamentStaffHandler);
router.delete("/staff/:userId", auth, deleteTournamentStaffHandler);
router.patch("/:tournamentId", auth, updateTournamentHandler);
router.delete("/:tournamentId", auth, deleteTournamentHandler);

router.get("/:tournamentId/overview", auth, getTournamentOverviewHandler);
router.get("/:tournamentId/courts", auth, listCourtsHandler);
router.get("/:tournamentId/referees", auth, listRefereesHandler);
router.get("/:tournamentId/registrations", auth, listRegistrationsHandler);
router.patch(
  "/:tournamentId/registrations/:registrationId",
  auth,
  updateRegistrationHandler
);
router.post(
  "/:tournamentId/registrations/:registrationId/approve-participant",
  auth,
  approveRegistrationParticipantHandler
);
router.post("/:tournamentId/events", auth, createEventHandler);
router.patch("/:tournamentId/events/:eventId", auth, updateEventHandler);
router.post("/:tournamentId/courts", auth, createCourtHandler);
router.put("/:tournamentId/courts/:courtId/referee", auth, assignCourtRefereeHandler);

router.get(
  "/:tournamentId/events/:eventId/participants",
  auth,
  listParticipantsHandler
);
router.post(
  "/:tournamentId/events/:eventId/participants",
  auth,
  registerParticipantForTournamentEventHandler
);

router.get("/:tournamentId/ready-matches", auth, listReadyMatchesHandler);
router.get("/:tournamentId/matches", auth, listMatchesHandler);
router.post(
  "/:tournamentId/events/:eventId/draw/generate",
  auth,
  generateDrawHandler
);
router.post("/:tournamentId/byes/process", auth, processByesHandler);
router.post("/:tournamentId/scheduler/run", auth, runSchedulerHandler);

router.post("/matches/:matchId/assign-court", auth, assignCourtHandler);
router.post("/matches/:matchId/start", auth, startMatchHandler);
router.get("/matches/:matchId/sets", auth, getMatchSetsHandler);
router.put("/matches/:matchId/sets", auth, updateMatchSetsHandler);
router.post("/matches/:matchId/complete", auth, completeMatchHandler);

export default router;
