# Health sync — iOS Shortcut → LiftOS

The nightly Apple Shortcut POSTs to **`/api/health-sync`** (Vercel function in
`api/health-sync.js`). Payload shape is fixed by the Shortcut:

```json
{
  "date": "YYYY-MM-DD",
  "weight": 93.6,         // or ""
  "bodyFat": 20.4,        // or ""
  "activeEnergy": 540,    // or ""
  "restingEnergy": 1800   // or ""
}
```

- Empty strings → `null`. Energies are rounded to integers; weight/body-fat keep decimals.
- Upserts one row per `date` into `body_metrics` (unique key `user_id, metric_date`).
- Idempotent: re-running the Shortcut for a date overwrites that day.

## Required env (Vercel project settings)

| Var | What |
|-----|------|
| `SUPABASE_URL` | `https://gcznowwjbeqihhllllpz.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key (server-only; bypasses RLS) |
| `HEALTH_SYNC_USER_ID` | The owner's `auth.users.id` — the account that views the data |
| `HEALTH_SYNC_SECRET` | *(optional)* if set, request must send `x-sync-secret: <secret>` or `?secret=` |

Find `HEALTH_SYNC_USER_ID`: after signing in with Google, Supabase Dashboard →
Authentication → Users → your row → User UID.

## Reading

Frontend reads directly from Supabase under RLS:
- `src/features/health/api.ts` → `fetchBodyMetrics()`, `fetchHealthData()`
- `src/features/health/tdee.ts` → `estimateTdee()` (regression-based, energy balance)

The Health page shows Weight / Body Fat / Active Energy / Resting Energy history
plus the Estimated TDEE with a confidence rating.

## Verified

With 30 days of seed data (avg intake 2014 kcal, weight trend ~−0.086 kg/day):
Estimated TDEE **2675 kcal/day**, confidence ★★★★★ — matches `avgIntake − slope×7700`.
