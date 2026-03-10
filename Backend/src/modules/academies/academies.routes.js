import express from "express";
import supabase from "../../config/db.js";
import { auth } from "../../middleware/auth.middleware.js";

const router = express.Router();

function normalizeText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text ? text : null;
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

function getRoleName(req) {
  return req.user?.role || req.user?.role_name || null;
}

router.get("/", auth, async (req, res) => {

let query = supabase
.from("academies")
.select("id,name,address,location,contact_details,assigned_manager_user_id")
.order("name");

const roleName = req.user?.role || req.user?.role_name;

if (roleName !== "super_admin" && req.user?.academy_id) {
query = query.eq("id", req.user.academy_id);
}

const { data, error } = await query;

if (error)
return res.status(500).json({ error: error.message });

const managerIds = [...new Set((data || []).map((academy) => academy.assigned_manager_user_id).filter(Boolean))];

let managerMap = new Map();

if (managerIds.length) {
const { data: managers, error: managersError } = await supabase
  .from("app_users")
  .select("id,name,email")
  .in("id", managerIds);

if (managersError) {
  return res.status(500).json({ error: managersError.message });
}

managerMap = new Map((managers || []).map((manager) => [String(manager.id), manager]));
}

res.json((data || []).map((academy) => ({
  ...academy,
  assigned_manager_name: managerMap.get(String(academy.assigned_manager_user_id || ""))?.name || null,
  assigned_manager_email: managerMap.get(String(academy.assigned_manager_user_id || ""))?.email || null
})));

});

router.post("/", auth, async (req, res) => {
  try {
    if (String(getRoleName(req) || "").toLowerCase() !== "super_admin") {
      return res.status(403).json({ error: "Only super admin can create academies" });
    }

    const name = normalizeText(req.body.name);
    const location = normalizeText(req.body.location);
    const contactDetails = normalizeText(req.body.contact_details);
    const assignedManagerUserId = normalizeInteger(req.body.assigned_manager_user_id, "assigned_manager_user_id", {
      required: false
    });

    if (!name) {
      return res.status(400).json({ error: "Academy name is required" });
    }

    const { data, error } = await supabase
      .from("academies")
      .insert({
        name,
        address: location,
        location,
        contact_details: contactDetails,
        assigned_manager_user_id: assignedManagerUserId
      })
      .select("id,name,address,location,contact_details,assigned_manager_user_id")
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.status(201).json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.patch("/:id", auth, async (req, res) => {
  try {
    if (String(getRoleName(req) || "").toLowerCase() !== "super_admin") {
      return res.status(403).json({ error: "Only super admin can edit academies" });
    }

    const academyId = normalizeInteger(req.params.id, "academy_id", { required: true });
    const name = normalizeText(req.body.name);
    const location = normalizeText(req.body.location);
    const contactDetails = normalizeText(req.body.contact_details);
    const assignedManagerUserId = normalizeInteger(req.body.assigned_manager_user_id, "assigned_manager_user_id", {
      required: false
    });

    if (!name) {
      return res.status(400).json({ error: "Academy name is required" });
    }

    const { data, error } = await supabase
      .from("academies")
      .update({
        name,
        address: location,
        location,
        contact_details: contactDetails,
        assigned_manager_user_id: assignedManagerUserId
      })
      .eq("id", academyId)
      .select("id,name,address,location,contact_details,assigned_manager_user_id")
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!data) {
      return res.status(404).json({ error: "Academy not found" });
    }

    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
