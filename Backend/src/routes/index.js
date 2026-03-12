import express from "express";

import authRoutes from "../modules/auth/auth.routes.js";
import { auth } from "../middleware/auth.middleware.js";
import { requireAcademyPortalAccess } from "../middleware/portalAccess.middleware.js";
import academiesRoutes from "../modules/academies/academies.routes.js";
import playersRoutes from "../modules/players/players.routes.js";
import categoriesRoutes from "../modules/categories/categories.routes.js";
import eventsRoutes from "../modules/events/events.routes.js";
import matchesRoutes from "../modules/matches/matches.routes.js";
import rankingsRoutes from "../modules/rankings/rankings.routes.js";
import financeRoutes from "../modules/finance/finance.routes.js";
import batchesRoutes from "../modules/batches/batches.routes.js";
import batchSessionsRoutes from "../modules/batchSessions/batchSessions.routes.js";
import playerBatchesRoutes from "../modules/playerBatches/playerBatches.routes.js";
import usersRoutes from "../modules/users/users.routes.js";
import tournamentsRoutes from "../modules/tournaments/tournaments.routes.js";
import publicTournamentsRoutes from "../modules/tournaments/publicTournaments.routes.js";
import attendanceRoutes from "../modules/attendance/attendance.routes.js";
import fitnessRoutes from "../modules/fitness/fitness.routes.js";
import academyMatchesRoutes from "../modules/academyMatches/academyMatches.routes.js";
import publicRoutes from "../modules/public/public.routes.js";
import categoryFeePlansRoutes from "../modules/categoryFeePlans/categoryFeePlans.routes.js";
import invoicesRoutes from "../modules/invoices/invoices.routes.js";
import invoicePaymentsRoutes from "../modules/invoicePayments/invoicePayments.routes.js";
import receiptsRoutes from "../modules/receipts/receipts.routes.js";
import parentPortalRoutes from "../modules/parentPortal/parentPortal.routes.js";

const router = express.Router();

router.use("/auth",authRoutes);
router.use("/academies", auth, requireAcademyPortalAccess, academiesRoutes);
router.use("/players", auth, requireAcademyPortalAccess, playersRoutes);
router.use("/users", auth, requireAcademyPortalAccess, usersRoutes);
router.use("/categories", auth, requireAcademyPortalAccess, categoriesRoutes);
router.use("/events",eventsRoutes);
router.use("/matches",matchesRoutes);
router.use("/rankings", auth, requireAcademyPortalAccess, rankingsRoutes);
router.use("/finance", auth, requireAcademyPortalAccess, financeRoutes);
router.use("/batches", auth, requireAcademyPortalAccess, batchesRoutes);
router.use("/batch-sessions", auth, requireAcademyPortalAccess, batchSessionsRoutes);
router.use("/player-batches", auth, requireAcademyPortalAccess, playerBatchesRoutes);
router.use("/attendance", auth, requireAcademyPortalAccess, attendanceRoutes);
router.use("/fitness", auth, requireAcademyPortalAccess, fitnessRoutes);
router.use("/academy-matches", auth, requireAcademyPortalAccess, academyMatchesRoutes);
router.use("/category-fee-plans", auth, requireAcademyPortalAccess, categoryFeePlansRoutes);
router.use("/invoices", auth, requireAcademyPortalAccess, invoicesRoutes);
router.use("/invoice-payments", auth, requireAcademyPortalAccess, invoicePaymentsRoutes);
router.use("/receipts", auth, requireAcademyPortalAccess, receiptsRoutes);
router.use("/parent", parentPortalRoutes);
router.use("/tournaments", tournamentsRoutes);
router.use("/public/tournaments", publicTournamentsRoutes);
router.use("/public", publicRoutes);


export default router;
