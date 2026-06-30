#!/usr/bin/env node
// Parses Apple Health export.xml → .health-backfill.json
// Usage: node scripts/parse-apple-health.mjs [/path/to/export.xml]

import { createReadStream } from "fs";
import { createInterface } from "readline";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const XML_PATH =
  process.argv[2] ?? "/Users/thomas/Downloads/apple_health_export/export.xml";
const OUT_PATH = join(__dir, "../.health-backfill.json");

// Aggregation strategies:
//   sumBySource  →  sum per source per day, then take MAX source (avoids
//                   double-counting when iPhone + Watch both log steps)
//   last         →  keep the reading with the latest creationDate
//   avg          →  arithmetic mean of all readings that day

const SIMPLE_TYPES = {
  HKQuantityTypeIdentifierStepCount:           { field: "steps",               agg: "sumBySource" },
  HKQuantityTypeIdentifierAppleExerciseTime:   { field: "exercise_minutes",    agg: "sumBySource" },
  HKQuantityTypeIdentifierActiveEnergyBurned:  { field: "active_energy_kcal",  agg: "sumBySource" },
  HKQuantityTypeIdentifierBasalEnergyBurned:   { field: "resting_energy_kcal", agg: "sumBySource" },
  HKQuantityTypeIdentifierRestingHeartRate:    { field: "resting_heart_rate",  agg: "last" },
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: { field: "hrv_sdnn_ms",   agg: "avg" },
  HKQuantityTypeIdentifierBodyMass:            { field: "weight_kg",           agg: "last" },
  HKQuantityTypeIdentifierBodyFatPercentage:   { field: "body_fat_pct",        agg: "last" },
};

// Only these sleep values count as actual sleep (excludes InBed + Awake)
const SLEEP_ASLEEP = new Set([
  "HKCategoryValueSleepAnalysisAsleepCore",
  "HKCategoryValueSleepAnalysisAsleepREM",
  "HKCategoryValueSleepAnalysisAsleepDeep",
  "HKCategoryValueSleepAnalysisAsleepUnspecified",
]);

// Accumulators
const sumBySource = {};   // { field: { date: { sourceName: total } } }
const lastVal = {};       // { field: { date: { value, creationDate } } }
const avgVals = {};       // { field: { date: number[] } }
const sleepBySource = {}; // { date: { sourceName: seconds } } — like sumBySource to avoid double-counting

for (const { field, agg } of Object.values(SIMPLE_TYPES)) {
  if (agg === "sumBySource") sumBySource[field] = {};
  else if (agg === "last") lastVal[field] = {};
  else if (agg === "avg") avgVals[field] = {};
}

// Fast attribute extraction (avoid regex overhead on 15M+ lines)
function getAttr(line, attr) {
  const needle = attr + '="';
  const i = line.indexOf(needle);
  if (i < 0) return null;
  const start = i + needle.length;
  const end = line.indexOf('"', start);
  return end < 0 ? null : line.slice(start, end);
}

// "2025-06-19 05:37:00 +0800" → "2025-06-19"
const dateOf = (s) => s.slice(0, 10);

let lineCount = 0;

const rl = createInterface({
  input: createReadStream(XML_PATH, { encoding: "utf8" }),
  crlfDelay: Infinity,
});

rl.on("line", (line) => {
  lineCount++;
  if (lineCount % 1_000_000 === 0) {
    process.stderr.write(`\r  ${(lineCount / 1e6).toFixed(0)}M lines...`);
  }

  if (!line.includes("<Record ")) return;

  const type = getAttr(line, "type");
  if (!type) return;

  // ── Sleep ────────────────────────────────────────────────────────────
  if (type === "HKCategoryTypeIdentifierSleepAnalysis") {
    const val = getAttr(line, "value");
    if (!SLEEP_ASLEEP.has(val)) return;
    const startDate = getAttr(line, "startDate");
    const endDate = getAttr(line, "endDate");
    if (!startDate || !endDate) return;
    // Attribute sleep to the date of wake-up (endDate's date)
    const date = dateOf(endDate);
    const secs = Math.max(
      0,
      (new Date(endDate).getTime() - new Date(startDate).getTime()) / 1000,
    );
    const src = getAttr(line, "sourceName") ?? "unknown";
    if (!sleepBySource[date]) sleepBySource[date] = {};
    sleepBySource[date][src] = (sleepBySource[date][src] ?? 0) + secs;
    return;
  }

  // ── All other quantity types ──────────────────────────────────────────
  const spec = SIMPLE_TYPES[type];
  if (!spec) return;

  const valueStr = getAttr(line, "value");
  if (!valueStr) return;
  const value = parseFloat(valueStr);
  if (!isFinite(value)) return;

  const startDate = getAttr(line, "startDate");
  if (!startDate) return;
  const date = dateOf(startDate);

  if (spec.agg === "sumBySource") {
    const src = getAttr(line, "sourceName") ?? "unknown";
    if (!sumBySource[spec.field][date]) sumBySource[spec.field][date] = {};
    sumBySource[spec.field][date][src] =
      (sumBySource[spec.field][date][src] ?? 0) + value;
  } else if (spec.agg === "last") {
    const cd = getAttr(line, "creationDate") ?? startDate;
    const cur = lastVal[spec.field][date];
    if (!cur || cd > cur.creationDate) {
      lastVal[spec.field][date] = { value, creationDate: cd };
    }
  } else if (spec.agg === "avg") {
    if (!avgVals[spec.field][date]) avgVals[spec.field][date] = [];
    avgVals[spec.field][date].push(value);
  }
});

rl.on("close", () => {
  process.stderr.write("\n  Building daily records...\n");

  // Gather all dates
  const allDates = new Set(Object.keys(sleepBySource));
  for (const m of [sumBySource, lastVal, avgVals]) {
    for (const dates of Object.values(m)) {
      for (const d of Object.keys(dates)) allDates.add(d);
    }
  }

  const rows = [];
  for (const date of [...allDates].sort()) {
    const row = { date };

    // sumBySource → MAX source total per day
    for (const field of Object.keys(sumBySource)) {
      const sources = sumBySource[field][date];
      row[field] = sources
        ? Math.round(Math.max(...Object.values(sources)))
        : null;
    }

    // last value
    for (const field of Object.keys(lastVal)) {
      const entry = lastVal[field][date];
      if (entry == null) { row[field] = null; continue; }
      if (field === "weight_kg") {
        row[field] = Math.round(entry.value * 10) / 10;
      } else if (field === "body_fat_pct") {
        // Apple Health stores as decimal fraction (0.268 = 26.8%)
        row[field] = Math.round(entry.value * 1000) / 10;
      } else {
        row[field] = Math.round(entry.value);
      }
    }

    // average
    for (const field of Object.keys(avgVals)) {
      const vals = avgVals[field][date];
      if (!vals?.length) { row[field] = null; continue; }
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      // HRV: 1 decimal
      row[field] = Math.round(mean * 10) / 10;
    }

    // sleep — take MAX source to avoid double-counting across Watch/apps
    const sources = sleepBySource[date];
    row.sleep_seconds = sources
      ? Math.round(Math.max(...Object.values(sources)))
      : null;

    rows.push(row);
  }

  writeFileSync(OUT_PATH, JSON.stringify(rows, null, 2));
  process.stderr.write(`  Done. ${rows.length} days → ${OUT_PATH}\n`);
});
