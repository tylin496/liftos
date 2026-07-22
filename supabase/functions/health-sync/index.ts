import { createClient } from "npm:@supabase/supabase-js@2";

// /functions/v1/health-sync — Apple Health <-> LiftOS bridge for the Apple Shortcuts.
//   POST → ingest body metrics (Apple Health → LiftOS health_metrics).
//   GET  ?date=YYYY-MM-DD → export a day's logged calories + protein
//          (LiftOS nutrition_entries → Apple Health Dietary Energy/Protein).
//
// POST payload — field names match the health_metrics columns exactly:
//   { date: "YYYY-MM-DD", weight_kg: number|"", body_fat_pct: number|"",
//     active_energy_kcal: number|"", resting_energy_kcal: number|"",
//     exercise_minutes: number|"", steps: number|"",
//     sleep_seconds: number|"", resting_heart_rate: number|"", hrv_sdnn_ms: number|"" }
// Also accepts these plain-English aliases: weight, bodyfat / body_fat, activeenergy /
// active_energy, restingenergy / resting_energy, sleep / asleep, restingheartrate / rhr,
// hrvsdnnms / hrv, stepcount / step_count. All field names (including these aliases) are matched
// case-insensitively, since Shortcuts derives variable names from step labels
// and their capitalization isn't something the user reliably controls.
// `date` is normally required, but a missing/blank one falls back to today in
// LOCAL_TZ (not the server's) — a safety net for when the Shortcut's date step
// glitches, not something to rely on.
// Upserts one row per date into Supabase health_metrics. Empty/non-numeric
// fields are OMITTED from the upsert (not written as null), so running the
// Shortcut multiple times a day never overwrites a previously-synced value
// with a blank. Only fields that arrive with a real number are updated.
// weight_kg/body_fat/resting_heart_rate/hrv additionally require a plausible
// positive value, and sleep_seconds must exceed 1 hour — Shortcuts sometimes
// emits 0 instead of "" when a Health sample is missing, and these are never
// real readings. resting_energy is additionally dropped when it falls far below
// the user's recent median (see the anomaly guard below) — a HealthKit data
// gap rather than a real ~1300 kcal resting day. active_energy gets the same
// treatment at a much lower threshold, and can then be BACKFILLED from steps
// (see the step-fallback block). Dropped values are reported back as
// `droppedResting` / `droppedActive`, a step-derived one as `estimatedActive`.
//
// Required secrets (`supabase secrets set ...`):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, HEALTH_SYNC_USER_ID
// Optional: HEALTH_SYNC_SECRET — when set, the request must carry it as
//   `x-sync-secret: <secret>` header or `?secret=<secret>` query param.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Single-user personal app — hardcode the user's timezone so a missing `date`
// defaults to the calendar day on their phone, not the server's (Deno Deploy
// runs in UTC; near midnight Taipei time that's a different day).
const LOCAL_TZ = "Asia/Taipei";

/**
 * Alias lookup that ignores case AND every separator. Shortcuts auto-generates
 * variable names from step output labels, so the same field arrives as
 * `weight_kg`, `Weight_Kg`, `WeightKG`, or `Weight KG` depending on how the
 * shortcut was built — and a label with a space in it is the normal case, not
 * the exception. Stripping non-alphanumerics collapses all of those onto one
 * key, so the alias lists below only need one spelling per name.
 */
const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function pick(keys: Map<string, unknown>, ...aliases: string[]): unknown {
  for (const alias of aliases) {
    const v = keys.get(normKey(alias));
    if (v !== undefined) return v;
  }
  return undefined;
}

function normalizeKeys(body: Record<string, unknown>): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const k of Object.keys(body)) map.set(normKey(k), body[k]);
  return map;
}

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

