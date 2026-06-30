import { createClient } from "@supabase/supabase-js";

// GET /api/nutrition-export?date=YYYY-MM-DD[&secret=...]
// Read-only companion to /api/health-sync, for the reverse direction:
// an Apple Shortcut pulls a day's LiftOS-logged nutrition and writes it into
// Apple Health (Dietary Energy / Protein). Returns the nutrition_entries row's
// calories + protein for one date (null when nothing was logged that day).
//
// Required server env (same as health-sync):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, HEALTH_SYNC_USER_ID
// Optional: HEALTH_SYNC_SECRET — when set, the request must carry it as
//   `x-sync-secret: <secret>` header or `?secret=<secret>` query param.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-sync-secret");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Optional shared-secret gate (only enforced when configured).
  const secret = process.env.HEALTH_SYNC_SECRET;
  if (secret) {
    const provided = req.headers["x-sync-secret"] || req.query?.secret;
    if (provided !== secret) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const date = req.query?.date;
  if (typeof date !== "string" || !DATE_RE.test(date)) {
    return res
      .status(400)
      .json({ error: "Invalid or missing 'date' (expected YYYY-MM-DD)" });
  }

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const userId = process.env.HEALTH_SYNC_USER_ID;
  if (!url || !serviceKey || !userId) {
    return res.status(500).json({
      error:
        "Server not configured: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, HEALTH_SYNC_USER_ID",
    });
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase
    .from("nutrition_entries")
    .select("entry_date, calories, protein")
    .eq("user_id", userId)
    .eq("entry_date", date)
    .maybeSingle();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({
    ok: true,
    date,
    calories: data?.calories ?? null,
    protein: data?.protein ?? null,
  });
}
