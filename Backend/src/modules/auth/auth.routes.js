import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import supabase from "../../config/db.js";

const router = express.Router();

async function getRoleName(roleId) {
  if (!roleId) {
    return null;
  }

  const { data, error } = await supabase
    .from("roles")
    .select("id,name")
    .eq("id", roleId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.name || null;
}

router.post("/login", async (req, res) => {

  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (!email || !password) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const { data: user, error } = await supabase
    .from("app_users")
    .select("*")
    .eq("email", email)
    .single();

  if (error || !user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const storedPassword = String(user.password_hash || "");
  let passwordMatches = false;

  if (storedPassword.startsWith("$2")) {
    passwordMatches = await bcrypt.compare(password, storedPassword);
  } else {
    passwordMatches = storedPassword === password;
  }

  if (!passwordMatches) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  if (!user.is_active || String(user.status || "").toLowerCase() === "inactive") {
    return res.status(403).json({ error: "User inactive" });
  }

  const roleName = await getRoleName(user.role_id);

  const token = jwt.sign(
    {
      id: user.id,
      role_id: user.role_id,
      role: roleName,
      role_name: roleName,
      academy_id: user.academy_id
    },
    process.env.JWT_SECRET,
    { expiresIn: "8h" }
  );

  res.json({
    token,
    role_id: user.role_id,
    role: roleName,
    role_name: roleName,
    academy_id: user.academy_id,
    email: user.email,
    name: user.name || null
  });

});

export default router;
