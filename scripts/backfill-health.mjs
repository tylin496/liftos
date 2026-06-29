#!/usr/bin/env node
// Usage:
//   SUPABASE_URL=https://xxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   HEALTH_SYNC_USER_ID=your-uuid \
//   node scripts/backfill-health.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dir, "../.health-backfill.json");

const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://gcznowwjbeqihhllllpz.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USER_ID = process.env.HEALTH_SYNC_USER_ID ?? "ec71ae8e-9963-4202-af80-fd21b9df1b1a";

if (!SUPABASE_URL || !SERVICE_KEY || !USER_ID) {
  console.error("Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, HEALTH_SYNC_USER_ID");
  process.exit(1);
}

const rows = JSON.parse(readFileSync(DATA_PATH, "utf8"));
console.log(`Loaded ${rows.length} rows from ${DATA_PATH}`);

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const BATCH = 100;
let inserted = 0;
let errors = 0;

for (let i = 0; i < rows.length; i += BATCH) {
  const chunk = rows.slice(i, i + BATCH).map((r) => ({
    user_id: USER_ID,
    metric_date: r.date,
    weight_kg: r.weight_kg,
    body_fat_pct: r.body_fat_pct,
    active_energy_kcal: r.active_energy_kcal,
    resting_energy_kcal: r.resting_energy_kcal,
  }));

  const { error } = await supabase
    .from("body_metrics")
    .upsert(chunk, { onConflict: "user_id,metric_date" });

  if (error) {
    console.error(`Batch ${i}-${i + BATCH} error:`, error.message);
    errors++;
  } else {
    inserted += chunk.length;
    process.stdout.write(`\r${inserted}/${rows.length} rows upserted...`);
  }
}

console.log(`\nDone. ${inserted} upserted, ${errors} batch errors.`);
