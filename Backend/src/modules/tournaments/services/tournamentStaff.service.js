import bcrypt from "bcryptjs";
import supabase from "../../../config/db.js";
import { AppError, normalizeBoolean, normalizeText } from "../utils/tournament.utils.js";
import { ensureTournamentExists } from "./tournamentLookup.service.js";

const PASSWORD_SALT_ROUNDS = 10;
const TOURNAMENT_STAFF_MANAGER_ROLES = new Set([
  "super_admin",
  "academy_admin",
  "head_coach",
  "tournament_admin",
  "tournament_manager"
]);
const TOURNAMENT_ONLY_ROLE_NAMES = new Set([
  "tournament_admin",
  "tournament_manager",
  "tournament_staff",
  "referee",
  "tournament_referee",
  "court_official"
]);
const TOURNAMENT_USER_ASSIGNMENTS_TABLE = "tournament_user_assignments";

function getRoleName(req) {
  return normalizeText(req.user?.role || req.user?.role_name)?.toLowerCase() || null;
}

function ensureTournamentStaffManagerAccess(req) {
  if (!TOURNAMENT_STAFF_MANAGER_ROLES.has(String(getRoleName(req) || "").toLowerCase())) {
    throw new AppError(
      "You do not have permission to manage tournament-only users",
      403
    );
  }
}

function ensureTournamentHasAcademy(tournament) {
  const academyId = tournament?.academy_id ?? null;

  if (!academyId) {
    throw new AppError(
      "Tournament must be linked to an academy before tournament staff can be managed",
      400
    );
  }

  return academyId;
}

function isMissingTournamentStaffAssignmentsTable(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes(TOURNAMENT_USER_ASSIGNMENTS_TABLE) &&
    (
      message.includes("schema cache") ||
      message.includes("does not exist") ||
      message.includes("relation")
    )
  );
}

function throwTournamentStaffAssignmentsError(error) {
  if (isMissingTournamentStaffAssignmentsTable(error)) {
    throw new AppError(
      "Tournament staff assignment table is missing. Run Backend/sql/20260312_public_tournament_user_assignments.sql and retry",
      503
    );
  }

  throw new AppError(error.message, 500);
}

function ensureTournamentAcademyScope(req, academyId) {
  const currentRole = getRoleName(req);

  if (currentRole === "super_admin") {
    return;
  }

  if (String(req.user?.academy_id || "") !== String(academyId || "")) {
    throw new AppError(
      "You cannot manage tournament staff for another academy",
      403
    );
  }
}

async function ensureManagedTournamentContext(req, tournamentId) {
  ensureTournamentStaffManagerAccess(req);
  const tournament = await ensureTournamentExists(tournamentId);
  const academyId = ensureTournamentHasAcademy(tournament);
  ensureTournamentAcademyScope(req, academyId);

  return {
    tournament,
    academyId
  };
}

async function listTournamentUserAssignments({ tournamentId, academyId = null, userId = null } = {}) {
  let query = supabase
    .from(TOURNAMENT_USER_ASSIGNMENTS_TABLE)
    .select("id,tournament_id,academy_id,user_id,created_by,created_at")
    .eq("tournament_id", tournamentId);

  if (academyId !== null && academyId !== undefined) {
    query = query.eq("academy_id", academyId);
  }

  if (userId !== null && userId !== undefined) {
    query = query.eq("user_id", userId);
  }

  const { data, error } = await query;

  if (error) {
    throwTournamentStaffAssignmentsError(error);
  }

  return data || [];
}

async function createTournamentUserAssignment({
  tournamentId,
  academyId,
  userId,
  createdBy = null
}) {
  const { data, error } = await supabase
    .from(TOURNAMENT_USER_ASSIGNMENTS_TABLE)
    .insert({
      tournament_id: tournamentId,
      academy_id: academyId,
      user_id: userId,
      created_by: createdBy
    })
    .select("id,tournament_id,academy_id,user_id,created_by,created_at")
    .single();

  if (error) {
    throwTournamentStaffAssignmentsError(error);
  }

  return data;
}

async function ensureTournamentUserAssignment({ tournamentId, academyId, userId }) {
  const assignments = await listTournamentUserAssignments({
    tournamentId,
    academyId,
    userId
  });

  const assignment = assignments[0] || null;

  if (!assignment) {
    throw new AppError("Tournament user not found for selected tournament", 404);
  }

  return assignment;
}

async function deleteTournamentUserAssignment({ tournamentId, academyId, userId }) {
  let query = supabase
    .from(TOURNAMENT_USER_ASSIGNMENTS_TABLE)
    .delete()
    .eq("tournament_id", tournamentId)
    .eq("user_id", userId);

  if (academyId !== null && academyId !== undefined) {
    query = query.eq("academy_id", academyId);
  }

  const { error } = await query;

  if (error) {
    throwTournamentStaffAssignmentsError(error);
  }
}

