import express from "express";
import bcrypt from "bcryptjs";
import supabase from "../../config/db.js";
import { auth } from "../../middleware/auth.middleware.js";

const router = express.Router();

const USER_MANAGER_ROLES = new Set(["super_admin", "head_coach", "academy_admin"]);
const EXCLUDED_USER_MANAGER_ROLE_NAMES = new Set(["parent", "parents"]);
const PASSWORD_SALT_ROUNDS = 10;

function normalizeText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text ? text : null;
}

function normalizeEmail(value) {
  const email = normalizeText(value);
  return email ? email.toLowerCase() : null;
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

function normalizeBoolean(value, fallback = null) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();

  if (["true", "1", "yes", "active"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "inactive"].includes(normalized)) {
    return false;
  }

  throw new Error("is_active is invalid");
}

function getRoleName(req) {
  return req.user?.role || req.user?.role_name || null;
}

function normalizeRoleName(value) {
  return String(normalizeText(value) || "").toLowerCase();
}

function isExcludedUserManagerRole(roleName) {
  return EXCLUDED_USER_MANAGER_ROLE_NAMES.has(normalizeRoleName(roleName));
}

function canManageUsers(req) {
  return USER_MANAGER_ROLES.has(String(getRoleName(req) || "").toLowerCase());
}

function ensureUserManagementAccess(req) {
  if (!canManageUsers(req)) {
    const error = new Error("You do not have permission to manage users");
    error.statusCode = 403;
    throw error;
  }
}

