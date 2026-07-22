# Health sync — iOS Shortcut → LiftOS

The nightly Apple Shortcut POSTs to
**`https://gcznowwjbeqihhllllpz.supabase.co/functions/v1/health-sync`**
(Supabase Edge Function in `supabase/functions/health-sync/index.ts`).
Payload shape is fixed by the Shortcut:

```json
{
  "date": "YYYY-MM-DD",
  "weight_kg": 93.6,           // or ""
  "body_fat_pct": 20.4,        // or ""
  "active_energy_kcal": 540,   // or ""
  "resting_energy_kcal": 1800, // or ""
  "exercise_minutes": 42,      // or ""
  "steps": 8200,               // or ""
  "sleep_seconds": 25200,      // or ""
  "resting_heart_rate": 54,    // or ""
  "hrv_sdnn_ms": 38.2          // or ""
}
```

- Field names are matched case-insensitively and plain-English aliases are
  accepted (`weight`, `bodyfat`, `activeenergy`, `rhr`, `stepcount`, …) — the
  full alias list is in the header comment of `index.ts`.
- Empty strings → `null`. Energies/steps round to integers; weight/body-fat keep decimals.
- Upserts one row per `date` into `health_metrics` (unique key `user_id, metric_date`).
- Idempotent: re-running the Shortcut for a date updates only the fields that
  arrive with a real number — a blank never overwrites a previously-synced value.

## Data-gap guards

HealthKit reports a data gap as a very low number, not as missing data. Two
guards catch that, each judging a reading against the user's own recent median
(30-day window, ≥7 prior readings before the guard engages):

| Field | Threshold | On failure |
|-------|-----------|------------|
| `resting_energy_kcal` | < 0.8× median | dropped → `droppedResting` in the response |
| `active_energy_kcal` | < 0.15× median | dropped, then floored from steps → `droppedActive` / `estimatedActive` |

Active energy's threshold is far looser because it genuinely swings several-fold
between a training day and a couch day — 0.15× only catches "the watch was off".

**Step cross-check.** The median guard compares a reading against the user's own
history. A second check compares it against the *same day's* steps, which is
better evidence: when the step floor (below) exceeds the reading by **3×**, the
watch was worn for part of the day. That case reads plausibly-low against the
median and slips the first guard entirely — verified against the Apple Health
export, where one such day logged 99 kcal and 854 watch steps while the phone
counted 14,446.

**Step floor.** When a past day has no usable active reading but ≥1000 steps,
active energy is derived at **34 kcal / 1000 steps** and the row is marked
`active_energy_estimated = true`. Below 1000 steps the phone probably wasn't
carried either, so the day stays a no-reading (which every average skips) rather
than a fabricated near-zero. A floor never overwrites a measured value — except a
stored one that fails the same cross-check — and a later measured sync clears the
flag.

This is a floor, not an estimate, and the distinction drives the design.
Regressing active energy on steps over 111 rest days gives **r² = 0.076**: steps
explain almost none of the variance, because Active Energy is dominated by a
~449 kcal/day intercept of non-step activity. Steps cannot predict a day's total.
What they can do is bound it from below — walking is mechanical work that
definitely happened. The physics (~0.5 kcal/kg/km at 90.5 kg over ~0.75 km per
1000 steps) and the fitted regression slope agree on 34 kcal/1000 steps. The
intercept is unpredictable; the slope is solid. So a step-derived value claims
only "at least this much", and is deliberately biased low.

Both guards apply to **past days only** — today's row syncs live and is
legitimately near-zero all morning.

Readers split on the flag: TDEE windows (`tdee.ts`) and day-type baselines
(`math.ts`) exclude estimated days, since those calibrate targets; weekly active
totals and the Active Target ring include them — an estimate beats a hole in a
total.

## Required secrets (`supabase secrets set ...`)

| Var | What |
|-----|------|
| `SUPABASE_URL` | `https://gcznowwjbeqihhllllpz.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key (server-only; bypasses RLS) |
| `HEALTH_SYNC_USER_ID` | The owner's `auth.users.id` — the account that views the data |
| `HEALTH_SYNC_SECRET` | *(optional)* if set, request must send `x-sync-secret: <secret>` or `?secret=` |

Find `HEALTH_SYNC_USER_ID`: after signing in with Google, Supabase Dashboard →
Authentication → Users → your row → User UID.

## Deploying

```bash
supabase functions deploy health-sync --project-ref gcznowwjbeqihhllllpz --no-verify-jwt
supabase secrets set HEALTH_SYNC_USER_ID=<your-user-uid> \
  HEALTH_SYNC_SECRET=<optional-shared-secret> \
  --project-ref gcznowwjbeqihhllllpz
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by the
platform — don't set them manually (the CLI rejects `SUPABASE_`-prefixed
secrets anyway).

Edge Functions require Supabase's own JWT by default — `--no-verify-jwt` is
required here so the Shortcut (which has no Supabase session) isn't blocked
before the function's own `HEALTH_SYNC_SECRET` check ever runs.

## Reading

Frontend reads directly from Supabase under RLS:
- `src/features/health/api.ts` → `fetchBodyMetrics()`, `fetchHealthData()`
- `src/features/health/tdee.ts` → `estimateTdee()` (regression-based, energy balance)

The Health page shows Weight / Body Fat / Active Energy / Resting Energy history
plus the Estimated TDEE with a confidence rating.

## Verified

With 30 days of seed data (avg intake 2014 kcal, weight trend ~−0.086 kg/day):
Estimated TDEE **2675 kcal/day**, confidence ★★★★★ — matches `avgIntake − slope×7700`.
