import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

const tournamentDb = createClient(env.SUPABASE_URL, env.SUPABASE_KEY, {
  db: {
    schema: env.TOURNAMENT_SCHEMA
  }
});

export default tournamentDb;
