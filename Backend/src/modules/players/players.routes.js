import express from "express";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import supabase from "../../config/db.js";
import tournamentDb from "../../config/tournamentDb.js";
import {
  isInvalidTournamentSchemaError,
  buildTournamentSchemaAccessError
} from "../../config/tournamentSchema.js";
import { auth } from "../../middleware/auth.middleware.js";
import { applyAcademyFilter } from "../../middleware/academyFilter.js";

const router = express.Router();

const ALLOWED_GENDERS = new Map([
  ["male", "Male"],
  ["female", "Female"],
  ["other", "Other"]
]);

const ALLOWED_STATUSES = new Map([
  ["active", "active"],
  ["inactive", "inactive"]
]);

const PLAYER_PHOTO_BUCKET = process.env.PLAYER_PHOTO_BUCKET || "player-photos";
const PLAYER_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PASSWORD_SALT_ROUNDS = 10;
const ALLOWED_PHOTO_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
]);

let photoBucketReady = false;

function getRoleName(req) {
  return req.user?.role || req.user?.role_name || null;
}

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

function normalizeBoolean(value, fallback = false) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();

  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function normalizeDate(value, fieldName, { required = false } = {}) {
  const dateValue = normalizeText(value);

  if (!dateValue) {
    if (required) {
      throw new Error(`${fieldName} is required`);
    }

    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    throw new Error(`${fieldName} must be in YYYY-MM-DD format`);
  }

  return dateValue;
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

function resolveScopedAcademyId(value, req, { required = true } = {}) {
  const requestAcademyId = normalizeInteger(value, "academy_id", { required: false });
  const userAcademyId = normalizeInteger(req.user?.academy_id, "academy_id", { required: false });
  const roleName = getRoleName(req);

  if (roleName === "super_admin") {
    if (!requestAcademyId && required) {
      throw new Error("academy_id is required");
    }

    return requestAcademyId;
  }

  if (!userAcademyId && required) {
    throw new Error("academy_id is required");
  }

  if (requestAcademyId && userAcademyId && requestAcademyId !== userAcademyId) {
    const error = new Error("You cannot manage players for another academy");
    error.statusCode = 403;
    throw error;
  }

  return userAcademyId;
}

function sanitizeFileName(value) {
  return String(value || "player-photo")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeBase64Payload(value) {
  const raw = normalizeText(value);

  if (!raw) {
    return null;
  }

  const strippedValue = raw.replace(/^data:[^;]+;base64,/i, "").replace(/\s+/g, "");

  if (!strippedValue) {
    return null;
  }

  return strippedValue;
}

function extractManagedPhotoPath(photoUrl) {
  const normalizedPhotoUrl = normalizeText(photoUrl);

  if (!normalizedPhotoUrl) {
    return null;
  }

  const marker = `/storage/v1/object/public/${PLAYER_PHOTO_BUCKET}/`;
  const markerIndex = normalizedPhotoUrl.indexOf(marker);

  if (markerIndex === -1) {
    return null;
  }

  return decodeURIComponent(normalizedPhotoUrl.slice(markerIndex + marker.length));
}

async function ensurePhotoBucket() {
  if (photoBucketReady) {
    return;
  }

  const { data: buckets, error } = await supabase.storage.listBuckets();

  if (error) {
    throw error;
  }

  const bucketExists = (buckets || []).some(
    (bucket) => bucket.id === PLAYER_PHOTO_BUCKET || bucket.name === PLAYER_PHOTO_BUCKET
  );

  if (!bucketExists) {
    const { error: createError } = await supabase.storage.createBucket(
      PLAYER_PHOTO_BUCKET,
      {
        public: true
      }
    );

    if (createError && !/already exists/i.test(createError.message || "")) {
      throw createError;
    }
  }

  photoBucketReady = true;
}

async function uploadManagedPhoto({
  academyId,
  playerId,
  fileName,
  contentType,
  dataBase64
}) {
  const normalizedContentType = normalizeText(contentType)?.toLowerCase();
  const extension = ALLOWED_PHOTO_TYPES.get(normalizedContentType || "");

  if (!extension) {
    const uploadTypeError = new Error(
      "Only JPG, PNG, and WEBP player photos are supported"
    );
    uploadTypeError.statusCode = 400;
    throw uploadTypeError;
  }

  const normalizedBase64 = normalizeBase64Payload(dataBase64);

  if (!normalizedBase64) {
    const base64Error = new Error("Photo file data is required");
    base64Error.statusCode = 400;
    throw base64Error;
  }

  const fileBuffer = Buffer.from(normalizedBase64, "base64");

  if (!fileBuffer.length) {
    const emptyFileError = new Error("Uploaded photo file is empty");
    emptyFileError.statusCode = 400;
    throw emptyFileError;
  }

  if (fileBuffer.length > PLAYER_PHOTO_MAX_BYTES) {
    const sizeError = new Error("Player photo must be 5 MB or smaller");
    sizeError.statusCode = 400;
    throw sizeError;
  }

  await ensurePhotoBucket();

  const safeBaseName =
    sanitizeFileName(fileName).replace(/\.[a-z0-9]+$/i, "") || "player-photo";
  const storagePath = [
    `academy-${academyId}`,
    `player-${playerId || "draft"}`,
    `${Date.now()}-${randomUUID()}-${safeBaseName}.${extension}`
  ].join("/");

  const { error } = await supabase.storage.from(PLAYER_PHOTO_BUCKET).upload(storagePath, fileBuffer, {
    contentType: normalizedContentType,
    upsert: false
  });

  if (error) {
    throw error;
  }

  const { data } = supabase.storage.from(PLAYER_PHOTO_BUCKET).getPublicUrl(storagePath);

  return {
    photo_url: data?.publicUrl || null,
    storage_path: storagePath,
    bucket: PLAYER_PHOTO_BUCKET
  };
}

async function removeManagedPhoto(photoUrl) {
  const storagePath = extractManagedPhotoPath(photoUrl);

  if (!storagePath) {
    return;
  }

  try {
    const { error } = await supabase.storage.from(PLAYER_PHOTO_BUCKET).remove([storagePath]);

    if (error && !/not found/i.test(error.message || "")) {
      console.warn("PLAYER PHOTO DELETE ERROR:", error.message);
    }
  } catch (error) {
    console.warn("PLAYER PHOTO DELETE ERROR:", error.message);
  }
}

function normalizeEnum(value, allowedMap, fieldName, { required = false } = {}) {
  const normalizedValue = normalizeText(value);

  if (!normalizedValue) {
    if (required) {
      throw new Error(`${fieldName} is required`);
    }

    return null;
  }

  const resolvedValue = allowedMap.get(normalizedValue.toLowerCase());

  if (!resolvedValue) {
    throw new Error(`${fieldName} is invalid`);
  }

  return resolvedValue;
}

function buildPlayerPayload(body, req, { isUpdate = false } = {}) {
  const academyId = resolveScopedAcademyId(body.academy_id, req, { required: true });

  const payload = {
    academy_id: academyId,
    category_id: normalizeInteger(body.category_id, "category_id", { required: true }),
    name: normalizeText(body.name),
    dob: normalizeDate(body.dob, "dob", { required: true }),
    gender: normalizeEnum(body.gender, ALLOWED_GENDERS, "gender", { required: true }),
    father_name: normalizeText(body.father_name),
    mother_name: normalizeText(body.mother_name),
    contact_number_1: normalizeText(body.contact_number_1),
    contact_number_2: normalizeText(body.contact_number_2),
    email: normalizeEmail(body.email),
    address: normalizeText(body.address),
    photo_url: normalizeText(body.photo_url),
    joining_date:
      normalizeDate(body.joining_date, "joining_date") ||
      new Date().toISOString().slice(0, 10),
    status: normalizeEnum(body.status || "active", ALLOWED_STATUSES, "status", {
      required: true
    })
  };

  if (!payload.name) {
    throw new Error("name is required");
  }

  if (!payload.contact_number_1) {
    throw new Error("contact_number_1 is required");
  }

  if (!isUpdate) {
    payload.created_by = req.user?.id || null;
  }

  return payload;
}

async function ensureDuplicateFree({
  academyId,
  email,
  contactNumber1,
  excludePlayerId = null
}) {
  if (email) {
    const { data, error } = await supabase
      .from("players")
      .select("id,name,email")
      .eq("academy_id", academyId)
      .eq("email", email)
      .limit(1);

    if (error) {
      throw error;
    }

    const duplicate = (data || []).find(
      (player) => String(player.id) !== String(excludePlayerId || "")
    );

    if (duplicate) {
      const duplicateError = new Error("A player with this email already exists");
      duplicateError.statusCode = 409;
      throw duplicateError;
    }
  }

  if (contactNumber1) {
    const { data, error } = await supabase
      .from("players")
      .select("id,name,contact_number_1")
      .eq("academy_id", academyId)
      .eq("contact_number_1", contactNumber1)
      .limit(1);

    if (error) {
      throw error;
    }

    const duplicate = (data || []).find(
      (player) => String(player.id) !== String(excludePlayerId || "")
    );

    if (duplicate) {
      const duplicateError = new Error(
        "A player with this primary contact number already exists"
      );
      duplicateError.statusCode = 409;
      throw duplicateError;
    }
  }
}

async function ensureUserEmailAvailable({ email }) {
  if (!email) {
    return;
  }

  const { data, error } = await supabase
    .from("app_users")
    .select("id,email")
    .eq("email", email)
    .limit(1);

  if (error) {
    throw error;
  }

  if ((data || []).length) {
    const duplicateError = new Error("A parent user with this email already exists");
    duplicateError.statusCode = 409;
    throw duplicateError;
  }
}

async function resolveParentRoleRow() {
  const { data, error } = await supabase
    .from("roles")
    .select("id,name")
    .in("name", ["parents", "parent"]);

  if (error) {
    throw error;
  }

  const rows = data || [];
  const exactParents = rows.find((row) => String(row.name || "").toLowerCase() === "parents");
  const exactParent = rows.find((row) => String(row.name || "").toLowerCase() === "parent");
  const roleRow = exactParents || exactParent || null;

  if (!roleRow) {
    const roleError = new Error("Parent role was not found in roles table");
    roleError.statusCode = 500;
    throw roleError;
  }

  return roleRow;
}

async function createParentPortalAccount({
  academyId,
  parentName,
  parentEmail,
  parentPhone,
  parentPassword
}) {
  const parentRole = await resolveParentRoleRow();
  await ensureUserEmailAvailable({ email: parentEmail });

  const passwordHash = await bcrypt.hash(parentPassword, PASSWORD_SALT_ROUNDS);

  const { data, error } = await supabase
    .from("app_users")
    .insert({
      academy_id: academyId,
      role_id: parentRole.id,
      name: parentName,
      email: parentEmail,
      phone: parentPhone,
      password_hash: passwordHash,
      status: "active",
      is_active: true
    })
    .select("id,academy_id,role_id,name,email,phone,status,is_active")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function linkParentToPlayer({ academyId, parentUserId, playerId, createdBy }) {
  try {
    const { error } = await supabase.from("parent_players").insert({
      academy_id: academyId,
      parent_user_id: parentUserId,
      player_id: playerId,
      created_by: createdBy || null
    });

    if (error) {
      throw error;
    }
  } catch (error) {
    if (
      /does not exist/i.test(error.message || "") ||
      /Could not find the table/i.test(error.message || "")
    ) {
      const linkError = new Error(
        "Parent linking table is missing. Run Backend/sql/20260310_public_parent_players.sql in Supabase first."
      );
      linkError.statusCode = 500;
      throw linkError;
    }

    throw error;
  }
}

function buildParentAccountPayload(body) {
  const createParentAccount = normalizeBoolean(body.create_parent_account, false);

  if (!createParentAccount) {
    return null;
  }

  const parentName = normalizeText(body.parent_account_name);
  const parentEmail = normalizeEmail(body.parent_account_email);
  const parentPhone = normalizeText(body.parent_account_phone);
  const parentPassword = normalizeText(body.parent_account_password);

  if (!parentName) {
    throw new Error("parent_account_name is required when creating a parent account");
  }

  if (!parentEmail) {
    throw new Error("parent_account_email is required when creating a parent account");
  }

  if (!parentPhone) {
    throw new Error("parent_account_phone is required when creating a parent account");
  }

  if (!parentPassword || parentPassword.length < 6) {
    throw new Error("parent_account_password must be at least 6 characters");
  }

  return {
    parentName,
    parentEmail,
    parentPhone,
    parentPassword
  };
}

async function getScopedPlayer(id, req) {
  let query = supabase.from("players").select("*").eq("id", id);

  if (req.user?.academy_id) {
    query = query.eq("academy_id", req.user.academy_id);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function ensurePhotoUploadAccess({ academyId, playerId, req }) {
  if (getRoleName(req) !== "super_admin" && Number(req.user?.academy_id) !== Number(academyId)) {
    const accessError = new Error("You cannot upload player photos for another academy");
    accessError.statusCode = 403;
    throw accessError;
  }

  if (!playerId) {
    return null;
  }

  const player = await getScopedPlayer(playerId, req);

  if (!player) {
    const notFoundError = new Error("Player not found");
    notFoundError.statusCode = 404;
    throw notFoundError;
  }

  return player;
}

async function ensurePlayerCanBeDeleted(playerId) {
  const normalizedPlayerId = normalizeText(playerId);

  if (!normalizedPlayerId) {
    return;
  }

  try {
    const [player1Reference, player2Reference] = await Promise.all([
      tournamentDb
        .from("participants")
        .select("id,event_id")
        .eq("player1_id", normalizedPlayerId)
        .limit(1),
      tournamentDb
        .from("participants")
        .select("id,event_id")
        .eq("player2_id", normalizedPlayerId)
        .limit(1)
    ]);

    if (player1Reference.error) {
      throw player1Reference.error;
    }

    if (player2Reference.error) {
      throw player2Reference.error;
    }

    if ((player1Reference.data || []).length || (player2Reference.data || []).length) {
      const deleteError = new Error(
        "Cannot delete this player because they are already linked to tournament registrations"
      );
      deleteError.statusCode = 409;
      throw deleteError;
    }
  } catch (error) {
    if (isInvalidTournamentSchemaError(error)) {
      throw buildTournamentSchemaAccessError();
    }

    if (/relation .*participants.* does not exist/i.test(error.message || "")) {
      return;
    }

    throw error;
  }
}

router.get("/", auth, async (req, res) => {
  let query = supabase.from("players").select("*").order("category_id").order("name");

  query = applyAcademyFilter(query, req);

  const { data, error } = await query;

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const categoryIds = [...new Set((data || []).map((player) => player.category_id).filter(Boolean))];
  const academyIds = [...new Set((data || []).map((player) => player.academy_id).filter(Boolean))];
  let categories = [];
  let academies = [];

  if (categoryIds.length) {
    const { data: categoryRows, error: categoryError } = await supabase
      .from("categories")
      .select("id,name")
      .in("id", categoryIds);

    if (categoryError) {
      return res.status(500).json({ error: categoryError.message });
    }

    categories = categoryRows || [];
  }

  if (academyIds.length) {
    const { data: academyRows, error: academyError } = await supabase
      .from("academies")
      .select("id,name")
      .in("id", academyIds);

    if (academyError) {
      return res.status(500).json({ error: academyError.message });
    }

    academies = academyRows || [];
  }

  const playerIds = (data || []).map((player) => player.id).filter(Boolean);
  let parentLinks = [];

  if (playerIds.length) {
    const { data: parentLinkRows, error: parentLinkError } = await supabase
      .from("parent_players")
      .select("player_id,parent_user_id")
      .in("player_id", playerIds);

    if (parentLinkError && !/does not exist/i.test(parentLinkError.message || "")) {
      return res.status(500).json({ error: parentLinkError.message });
    }

    parentLinks = parentLinkRows || [];
  }

  const categoryMap = new Map(categories.map((category) => [String(category.id), category.name]));
  const academyMap = new Map(academies.map((academy) => [String(academy.id), academy.name]));
  const parentLinkMap = new Map(
    parentLinks.map((link) => [String(link.player_id), link.parent_user_id])
  );

  res.json(
    (data || []).map((player) => ({
      ...player,
      category_name: categoryMap.get(String(player.category_id)) || null,
      academy_name: academyMap.get(String(player.academy_id)) || null,
      parent_linked: parentLinkMap.has(String(player.id)),
      parent_user_id: parentLinkMap.get(String(player.id)) || null
    }))
  );
});

router.post("/", auth, async (req, res) => {
  try {
    const payload = buildPlayerPayload(req.body, req);
    const parentAccountPayload = buildParentAccountPayload(req.body);

    await ensureDuplicateFree({
      academyId: payload.academy_id,
      email: payload.email,
      contactNumber1: payload.contact_number_1
    });

    let parentUser = null;

    if (parentAccountPayload) {
      parentUser = await createParentPortalAccount({
        academyId: payload.academy_id,
        ...parentAccountPayload
      });
    }

    const { data, error } = await supabase
      .from("players")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      if (parentUser?.id) {
        await supabase.from("app_users").delete().eq("id", parentUser.id);
      }
      return res.status(500).json({ error: error.message });
    }

    if (parentUser?.id) {
      try {
        await linkParentToPlayer({
          academyId: payload.academy_id,
          parentUserId: parentUser.id,
          playerId: data.id,
          createdBy: req.user?.id
        });
      } catch (linkError) {
        await supabase.from("app_users").delete().eq("id", parentUser.id);
        await supabase.from("players").delete().eq("id", data.id);
        throw linkError;
      }
    }

    res.status(201).json({
      ...data,
      parent_account_created: Boolean(parentUser?.id),
      parent_user_id: parentUser?.id || null
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message });
  }
});

router.post("/photo-upload", auth, async (req, res) => {
  try {
    const academyId = resolveScopedAcademyId(req.body.academy_id, req, { required: true });
    const playerId = normalizeInteger(req.body.player_id, "player_id");
    const fileName = normalizeText(req.body.file_name) || "player-photo";
    const contentType = normalizeText(req.body.content_type);
    const dataBase64 = req.body.data_base64;

    await ensurePhotoUploadAccess({ academyId, playerId, req });

    const upload = await uploadManagedPhoto({
      academyId,
      playerId,
      fileName,
      contentType,
      dataBase64
    });

    res.status(201).json(upload);
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message });
  }
});

router.put("/:id", auth, async (req, res) => {
  try {
    const existingPlayer = await getScopedPlayer(req.params.id, req);

    if (!existingPlayer) {
      return res.status(404).json({ error: "Player not found" });
    }

    const payload = buildPlayerPayload(req.body, req, { isUpdate: true });
    const previousPhotoUrl = existingPlayer.photo_url;

    await ensureDuplicateFree({
      academyId: payload.academy_id,
      email: payload.email,
      contactNumber1: payload.contact_number_1,
      excludePlayerId: req.params.id
    });

    const { data, error } = await supabase
      .from("players")
      .update(payload)
      .eq("id", req.params.id)
      .select("*")
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (
      normalizeText(previousPhotoUrl) &&
      normalizeText(previousPhotoUrl) !== normalizeText(data?.photo_url)
    ) {
      await removeManagedPhoto(previousPhotoUrl);
    }

    res.json(data);
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message });
  }
});

router.delete("/:id", auth, async (req, res) => {
  try {
    const existingPlayer = await getScopedPlayer(req.params.id, req);

    if (!existingPlayer) {
      return res.status(404).json({ error: "Player not found" });
    }

    await ensurePlayerCanBeDeleted(existingPlayer.id);

    const { error } = await supabase.from("players").delete().eq("id", req.params.id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    await removeManagedPhoto(existingPlayer.photo_url);

    res.json({
      success: true,
      deleted_player_id: existingPlayer.id,
      deleted_player_name: existingPlayer.name
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message });
  }
});

export default router;



