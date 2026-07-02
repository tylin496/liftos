import { createClient } from "npm:@supabase/supabase-js@2";

// /functions/v1/health-sync — Apple Health <-> LiftOS bridge for the Apple Shortcuts.
//   POST → ingest body metrics (Apple Health → LiftOS health_metrics).
//   GET  ?date=YYYY-MM-DD → export a day's logged calories + protein
//          (LiftOS nutrition_entries → Apple Health Dietary Energy/Protein).
//
// POST payload (DO NOT change shape):
//   { date: "YYYY-MM-DD", weight: number|"", bodyFat: number|"",
//     activeEnergy: number|"", restingEnergy: number|"",
//     steps: number|"", exerciseMinutes: number|"",
//     sleepSeconds: number|"", restingHeartRate: number|"", hrvSdnn: number|"" }
// Upserts one row per date into Supabase health_metrics. Empty/non-numeric
// fields are OMITTED from the upsert (not written as null), so running the
// Shortcut multiple times a day never overwrites a previously-synced value
// with a blank. Only fields that arrive with a real number are updated.
// weight/bodyFat/restingHeartRate/hrvSdnn additionally require a plausible
// positive value, and sleepSeconds must exceed 1 hour — Shortcuts sometimes
// emits 0 instead of "" when a Health sample is missing, and these are never
// real readings.
//
// Required secrets (`supabase secrets set ...`):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, HEALTH_SYNC_USER_ID
// Optional: HEALTH_SYNC_SECRET — when set, the request must carry it as
//   `x-sync-secret: <secret>` header or `?secret=<secret>` query param.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "" / null / undefined / non-numeric → null. Otherwise the number. */
function num(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const intOrNull = (v: unknown) => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};

/** Validate + normalize the Shortcut payload into a health_metrics row. */
export function buildRecord(body: any): { record?: Record<string, unknown>; error?: string } {
  if (!body || typeof body !== "object") {
    return { error: "Missing JSON body" };
  }
  const { date } = body;
  if (typeof date !== "string" || !DATE_RE.test(date)) {
    return { error: "Invalid or missing 'date' (expected YYYY-MM-DD)" };
  }

  // Only include fields that carry a real value — null/blank fields are
  // dropped so they don't overwrite an existing row's value on conflict.
  const record: Record<string, unknown> = { metric_date: date };
  const weight = num(body.weight);
  if (weight !== null && weight > 0) record.weight_kg = weight;
  const bodyFat = num(body.bodyFat);
  if (bodyFat !== null && bodyFat > 0 && bodyFat < 100) record.body_fat_pct = bodyFat;
  const active = intOrNull(body.activeEnergy);
  if (active !== null) record.active_energy_kcal = active;
  const resting = intOrNull(body.restingEnergy);
  if (resting !== null) record.resting_energy_kcal = resting;
  const steps = intOrNull(body.steps);
  if (steps !== null) record.steps = steps;
  const exerciseMinutes = intOrNull(body.exerciseMinutes);
  if (exerciseMinutes !== null) record.exercise_minutes = exerciseMinutes;
  const sleepSeconds = intOrNull(body.sleepSeconds);
  if (sleepSeconds !== null && sleepSeconds > 3600) record.sleep_seconds = sleepSeconds;
  const restingHR = intOrNull(body.restingHeartRate);
  if (restingHR !== null && restingHR > 0) record.resting_heart_rate = restingHR;
  const hrv = num(body.hrvSdnn);
  if (hrv !== null && hrv > 0) record.hrv_sdnn_ms = hrv;

  return { record };
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-sync-secret, Authorization",
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const reqUrl = new URL(req.url);

  // Optional shared-secret gate (only enforced when configured).
  const secret = Deno.env.get("HEALTH_SYNC_SECRET");
  if (secret) {
    const provided = req.headers.get("x-sync-secret") || reqUrl.searchParams.get("secret");
    if (provided !== secret) {
      return json({ error: "Unauthorized" }, 401);
    }
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const userId = Deno.env.get("HEALTH_SYNC_USER_ID");
  if (!url || !serviceKey || !userId) {
    return json(
      {
        error:
          "Server not configured: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, HEALTH_SYNC_USER_ID",
      },
      500,
    );
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  // GET = nutrition export (LiftOS → Apple Health). Returns one day's logged
  // calories + protein so a Shortcut can write them into Apple Health as
  // Dietary Energy / Protein.
  if (req.method === "GET") {
    const date = reqUrl.searchParams.get("date");
    if (typeof date !== "string" || !DATE_RE.test(date)) {
      return json({ error: "Invalid or missing 'date' (expected YYYY-MM-DD)" }, 400);
    }
    const { data, error: dbErr } = await supabase
      .from("nutrition_entries")
      .select("entry_date, calories, protein, dietary_exported_at")
      .eq("user_id", userId)
      .eq("entry_date", date)
      .maybeSingle();
    if (dbErr) return json({ error: dbErr.message }, 500);

    // Already exported once → return nulls so the Shortcut logs nothing.
    // Makes manual re-runs safe (Apple Health's logging is append-only).
    if (data?.dietary_exported_at) {
      return json({ ok: true, date, calories: null, protein: null, alreadyExported: true });
    }

    // First export of a day that actually has data → hand back the values
    // and stamp it so any later run skips.
    if (data && data.calories != null) {
      await supabase
        .from("nutrition_entries")
        .update({ dietary_exported_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("entry_date", date);
    }
    return json({
      ok: true,
      date,
      calories: data?.calories ?? null,
      protein: data?.protein ?? null,
      alreadyExported: false,
    });
  }

  // POST = body metrics ingest (Apple Health → LiftOS).
  const body = await req.json().catch(() => null);
  const { record, error } = buildRecord(body);
  if (error) return json({ error }, 400);

  const { data, error: dbErr } = await supabase
    .from("health_metrics")
    .upsert({ user_id: userId, ...record }, { onConflict: "user_id,metric_date" })
    .select("*")
    .single();

  if (dbErr) return json({ error: dbErr.message }, 500);
  return json({ ok: true, record: data });
});
