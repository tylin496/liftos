import { createClient } from "npm:@supabase/supabase-js@2";

// /functions/v1/health-sync — Apple Health <-> LiftOS bridge for the Apple Shortcuts.
//   POST → ingest body metrics (Apple Health → LiftOS health_metrics).
//   GET  ?date=YYYY-MM-DD → export a day's logged calories + protein
//          (LiftOS nutrition_entries → Apple Health Dietary Energy/Protein).
//
// POST payload (DO NOT change shape):
//   { date: "YYYY-MM-DD", weight_kg: number|"", body_fat: number|"",
//     active_energy: number|"", resting_energy: number|"",
//     exercise_time: number|"",
//     sleep_seconds: number|"", resting_heart_rate: number|"", hrv: number|"" }
// Also accepts these camelCase aliases the iOS Shortcut's auto-generated variable names
// sometimes use instead of the snake_case names above: exerciseMinutes / exercise_minutes / excercises_time
// (exercise_time), sleepDuration (sleep_seconds), restingHeartRate (resting_heart_rate),
// heartRateVariability / hrvSdnn (hrv).
// Upserts one row per date into Supabase health_metrics. Empty/non-numeric
// fields are OMITTED from the upsert (not written as null), so running the
// Shortcut multiple times a day never overwrites a previously-synced value
// with a blank. Only fields that arrive with a real number are updated.
// weight_kg/body_fat/resting_heart_rate/hrv additionally require a plausible
// positive value, and sleep_seconds must exceed 1 hour — Shortcuts sometimes
// emits 0 instead of "" when a Health sample is missing, and these are never
// real readings. resting_energy is additionally dropped when it falls far below
// the user's recent median (see the anomaly guard below) — a HealthKit data
// gap rather than a real ~1300 kcal resting day. A dropped value is reported
// back as `droppedResting` in the response.
//
// Required secrets (`supabase secrets set ...`):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, HEALTH_SYNC_USER_ID
// Optional: HEALTH_SYNC_SECRET — when set, the request must carry it as
//   `x-sync-secret: <secret>` header or `?secret=<secret>` query param.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "" / null / undefined / non-numeric → null. Otherwise the number.
 * Tolerates trailing garbage some Shortcuts number conversions append
 * (e.g. "6749\n0") by reading the leading numeric token only.
 */
