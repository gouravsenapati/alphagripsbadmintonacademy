import { env } from "./config/env.js";
import app from "./app.js";

app.listen(env.PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${env.PORT}`);
  console.log(
    `[config] Supabase host=${new URL(env.SUPABASE_URL).host} tournament_schema=${env.TOURNAMENT_SCHEMA}`
  );
});