const round = (n: number, digits: number) => {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
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

// --- Active-energy guard + step fallback --------------------------------------
// Same failure as resting energy, different shape: an unworn watch leaves Active
// Energy at 0–25 kcal for the whole day. Averaged in, those days drag the 14-day
// avgActive (and therefore TDEE, and therefore the cut deficit) down.
//
// The threshold has to be FAR lower than resting's 0.8 — active energy genuinely
// swings 3–4x between a heavy training day and a couch day, and a real rest day
// must survive. 0.15x the personal median only catches "the watch was off".

const ACTIVE_GUARD_WINDOW = 30;
const ACTIVE_GUARD_MIN_SAMPLES = 7;
/** Drop an active reading below this fraction of the recent median. */
const ACTIVE_GUARD_FLOOR = 0.15;

/**
 * True to keep an active-energy reading, false to drop it as "watch not worn".
 * Same shape as isPlausibleResting: passes when history is too thin to judge.
 * `priorReadings` must contain measured values only — feeding step-derived
 * estimates back in would walk the median down over time.
 */
export function isPlausibleActive(value: number, priorReadings: number[]): boolean {
  const recent = priorReadings.slice(0, ACTIVE_GUARD_WINDOW);
  if (recent.length < ACTIVE_GUARD_MIN_SAMPLES) return true;
  const med = median(recent);
  if (med === null || med <= 0) return true;
  return value >= med * ACTIVE_GUARD_FLOOR;
}

/**
 * Step→active-energy conversion, 34 kcal per 1000 steps.
 *
 * This is a FLOOR, not an estimate, and the distinction is the whole design.
 * Regressing active energy on steps over 111 of this user's rest days gives
 * r² = 0.076 — steps explain almost none of the variance, because Apple's
 * Active Energy is dominated by a ~449 kcal/day intercept of non-step activity
 * that steps say nothing about. So steps can NOT predict a day's total.
 *
 * What they can do is bound it from below. Walking is mechanical work that
 * definitely happened: ~0.5 kcal/kg/km at 90.5 kg over ~0.75 km per 1000 steps
 * = 34 kcal. Two independent derivations agree on that number — the physics
 * above, and the fitted regression slope (34.0 kcal/1000 steps). The intercept
 * is what's unpredictable; the slope is solid.
 *
 * So a step-derived value claims only "at least this much was burned" and is
 * deliberately biased low. It never feeds TDEE (see tdee.ts) — a floor is not a
 * measurement, and the cut deficit is measured against measurements.
 */
const KCAL_PER_STEP = 0.034;

/**
 * Below this the phone probably wasn't carried either, so the step count says
 * nothing about the day. A 200-step day floors at 7 kcal, which is exactly the
 * bogus near-zero the guard just rejected — leave the day as no-reading instead,
 * which every average skips (a missing day is "unknown", never "did nothing").
 */
const MIN_STEPS_FOR_FLOOR = 1000;

/**
 * How far a step floor must exceed a measured reading before the reading is
 * treated as a partial-wear artifact.
 *
 * The threshold can sit this close to 1 because the argument is definitional,
 * not statistical: Active Energy *includes* walking, so a valid reading can
 * never be less than the walking it contains. floor > measured means the
 * measurement is incomplete, full stop. The 1.5 is slack for conversion error
 * and step miscounting, nothing more.
 *
 * Calibrated against this user's measured days: normal rest days sit at
 * floor/measured = 0.18 and training days at 0.13, so 1.5 clears typical days
 * by ~8x. Even a rest day 2 SD below average lands at 1.07. Dropping to 1.0
 * would start catching that day, which is why the slack stops at 1.5.
 *
 * Was 3 initially, which only caught the total-non-wear days. It missed the
 * case that actually matters here: this user wears the Apple Watch to sleep, so
 * a mechanical-watch day is never a zero day — it collects a couple hundred kcal
 * of evening and overnight wear, which cleared 3x and survived as a "measured"
 * value. Sleep tracking makes partial wear the normal failure mode, not the edge
 * case.
 */
const STEP_CROSSCHECK_RATIO = 1.5;

/** Step-derived floor on a day's active energy, or null when steps can't carry one. */
export function activeFloorFromSteps(steps: number | null | undefined): number | null {
  if (steps == null || !Number.isFinite(steps) || steps < MIN_STEPS_FOR_FLOOR) return null;
  return Math.round(steps * KCAL_PER_STEP);
}

/** Validate + normalize the Shortcut payload into a health_metrics row. */
export function buildRecord(body: any): { record?: Record<string, unknown>; error?: string } {
  if (!body || typeof body !== "object") {
    return { error: "Missing JSON body" };
  }
  const keys = normalizeKeys(body);
  let rawDate = pick(keys, "date");
  if (typeof rawDate !== "string" || rawDate.trim() === "") {
    rawDate = new Date().toLocaleDateString("sv-SE", { timeZone: LOCAL_TZ });
  }

  let metricDate: string;
  if (DATE_RE.test(rawDate as string)) {
    metricDate = rawDate as string;
  } else {
    const parsed = new Date(rawDate as string);
    if (Number.isNaN(parsed.getTime())) {
      return { error: "Invalid 'date'" };
    }
    metricDate = parsed.toISOString().slice(0, 10);
  }

  // Only include fields that carry a real value — null/blank fields are
  // dropped so they don't overwrite an existing row's value on conflict.
  const record: Record<string, unknown> = { metric_date: metricDate };
  const weight = num(pick(keys, "weight_kg", "weight"));
  if (weight !== null && weight > 0) record.weight_kg = round(weight, 2);
  const bodyFat = num(pick(keys, "body_fat_pct", "bodyfat", "body_fat"));
  if (bodyFat !== null && bodyFat > 0 && bodyFat < 100) record.body_fat_pct = round(bodyFat, 1);
  const active = intOrNull(pick(keys, "active_energy_kcal", "activeenergy", "active_energy"));
  if (active !== null) record.active_energy_kcal = active;
  const resting = intOrNull(pick(keys, "resting_energy_kcal", "restingenergy", "resting_energy"));
  if (resting !== null) record.resting_energy_kcal = resting;
  const exerciseMinutes = intOrNull(pick(keys, "exercise_minutes"));
  if (exerciseMinutes !== null) record.exercise_minutes = exerciseMinutes;
  const steps = intOrNull(pick(keys, "steps", "stepcount", "step_count"));
  if (steps !== null && steps >= 0) record.steps = steps;

  const rawSleep = pick(keys, "sleep_seconds", "sleep", "asleep");
  let sleepSeconds = intOrNull(rawSleep);

  if (typeof rawSleep === "string") {
    const m = rawSleep.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    if (m) {
      sleepSeconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    }
  }

  if (sleepSeconds !== null && sleepSeconds > 3600) record.sleep_seconds = sleepSeconds;
  const restingHR = intOrNull(pick(keys, "resting_heart_rate", "restingheartrate", "rhr"));
  if (restingHR !== null && restingHR > 0) record.resting_heart_rate = restingHR;
  const hrv = num(pick(keys, "hrv_sdnn_ms", "hrvsdnnms", "hrv"));
  if (hrv !== null && hrv > 0) record.hrv_sdnn_ms = round(hrv, 1);

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

  const { record, error } = buildRecord(body);
  if (error) return json({ error }, 400);

  // Ingest diagnostic: which payload fields arrived vs which ones actually
  // mapped onto a column. A field the Shortcut sends under an unrecognized name
  // is otherwise dropped in total silence — this is the only way to see it.
  // Key names only, never values: the log doesn't need the health data.
  console.log(
    JSON.stringify({
      ingest: record.metric_date,
      sent: Object.keys(body ?? {}).sort(),
      mapped: Object.keys(record).sort(),
    }),
  );

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

  // Active-energy guard + step fallback — PAST days only. Today's row syncs live
  // and is legitimately near-zero all morning (active energy accrues through the
  // day), so running the guard on it would flag every pre-noon sync and then
  // overwrite the Active Target ring's own number with a step estimate.
  const todayLocalISO = new Date().toLocaleDateString("sv-SE", { timeZone: LOCAL_TZ });
  const isPastDay = (record.metric_date as string) < todayLocalISO;

  let droppedActive: number | null = null;
  let estimatedActive: number | null = null;

  if (isPastDay) {
    const floor = activeFloorFromSteps(record.steps as number | undefined);

    if (record.active_energy_kcal != null) {
      const { data: hist } = await supabase
        .from("health_metrics")
        .select("active_energy_kcal")
        .eq("user_id", userId)
        .eq("active_energy_estimated", false)
        .neq("metric_date", record.metric_date)
        .not("active_energy_kcal", "is", null)
        .order("metric_date", { ascending: false })
        .limit(ACTIVE_GUARD_WINDOW);
      const prior = (hist ?? [])
        .map((r) => r.active_energy_kcal as number)
        .filter((n) => Number.isFinite(n));
      if (!isPlausibleActive(record.active_energy_kcal as number, prior)) {
        droppedActive = record.active_energy_kcal as number;
        delete record.active_energy_kcal;
      }
    }

    // Step cross-check. The median guard compares a reading against the user's
    // own history; this compares it against the SAME DAY's steps, which is
    // strictly better evidence. It catches the partial-wear case the median
    // guard structurally can't: a day that reads plausibly-low overall while the
    // phone counted five figures of steps. Verified against the Apple Health
    // export — e.g. a day the watch logged 99 kcal and 854 steps while the phone
    // counted 14,446. Walking alone puts a ~491 kcal floor under that day, so
    // the 99 is an artifact of a watch worn for an hour, not a quiet day.
    if (
      record.active_energy_kcal != null &&
      floor !== null &&
      floor > (record.active_energy_kcal as number) * STEP_CROSSCHECK_RATIO
    ) {
      droppedActive = record.active_energy_kcal as number;
      delete record.active_energy_kcal;
    }

    if (record.active_energy_kcal == null) {
      // No usable watch reading — fall back to the step floor. Never over a value
      // that was actually measured: a later re-sync of the same day can carry
      // steps but no active energy, and that must not demote a real reading.
      const estimate = floor;
      if (estimate !== null) {
        const { data: existing } = await supabase
          .from("health_metrics")
          .select("active_energy_kcal, active_energy_estimated")
          .eq("user_id", userId)
          .eq("metric_date", record.metric_date)
          .maybeSingle();
        // A stored measurement normally blocks the floor — a floor must never
        // demote a real reading. The exception is a stored value that fails the
        // same cross-check the incoming one just failed: an artifact written by
        // an earlier sync (before steps arrived for that day) is exactly what
        // this is here to replace, and leaving it would make the fix depend on
        // which sync happened to run first.
        const storedMeasured =
          existing?.active_energy_kcal != null && existing.active_energy_estimated === false
            ? (existing.active_energy_kcal as number)
            : null;
        const hasMeasured =
          storedMeasured !== null && estimate <= storedMeasured * STEP_CROSSCHECK_RATIO;
        if (!hasMeasured) {
          record.active_energy_kcal = estimate;
          record.active_energy_estimated = true;
          estimatedActive = estimate;
        }
      }
    } else {
      // A measured value clears an estimate a previous run left on this day.
      record.active_energy_estimated = false;
    }
  } else if (record.active_energy_kcal != null) {
    record.active_energy_estimated = false;
  }

  const { data, error: dbErr } = await supabase
    .from("health_metrics")
    .upsert({ user_id: userId, ...record }, { onConflict: "user_id,metric_date" })
    .select("*")
    .single();

  if (dbErr) return json({ error: dbErr.message }, 500);
  return json({ ok: true, record: data, droppedResting, droppedActive, estimatedActive });
});