async function countTournamentUserAssignmentsForUser(userId) {
  const { count, error } = await supabase
    .from(TOURNAMENT_USER_ASSIGNMENTS_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (error) {
    throwTournamentStaffAssignmentsError(error);
  }

  return Number(count || 0);
}

async function listRoleRows() {
  const { data, error } = await supabase
    .from("roles")
    .select("id,name")
    .order("name", { ascending: true });

  if (error) {
    throw new AppError(error.message, 500);
  }

  return data || [];
}

function filterTournamentRoleRows(roleRows) {
  return (roleRows || []).filter((role) =>
    TOURNAMENT_ONLY_ROLE_NAMES.has(String(role.name || "").toLowerCase())
  );
}

async function listAcademyById(academyId) {
  const { data, error } = await supabase
    .from("academies")
    .select("id,name,address")
    .eq("id", academyId)
    .maybeSingle();

  if (error) {
    throw new AppError(error.message, 500);
  }

  return data || null;
}

async function resolveRoleRow({ roleId = null, roleName = null }) {
  if (roleId) {
    const { data, error } = await supabase
      .from("roles")
      .select("id,name")
      .eq("id", Number(roleId))
      .maybeSingle();

    if (error) {
      throw new AppError(error.message, 500);
    }

    return data || null;
  }

  const normalizedRoleName = normalizeText(roleName);

  if (!normalizedRoleName) {
    return null;
  }

  const { data, error } = await supabase
    .from("roles")
    .select("id,name")
    .eq("name", normalizedRoleName)
    .maybeSingle();

  if (error) {
    throw new AppError(error.message, 500);
  }

  return data || null;
}

async function resolveManagedTournamentRoleRow({ roleId = null, roleName = null } = {}) {
  const roleRow = await resolveRoleRow({ roleId, roleName });

  if (!roleRow) {
    throw new AppError("Selected tournament role was not found", 404);
  }

  if (!TOURNAMENT_ONLY_ROLE_NAMES.has(String(roleRow.name || "").toLowerCase())) {
    throw new AppError("Only tournament-only roles can be assigned here", 400);
  }

  return roleRow;
}

async function ensureEmailAvailable({ email, excludeUserId = null } = {}) {
  if (!email) {
    return;
  }

  const { data, error } = await supabase
    .from("app_users")
    .select("id,email")
    .eq("email", email);

  if (error) {
    throw new AppError(error.message, 500);
  }

  const duplicate = (data || []).find(
    (user) => String(user.id) !== String(excludeUserId || "")
  );

  if (duplicate) {
    throw new AppError("A user with this email already exists", 409);
  }
}

async function getScopedTournamentUser({ tournamentId, userId, academyId }) {
  await ensureTournamentUserAssignment({ tournamentId, academyId, userId });

  const { data, error } = await supabase
    .from("app_users")
    .select("id,academy_id,role_id,name,email,phone,status,is_active,created_at,password_hash")
    .eq("id", userId)
    .eq("academy_id", academyId)
    .maybeSingle();

  if (error) {
    throw new AppError(error.message, 500);
  }

  if (!data) {
    throw new AppError("Tournament user not found", 404);
  }

  return data;
}

function buildRoleNameMap(roleRows) {
  return new Map((roleRows || []).map((role) => [String(role.id), role.name]));
}

function buildTournamentUserResponse(user, roleNameMap) {
  return {
    id: user.id,
    academy_id: user.academy_id,
    role_id: user.role_id,
    role_name: roleNameMap.get(String(user.role_id || "")) || null,
    name: user.name || null,
    email: user.email || null,
    phone: user.phone || null,
    status: user.status || null,
    is_active: Boolean(user.is_active),
    created_at: user.created_at || null
  };
}

export async function getTournamentStaffMeta({ req, tournamentId }) {
  const { tournament, academyId } = await ensureManagedTournamentContext(req, tournamentId);
  const [roleRows, academy] = await Promise.all([
    listRoleRows(),
    listAcademyById(academyId)
  ]);

  return {
    roles: filterTournamentRoleRows(roleRows),
    academy,
    tournament: {
      id: tournament.id,
      tournament_name: tournament.tournament_name,
      tournament_code: tournament.tournament_code,
      academy_id: academyId
    },
    current_role: getRoleName(req)
  };
}

export async function listTournamentStaffUsers({ req, tournamentId }) {
  const { academyId } = await ensureManagedTournamentContext(req, tournamentId);
  const assignments = await listTournamentUserAssignments({ tournamentId, academyId });

  if (!assignments.length) {
    return [];
  }

  const userIds = [...new Set(assignments.map((assignment) => assignment.user_id).filter(Boolean))];
  const { data, error } = await supabase
    .from("app_users")
    .select("id,academy_id,role_id,name,email,phone,status,is_active,created_at")
    .in("id", userIds)
    .eq("academy_id", academyId)
    .order("id", { ascending: false });

  if (error) {
    throw new AppError(error.message, 500);
  }

  const roleRows = await listRoleRows();
  const roleNameMap = buildRoleNameMap(roleRows);

  return (data || [])
    .map((user) => buildTournamentUserResponse(user, roleNameMap))
    .filter((user) =>
      TOURNAMENT_ONLY_ROLE_NAMES.has(String(user.role_name || "").toLowerCase())
    );
}

export async function createTournamentStaffUser({ req, tournamentId, payload }) {
  const { academyId } = await ensureManagedTournamentContext(req, tournamentId);
  const roleRow = await resolveManagedTournamentRoleRow({
    roleId: payload?.role_id,
    roleName: payload?.role_name
  });
  const name = normalizeText(payload?.name);
  const email = normalizeText(payload?.email)?.toLowerCase() || null;
  const phone = normalizeText(payload?.phone);
  const password = String(payload?.password || "");
  const status = normalizeText(payload?.status) || "active";
  const isActive = normalizeBoolean(payload?.is_active, true);

  if (!name) {
    throw new AppError("name is required", 400);
  }

  if (!email) {
    throw new AppError("email is required", 400);
  }

  if (!password.trim()) {
    throw new AppError("password is required", 400);
  }

  await ensureEmailAvailable({ email });
  const passwordHash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);

  const { data, error } = await supabase
    .from("app_users")
    .insert({
      academy_id: academyId,
      role_id: roleRow.id,
      name,
      email,
      phone,
      password_hash: passwordHash,
      status,
      is_active: isActive
    })
    .select("id,academy_id,role_id,name,email,phone,status,is_active,created_at")
    .single();

  if (error) {
    throw new AppError(error.message, 500);
  }

  try {
    await createTournamentUserAssignment({
      tournamentId,
      academyId,
      userId: data.id,
      createdBy: req.user?.id || null
    });
  } catch (assignmentError) {
    await supabase.from("app_users").delete().eq("id", data.id);
    throw assignmentError;
  }

  return buildTournamentUserResponse(data, new Map([[String(roleRow.id), roleRow.name]]));
}