function num(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const firstLine = String(value)
    .replace(/,/g, "")
    .trim()
    .split(/\r?\n/, 1)[0];
  const match = firstLine.match(/^-?\d+(\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

const intOrNull = (v: unknown) => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};

// --- Resting-energy anomaly guard --------------------------------------------
// Apple sometimes reports a Resting Energy value far below the real daily
// figure (watch unworn all day, HealthKit not finished computing, sync
// interrupted, query straddling midnight). These are data gaps, not a real
// ~1300 kcal resting day, and they poison the 30-day rolling average in
// tdee.ts. Static floors don't work — a plausible resting value differs a lot
// between people — so judge each reading against the user's OWN recent median.

/** Days of prior readings to compare a new resting-energy value against. */
const RESTING_GUARD_WINDOW = 30;
/** Need at least this many prior readings before the guard can judge. */
const RESTING_GUARD_MIN_SAMPLES = 7;
/** Drop a reading below this fraction of the recent median. */
const RESTING_GUARD_FLOOR = 0.8;

export function median(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/**
 * True to keep a resting-energy reading, false to drop it as a HealthKit data
 * gap. Passes (keeps) when there isn't enough history to judge — the guard only
 * rejects a value that is far below an established personal median.
 */
export function isPlausibleResting(value: number, priorReadings: number[]): boolean {
  const recent = priorReadings.slice(0, RESTING_GUARD_WINDOW);
  if (recent.length < RESTING_GUARD_MIN_SAMPLES) return true;
  const med = median(recent);
  if (med === null || med <= 0) return true;
  return value >= med * RESTING_GUARD_FLOOR;
}

/** Validate + normalize the Shortcut payload into a health_metrics row. */
export function buildRecord(body: any): { record?: Record<string, unknown>; error?: string } {
  if (!body || typeof body !== "object") {
    return { error: "Missing JSON body" };
  }
  const rawDate = body.date;
  if (typeof rawDate !== "string" || rawDate.trim() === "") {
    return { error: "Missing 'date'" };
  }

  let metricDate: string;
  if (DATE_RE.test(rawDate)) {
    metricDate = rawDate;
  } else {
    const parsed = new Date(rawDate);
    if (Number.isNaN(parsed.getTime())) {
      return { error: "Invalid 'date'" };
    }
    metricDate = parsed.toISOString().slice(0, 10);
  }

  // Only include fields that carry a real value — null/blank fields are
  // dropped so they don't overwrite an existing row's value on conflict.
  const record: Record<string, unknown> = { metric_date: metricDate };
  const weight = num(body.weight_kg ?? body.weight);
  if (weight !== null && weight > 0) record.weight_kg = weight;
  const bodyFat = num(body.body_fat ?? body.body_fat_pct ?? body.bodyFat);
  if (bodyFat !== null && bodyFat > 0 && bodyFat < 100) record.body_fat_pct = bodyFat;
  const active = intOrNull(body.active_energy ?? body.activeEnergy);
  if (active !== null) record.active_energy_kcal = active;
  const resting = intOrNull(body.resting_energy ?? body.restingEnergy);
  if (resting !== null) record.resting_energy_kcal = resting;
  const exerciseMinutes = intOrNull(
    body.exercise_time ??
    body.exercise_minutes ??
    body.exerciseMinutes ??
    body.excercises_time
  );
  if (exerciseMinutes !== null) record.exercise_minutes = exerciseMinutes;

  const rawSleep = body.sleep_seconds ?? body.sleepDuration ?? body.sleepSeconds;
  let sleepSeconds = intOrNull(rawSleep);

  if (typeof rawSleep === "string") {
    const m = rawSleep.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    if (m) {
      sleepSeconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    }
  }

  if (sleepSeconds !== null && sleepSeconds > 3600) record.sleep_seconds = sleepSeconds;
  const restingHR = intOrNull(
    body.resting_heart_rate ??
    body.restingHeartRate
  );
  if (restingHR !== null && restingHR > 0) record.resting_heart_rate = restingHR;
  const hrv = num(
    body.hrv ??
    body.hrv_sdnn_ms ??
    body.heartRateVariability ??
    body.hrvSdnn
  );
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
      .select("entry_date, calories, protein")
      .eq("user_id", userId)
      .eq("entry_date", date)
      .maybeSingle();
    if (dbErr) return json({ error: dbErr.message }, 500);

    return json({
      ok: true,
      date,
      calories: data?.calories ?? null,
      protein: data?.protein ?? null,
    });
  }

  // POST = body metrics ingest (Apple Health → LiftOS).
  const body = await req.json().catch(() => null);
  console.log(JSON.stringify(body, null, 2));

  const { record, error } = buildRecord(body);
  if (error) return json({ error }, 400);

  // Anomaly guard: a resting-energy value far below the recent personal median
  // is a HealthKit data gap, not a real reading. Drop it (don't write) so it
  // never overwrites a good value or pollutes the rolling average. Compare
  // against prior days only — never the row we're about to upsert.
  let droppedResting: number | null = null;
  if (record.resting_energy_kcal != null) {
    const { data: hist } = await supabase
      .from("health_metrics")
      .select("resting_energy_kcal")
      .eq("user_id", userId)
      .neq("metric_date", record.metric_date)
      .not("resting_energy_kcal", "is", null)
      .order("metric_date", { ascending: false })
      .limit(RESTING_GUARD_WINDOW);
    const prior = (hist ?? [])
      .map((r) => r.resting_energy_kcal as number)
      .filter((n) => Number.isFinite(n));
    if (!isPlausibleResting(record.resting_energy_kcal as number, prior)) {
      droppedResting = record.resting_energy_kcal as number;
      delete record.resting_energy_kcal;
    }
  }

  const { data, error: dbErr } = await supabase
    .from("health_metrics")
    .upsert({ user_id: userId, ...record }, { onConflict: "user_id,metric_date" })
    .select("*")
    .single();

  if (dbErr) return json({ error: dbErr.message }, 500);
  return json({ ok: true, record: data, droppedResting });
});
