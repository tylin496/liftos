import { createClient } from "@supabase/supabase-js";

// POST /api/health-sync
// Ingest endpoint for the Apple Shortcut. Payload (DO NOT change shape):
//   { date: "YYYY-MM-DD", weight: number|"", bodyFat: number|"",
//     activeEnergy: number|"", restingEnergy: number|"" }
// Upserts one row per date into Supabase body_metrics. Empty/non-numeric
// fields are OMITTED from the upsert (not written as null), so running the
// Shortcut multiple times a day never overwrites a previously-synced value
// with a blank. Only fields that arrive with a real number are updated.
//
// Required server env (Vercel project settings):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, HEALTH_SYNC_USER_ID
// Optional: HEALTH_SYNC_SECRET — when set, the request must carry it as
//   `x-sync-secret: <secret>` header or `?secret=<secret>` query param.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "" / null / undefined / non-numeric → null. Otherwise the number. */
function num(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const intOrNull = (v) => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};

/** Validate + normalize the Shortcut payload into a body_metrics row. */
export function buildRecord(body) {
  if (!body || typeof body !== "object") {
    return { error: "Missing JSON body" };
  }
  const { date } = body;
  if (typeof date !== "string" || !DATE_RE.test(date)) {
    return { error: "Invalid or missing 'date' (expected YYYY-MM-DD)" };
  }

  // Only include fields that carry a real value — null/blank fields are
  // dropped so they don't overwrite an existing row's value on conflict.
  const record = { metric_date: date };
  const weight = num(body.weight);
  if (weight !== null) record.weight_kg = weight;
  const bodyFat = num(body.bodyFat);
  if (bodyFat !== null) record.body_fat_pct = bodyFat;
  const active = intOrNull(body.activeEnergy);
  if (active !== null) record.active_energy_kcal = active;
  const resting = intOrNull(body.restingEnergy);
  if (resting !== null) record.resting_energy_kcal = resting;

  return { record };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-sync-secret");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
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

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const userId = process.env.HEALTH_SYNC_USER_ID;
  if (!url || !serviceKey || !userId) {
    return res.status(500).json({
      error:
        "Server not configured: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, HEALTH_SYNC_USER_ID",
    });
  }

  const body =
    typeof req.body === "string" ? safeParse(req.body) : req.body;
  const { record, error } = buildRecord(body);
  if (error) return res.status(400).json({ error });

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const { data, error: dbErr } = await supabase
    .from("body_metrics")
    .upsert(
      { user_id: userId, ...record },
      { onConflict: "user_id,metric_date" },
    )
    .select("*")
    .single();

  if (dbErr) {
    return res.status(500).json({ error: dbErr.message });
  }
  return res.status(200).json({ ok: true, record: data });
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
