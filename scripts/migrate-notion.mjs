#!/usr/bin/env node
/**
 * One-time migration: Notion → Supabase
 * Migrates BOTH training logs (lift-log DB) and calorie entries (calorie tracker DB).
 *
 * Usage:
 *   NOTION_TOKEN=secret_xxx \
 *   NOTION_TRAINING_DB=<lift-log database ID> \
 *   NOTION_CALORIE_DB=<calorie tracker database ID> \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   SUPABASE_USER_ID=<your auth user UUID> \
 *   node scripts/migrate-notion.mjs
 *
 * Dry run (prints counts, no insert):
 *   DRY_RUN=1 NOTION_TOKEN=... NOTION_TRAINING_DB=... NOTION_CALORIE_DB=... \
 *   node scripts/migrate-notion.mjs
 *
 * Safe to re-run — upserts on unique keys, won't duplicate.
 */

// Read from config file if present, fall back to env vars
let _cfg = {};
try {
  const mod = await import("./migrate-config.mjs");
  _cfg = mod.config || {};
} catch { /* no config file — use env vars */ }

const NOTION_TOKEN     = _cfg.NOTION_TOKEN             || process.env.NOTION_TOKEN;
const TRAINING_DB      = (_cfg.NOTION_TRAINING_DB      || process.env.NOTION_TRAINING_DB  || "").replace(/-/g, "");
const CALORIE_DB       = (_cfg.NOTION_CALORIE_DB       || process.env.NOTION_CALORIE_DB   || "").replace(/-/g, "");
const SUPABASE_URL     = _cfg.SUPABASE_URL             || process.env.SUPABASE_URL || "https://gcznowwjbeqihhllllpz.supabase.co";
const SERVICE_KEY      = _cfg.SUPABASE_SERVICE_ROLE_KEY|| process.env.SUPABASE_SERVICE_ROLE_KEY;
const USER_ID          = _cfg.SUPABASE_USER_ID         || process.env.SUPABASE_USER_ID;
const DRY_RUN          = process.env.DRY_RUN === "1";

if (!NOTION_TOKEN) { console.error("❌  Need NOTION_TOKEN"); process.exit(1); }
// skip training if already done
if (!TRAINING_DB && !CALORIE_DB) {
  console.error("❌  Need at least one of NOTION_TRAINING_DB or NOTION_CALORIE_DB");
  process.exit(1);
}
if (!DRY_RUN && (!SERVICE_KEY || !USER_ID)) {
  console.error("❌  Need SUPABASE_SERVICE_ROLE_KEY and SUPABASE_USER_ID (or set DRY_RUN=1)");
  process.exit(1);
}

// ─── Notion helpers ───────────────────────────────────────────────────────────

const NOTION_HEADERS = {
  Authorization: `Bearer ${NOTION_TOKEN}`,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json",
};

function richText(prop) {
  return (prop?.rich_text ?? prop?.title ?? [])
    .map((t) => t.plain_text || "")
    .join("")
    .trim();
}

async function queryAll(dbId, filter) {
  const pages = [];
  let cursor;
  do {
    const body = { page_size: 100 };
    if (filter) body.filter = filter;
    if (cursor) body.start_cursor = cursor;

    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: "POST",
      headers: NOTION_HEADERS,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Notion error ${res.status}: ${err}`);
    }
    const data = await res.json();
    pages.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return pages;
}

// ─── Date parsing ─────────────────────────────────────────────────────────────

function parseTrainingDate(raw) {
  const s = (raw || "").trim();
  if (!s || s === "?") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;  // already ISO
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const [, mo, d, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  console.warn(`  ⚠️  Unrecognised date: "${s}" — skipping row`);
  return null;
}

// ─── Supabase upsert ──────────────────────────────────────────────────────────

async function insert(table, rows, onConflict) {
  if (!rows.length) return;
  const BATCH = 100;
  let done = 0;
  const url = onConflict
    ? `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`
    : `${SUPABASE_URL}/rest/v1/${table}`;
  const prefer = onConflict ? "resolution=merge-duplicates" : "return=minimal";
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: prefer,
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Supabase ${table} error ${res.status}: ${err}`);
    }
    done += batch.length;
    process.stdout.write(`\r  ↑ ${table}: ${done}/${rows.length}`);
  }
  process.stdout.write("\n");
}

