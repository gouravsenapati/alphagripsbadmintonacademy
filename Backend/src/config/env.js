import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../../");

const envCandidates = [
  process.env.DOTENV_CONFIG_PATH,
  path.join(projectRoot, "Backend", ".env"),
  path.join(projectRoot, ".env")
].filter(Boolean);

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: Number(process.env.PORT) || 5000,
  SUPABASE_URL: requireEnv("SUPABASE_URL"),
  SUPABASE_KEY: requireEnv("SUPABASE_KEY"),
  JWT_SECRET: requireEnv("JWT_SECRET"),
  TOURNAMENT_SCHEMA: process.env.TOURNAMENT_SCHEMA || "ag_tournament",
  PLAYER_PHOTO_BUCKET: process.env.PLAYER_PHOTO_BUCKET || "player-photos",
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID || "",
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET || "",
  SMTP_HOST: process.env.SMTP_HOST || "",
  SMTP_PORT: Number(process.env.SMTP_PORT) || 587,
  SMTP_SECURE: String(process.env.SMTP_SECURE || "").toLowerCase() === "true",
  SMTP_USER: process.env.SMTP_USER || "",
  SMTP_PASS: process.env.SMTP_PASS || "",
  SMTP_FROM: process.env.SMTP_FROM || "",
  SMTP_REPLY_TO: process.env.SMTP_REPLY_TO || ""
};

export function hasRazorpayConfig() {
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
}

export function hasMailerConfig() {
  return Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS && env.SMTP_FROM);
}

export { projectRoot };