export async function updateTournamentStaffUser({
  req,
  tournamentId,
  userId,
  payload
}) {
  const { academyId } = await ensureManagedTournamentContext(req, tournamentId);
  const existingUser = await getScopedTournamentUser({ tournamentId, userId, academyId });
  const existingRoleRow = await resolveRoleRow({ roleId: existingUser.role_id });

  if (!TOURNAMENT_ONLY_ROLE_NAMES.has(String(existingRoleRow?.name || "").toLowerCase())) {
    throw new AppError("Only tournament-only users can be managed here", 400);
  }

  const roleRow = payload?.role_id || payload?.role_name
    ? await resolveManagedTournamentRoleRow({
        roleId: payload?.role_id,
        roleName: payload?.role_name
      })
    : existingRoleRow;
  const name = normalizeText(payload?.name) || existingUser.name || null;
  const email = normalizeText(payload?.email)?.toLowerCase() || existingUser.email || null;
  const phone =
    payload?.phone !== undefined ? normalizeText(payload?.phone) : existingUser.phone || null;
  const status = normalizeText(payload?.status) || existingUser.status || "active";
  const isActive =
    payload?.is_active === undefined
      ? Boolean(existingUser.is_active)
      : normalizeBoolean(payload?.is_active, Boolean(existingUser.is_active));
  const password = String(payload?.password || "");

  if (!name) {
    throw new AppError("name is required", 400);
  }

  if (!email) {
    throw new AppError("email is required", 400);
  }

  await ensureEmailAvailable({ email, excludeUserId: existingUser.id });

  const updatePayload = {
    role_id: roleRow.id,
    name,
    email,
    phone,
    status,
    is_active: isActive
  };

  if (password.trim()) {
    updatePayload.password_hash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
  }

  const { data, error } = await supabase
    .from("app_users")
    .update(updatePayload)
    .eq("id", existingUser.id)
    .eq("academy_id", academyId)
    .select("id,academy_id,role_id,name,email,phone,status,is_active,created_at")
    .single();

  if (error) {
    throw new AppError(error.message, 500);
  }

  return buildTournamentUserResponse(data, new Map([[String(roleRow.id), roleRow.name]]));
}

export async function deleteTournamentStaffUser({ req, tournamentId, userId }) {
  const { academyId } = await ensureManagedTournamentContext(req, tournamentId);
  const existingUser = await getScopedTournamentUser({ tournamentId, userId, academyId });
  const roleRow = await resolveRoleRow({ roleId: existingUser.role_id });

  if (!TOURNAMENT_ONLY_ROLE_NAMES.has(String(roleRow?.name || "").toLowerCase())) {
    throw new AppError("Only tournament-only users can be deleted here", 400);
  }

  await deleteTournamentUserAssignment({
    tournamentId,
    academyId,
    userId: existingUser.id
  });

  const remainingAssignments = await countTournamentUserAssignmentsForUser(existingUser.id);

  if (remainingAssignments === 0) {
    const { error } = await supabase
      .from("app_users")
      .delete()
      .eq("id", existingUser.id)
      .eq("academy_id", academyId);

    if (error) {
      throw new AppError(error.message, 500);
    }
  }

  return {
    success: true,
    deleted_user_id: existingUser.id,
    deleted_user_name: existingUser.name || existingUser.email || `User ${existingUser.id}`
  };
}