async function listRoleRows() {
  const { data, error } = await supabase
    .from("roles")
    .select("id,name")
    .order("name", { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}

async function listAcademyRows({ academyId = null, includeAll = false } = {}) {
  let query = supabase.from("academies").select("id,name").order("name", { ascending: true });

  if (!includeAll && academyId) {
    query = query.eq("id", academyId);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data || [];
}

async function resolveRoleRow({ roleId = null, roleName = null }) {
  if (roleId) {
    const { data, error } = await supabase
      .from("roles")
      .select("id,name")
      .eq("id", roleId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data;
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
    throw error;
  }

  return data;
}

async function resolveManagedRoleRow({
  req,
  roleId = null,
  roleName = null,
  required = true
} = {}) {
  const normalizedRoleId = normalizeInteger(roleId, "role_id", { required: false });
  const normalizedRoleName = normalizeText(roleName);

  if (!normalizedRoleId && !normalizedRoleName) {
    if (!required) {
      return null;
    }

    const error = new Error("role is required");
    error.statusCode = 400;
    throw error;
  }

  const roleRow = await resolveRoleRow({
    roleId: normalizedRoleId,
    roleName: normalizedRoleName
  });

  if (!roleRow) {
    const error = new Error("Selected role was not found");
    error.statusCode = 404;
    throw error;
  }

  validateManagedRole(roleRow.name, req);

  return roleRow;
}

async function getScopedUser(userId, req) {
  let query = supabase.from("app_users").select("*").eq("id", userId);

  if (getRoleName(req) !== "super_admin") {
    query = query.eq("academy_id", req.user?.academy_id);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function ensureEmailAvailable({ email, excludeUserId = null }) {
  if (!email) {
    return;
  }

  const { data, error } = await supabase
    .from("app_users")
    .select("id,email")
    .eq("email", email);

  if (error) {
    throw error;
  }

  const duplicate = (data || []).find(
    (user) => String(user.id) !== String(excludeUserId || "")
  );

  if (duplicate) {
    const error = new Error("A user with this email already exists");
    error.statusCode = 409;
    throw error;
  }
}

function resolveScopedAcademyId(value, req, { required = true, allowNullForSuperAdmin = true } = {}) {
  const requestAcademyId = normalizeInteger(value, "academy_id", { required: false });
  const userAcademyId = normalizeInteger(req.user?.academy_id, "academy_id", { required: false });
  const roleName = getRoleName(req);

  if (roleName === "super_admin") {
    if (!requestAcademyId && required && !allowNullForSuperAdmin) {
      throw new Error("academy_id is required");
    }

    return requestAcademyId;
  }

  if (!userAcademyId && required) {
    throw new Error("academy_id is required");
  }

  if (requestAcademyId && userAcademyId && requestAcademyId !== userAcademyId) {
    const error = new Error("You cannot manage users for another academy");
    error.statusCode = 403;
    throw error;
  }

  return userAcademyId;
}

function validateManagedRole(roleName, req) {
  const normalizedRoleName = normalizeText(roleName);

  if (!normalizedRoleName) {
    const error = new Error("role is required");
    error.statusCode = 400;
    throw error;
  }

  if (isExcludedUserManagerRole(normalizedRoleName)) {
    const error = new Error(
      "Parent accounts are created from player registration and cannot be managed from Staff"
    );
    error.statusCode = 400;
    throw error;
  }

  if (getRoleName(req) !== "super_admin" && normalizedRoleName === "super_admin") {
    const error = new Error("Only super admin can assign the super_admin role");
    error.statusCode = 403;
    throw error;
  }

  return normalizedRoleName;
}

function buildUserResponse(user, roleNameMap, academyNameMap) {
  return {
    id: user.id,
    academy_id: user.academy_id,
    academy_name: academyNameMap.get(String(user.academy_id || "")) || null,
    role_id: user.role_id,
    role: roleNameMap.get(String(user.role_id || "")) || null,
    role_name: roleNameMap.get(String(user.role_id || "")) || null,
    name: user.name || null,
    email: user.email || null,
    phone: user.phone || null,
    status: user.status || null,
    is_active: Boolean(user.is_active),
    created_at: user.created_at || null
  };
}

router.get("/meta", auth, async (req, res) => {
  try {
    ensureUserManagementAccess(req);

    const roleName = getRoleName(req);
    const [roles, academies] = await Promise.all([
      listRoleRows(),
      listAcademyRows({
        academyId: req.user?.academy_id,
        includeAll: roleName === "super_admin"
      })
    ]);

    const filteredRoles = roles.filter((role) => {
      const normalizedRoleName = normalizeRoleName(role.name);

      if (isExcludedUserManagerRole(normalizedRoleName)) {
        return false;
      }

      if (roleName !== "super_admin" && normalizedRoleName === "super_admin") {
        return false;
      }

      return true;
    });

    res.json({
      roles: filteredRoles,
      academies,
      current_role: roleName,
      current_academy_id: req.user?.academy_id || null
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.get("/", auth, async (req, res) => {
  try {
    ensureUserManagementAccess(req);

    let query = supabase
      .from("app_users")
      .select("id,academy_id,role_id,name,email,phone,status,is_active,created_at")
      .order("id", { ascending: false });

    if (getRoleName(req) !== "super_admin") {
      query = query.eq("academy_id", req.user?.academy_id);
    }

    const { data: users, error } = await query;

    if (error) {
      throw error;
    }

    const academyIds = [...new Set((users || []).map((user) => user.academy_id).filter(Boolean))];
    const roleIds = [...new Set((users || []).map((user) => user.role_id).filter(Boolean))];

    const [academyRows, roleRows] = await Promise.all([
      academyIds.length
        ? supabase.from("academies").select("id,name").in("id", academyIds)
        : Promise.resolve({ data: [], error: null }),
      roleIds.length
        ? supabase.from("roles").select("id,name").in("id", roleIds)
        : Promise.resolve({ data: [], error: null })
    ]);

    if (academyRows.error) {
      throw academyRows.error;
    }

    if (roleRows.error) {
      throw roleRows.error;
    }

    const academyNameMap = new Map(
      (academyRows.data || []).map((academy) => [String(academy.id), academy.name])
    );
    const roleNameMap = new Map(
      (roleRows.data || []).map((role) => [String(role.id), role.name])
    );

    res.json(
      (users || [])
        .map((user) => buildUserResponse(user, roleNameMap, academyNameMap))
        .filter((user) => !isExcludedUserManagerRole(user.role_name))
    );
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.post("/", auth, async (req, res) => {
  try {
    ensureUserManagementAccess(req);

    const name = normalizeText(req.body.name);
    const email = normalizeEmail(req.body.email);
    const phone = normalizeText(req.body.phone);
    const password = normalizeText(req.body.password);
    const status = normalizeText(req.body.status) || "active";
    const isActive = normalizeBoolean(req.body.is_active, true);
    const roleRow = await resolveManagedRoleRow({
      req,
      roleId: req.body.role_id,
      roleName: req.body.role || req.body.role_name
    });

    if (!name) {
      throw new Error("name is required");
    }

    if (!email) {
      throw new Error("email is required");
    }

    if (!password) {
      throw new Error("password is required");
    }

    const passwordHash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);

    const academyId = resolveScopedAcademyId(req.body.academy_id, req, {
      required: roleRow.name !== "super_admin",
      allowNullForSuperAdmin: true
    });

    await ensureEmailAvailable({ email });

    const { data, error } = await supabase
      .from("app_users")
      .insert({
        academy_id: roleRow.name === "super_admin" ? null : academyId,
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
      throw error;
    }

    const academyRows = data.academy_id
      ? await supabase.from("academies").select("id,name").eq("id", data.academy_id)
      : { data: [], error: null };

    if (academyRows.error) {
      throw academyRows.error;
    }

    const academyNameMap = new Map(
      (academyRows.data || []).map((academy) => [String(academy.id), academy.name])
    );
    const roleNameMap = new Map([[String(roleRow.id), roleRow.name]]);

    res.status(201).json(buildUserResponse(data, roleNameMap, academyNameMap));
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message });
  }
});

router.put("/:id", auth, async (req, res) => {
  try {
    ensureUserManagementAccess(req);

    const existingUser = await getScopedUser(req.params.id, req);

    if (!existingUser) {
      return res.status(404).json({ error: "User not found" });
    }

    const existingRoleRow = await resolveRoleRow({ roleId: existingUser.role_id });

    if (getRoleName(req) !== "super_admin" && existingRoleRow?.name === "super_admin") {
      return res.status(403).json({ error: "You cannot manage super admin accounts" });
    }

    const nextRoleRow =
      req.body.role_id || req.body.role || req.body.role_name
        ? await resolveManagedRoleRow({
            req,
            roleId: req.body.role_id,
            roleName: req.body.role || req.body.role_name
          })
        : existingRoleRow;

    const academyId = resolveScopedAcademyId(
      req.body.academy_id ?? existingUser.academy_id,
      req,
      {
        required: nextRoleRow.name !== "super_admin",
        allowNullForSuperAdmin: true
      }
    );
    const name = normalizeText(req.body.name) || existingUser.name || null;
    const email = normalizeEmail(req.body.email) || existingUser.email || null;
    const phone = normalizeText(req.body.phone);
    const status = normalizeText(req.body.status) || existingUser.status || "active";
    const isActive = normalizeBoolean(req.body.is_active, existingUser.is_active);
    const password = normalizeText(req.body.password);

    await ensureEmailAvailable({ email, excludeUserId: existingUser.id });

    const payload = {
      academy_id: nextRoleRow.name === "super_admin" ? null : academyId,
      role_id: nextRoleRow.id,
      name,
      email,
      phone,
      status,
      is_active: isActive
    };

    if (password) {
      payload.password_hash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
    }

    const { data, error } = await supabase
      .from("app_users")
      .update(payload)
      .eq("id", req.params.id)
      .select("id,academy_id,role_id,name,email,phone,status,is_active,created_at")
      .single();

    if (error) {
      throw error;
    }

    const academyRows = data.academy_id
      ? await supabase.from("academies").select("id,name").eq("id", data.academy_id)
      : { data: [], error: null };

    if (academyRows.error) {
      throw academyRows.error;
    }

    const academyNameMap = new Map(
      (academyRows.data || []).map((academy) => [String(academy.id), academy.name])
    );
    const roleNameMap = new Map([[String(nextRoleRow.id), nextRoleRow.name]]);

    res.json(buildUserResponse(data, roleNameMap, academyNameMap));
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message });
  }
});

router.delete("/:id", auth, async (req, res) => {
  try {
    ensureUserManagementAccess(req);

    if (String(req.params.id) === String(req.user?.id || "")) {
      return res.status(409).json({ error: "You cannot delete your own account" });
    }

    const existingUser = await getScopedUser(req.params.id, req);

    if (!existingUser) {
      return res.status(404).json({ error: "User not found" });
    }

    const roleRow = await resolveRoleRow({ roleId: existingUser.role_id });

    if (getRoleName(req) !== "super_admin" && roleRow?.name === "super_admin") {
      return res.status(403).json({ error: "You cannot delete a super admin account" });
    }

    const { error } = await supabase.from("app_users").delete().eq("id", req.params.id);

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      deleted_user_id: existingUser.id,
      deleted_user_name: existingUser.name || existingUser.email
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message });
  }
});

export default router;