// ─── Phase helper ─────────────────────────────────────────────────────────────

function phaseFromDeficit(d) {
  if (!d || d < 200) return "Maintenance";
  if (d < 500) return "Cruise";
  if (d < 800) return "Moderate Cut";
  return "Aggressive Cut";
}

// ─── Migrate training logs ────────────────────────────────────────────────────

async function migrateTraining() {
  if (!TRAINING_DB) { console.log("⏭️  No NOTION_TRAINING_DB — skipping training logs"); return 0; }
  console.log("\n🏋️  Fetching training logs from Notion…");

  const pages = await queryAll(TRAINING_DB, { property: "Kind", select: { equals: "log" } });
  console.log(`   Found ${pages.length} pages`);

  const rows = [];
  for (const page of pages) {
    const p = page.properties || {};
    const exerciseId = richText(p["Exercise ID"]);
    const raw        = richText(p.Raw);
    const dateStr    = parseTrainingDate(richText(p.Date));
    if (!exerciseId || !raw || !dateStr) continue;

    rows.push({
      user_id:       USER_ID,
      exercise_slug: exerciseId,
      log_date:      dateStr,
      raw,
      note:          richText(p.Note) || null,
      weight_kg:     p["Weight kg"]?.number ?? null,
      reps:          richText(p.Reps) || null,
      unit:          richText(p.Unit) || "kg",
      kind:          "normal",
    });
  }

  // Summary by exercise
  const byEx = {};
  for (const r of rows) byEx[r.exercise_slug] = (byEx[r.exercise_slug] || 0) + 1;
  for (const [slug, n] of Object.entries(byEx).sort())
    console.log(`     ${slug}: ${n} entries`);

  if (DRY_RUN) { console.log(`  [DRY RUN] Would insert ${rows.length} training rows`); return rows.length; }
  await insert("training_logs", rows, null);
  console.log(`  ✅  ${rows.length} training rows upserted`);
  return rows.length;
}

// ─── Migrate calorie entries ──────────────────────────────────────────────────

async function migrateCalories() {
  if (!CALORIE_DB) { console.log("⏭️  No NOTION_CALORIE_DB — skipping calorie entries"); return 0; }
  console.log("\n🥗  Fetching calorie entries from Notion…");

  const pages = await queryAll(CALORIE_DB);
  console.log(`   Found ${pages.length} pages`);

  const rows = [];
  for (const page of pages) {
    const p = page.properties || {};
    const dateStr = p.Date?.date?.start || null;  // Notion Date type → YYYY-MM-DD
    if (!dateStr) continue;

    const calories      = p.Calories?.number ?? 0;
    const protein       = p.Protein?.number ?? 0;
    const tdee          = p.TDEE?.number ?? 2705;
    const calorieTarget = p["Calorie Target"]?.number ?? null;
    const proteinTarget = p["Protein Target"]?.number ?? null;
    const deficitTarget = p["Deficit Target"]?.number ?? null;

    rows.push({
      user_id:         USER_ID,
      entry_date:      dateStr,
      calories:        Math.round(calories),
      protein:         Math.round(protein),
      tdee:            Math.round(tdee),
      calorie_target:  Math.round(calorieTarget ?? (tdee - (deficitTarget ?? 500))),
      protein_target:  Math.round(proteinTarget ?? 180),
      deficit_target:  Math.round(deficitTarget ?? 500),
      cut_phase_name:  phaseFromDeficit(deficitTarget),
    });
  }

  if (DRY_RUN) { console.log(`  [DRY RUN] Would insert ${rows.length} calorie rows`); return rows.length; }
  await insert("nutrition_entries", rows, "user_id,entry_date");
  console.log(`  ✅  ${rows.length} calorie rows upserted`);
  return rows.length;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("LiftOS · Notion → Supabase migration");
  console.log(DRY_RUN ? "MODE: DRY RUN (no data written)" : "MODE: LIVE INSERT");

  const t = await migrateTraining();
  const c = await migrateCalories();

  console.log(`\n✅  Done — ${t} training + ${c} calorie rows`);
}

main().catch((e) => { console.error("❌ ", e.message); process.exit(1); });
