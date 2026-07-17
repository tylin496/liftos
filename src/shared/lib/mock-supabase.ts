// Dev-only mock Supabase client. Active when VITE_DEV_BYPASS_AUTH=true.
// Implements the subset of the Supabase query builder used by this app,
// backed by an in-memory store so write operations work across the session.

import { REAL_HEALTH_METRICS } from "./mock-health-data";
import { REAL_TRAINING_LOGS } from "./mock-training-data";

const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// Deterministic "random" from index so data looks varied but is stable.
function fakeRand(seed: number, min: number, max: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return min + ((x - Math.floor(x)) * (max - min));
}

// ── Exercises ─────────────────────────────────────────────────────────────────

interface MockExercise {
  id: string; user_id: string; split: string; slug: string; name: string;
  target: string | null; note: string | null; assisted_mode: boolean;
  sort_order: number; archived: boolean; image_url: string | null;
  created_at: string; updated_at: string;
}

const EXERCISES: MockExercise[] = [
  // Push
  { id: "ex-01", user_id: DEV_USER_ID, split: "push", slug: "bench-press", name: "Bench Press", target: "5-8 × 3", note: null, assisted_mode: false, sort_order: 0, archived: false, image_url: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  { id: "ex-02", user_id: DEV_USER_ID, split: "push", slug: "pec-deck", name: "Pec Deck", target: "10-12 × 3", note: "2025：主要器材版本至 9 月", assisted_mode: false, sort_order: 1, archived: false, image_url: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  { id: "ex-03", user_id: DEV_USER_ID, split: "push", slug: "cable-fly", name: "Cable Fly", target: "10-12 × 3", note: null, assisted_mode: false, sort_order: 2, archived: false, image_url: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  { id: "ex-04", user_id: DEV_USER_ID, split: "push", slug: "incline-laterals", name: "Incline Laterals", target: "12 × 3", note: null, assisted_mode: false, sort_order: 3, archived: false, image_url: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  { id: "ex-05", user_id: DEV_USER_ID, split: "push", slug: "overhead-triceps-extension", name: "Overhead Triceps Extension", target: "12 × 2", note: "H16", assisted_mode: false, sort_order: 4, archived: false, image_url: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  // Pull
  { id: "ex-06", user_id: DEV_USER_ID, split: "pull", slug: "assisted-pullup", name: "Assisted Pull-up", target: "6-8 × 3", note: "25 就可以自重了", assisted_mode: true, sort_order: 0, archived: false, image_url: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  { id: "ex-07", user_id: DEV_USER_ID, split: "pull", slug: "plate-lat-pulldown", name: "Plate-Loaded Lat Pulldown", target: "10-12", note: null, assisted_mode: false, sort_order: 1, archived: false, image_url: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  { id: "ex-08", user_id: DEV_USER_ID, split: "pull", slug: "cable-lat-pulldown", name: "Cable Lat Pulldown", target: "10-12", note: null, assisted_mode: false, sort_order: 2, archived: false, image_url: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  { id: "ex-09", user_id: DEV_USER_ID, split: "pull", slug: "low-row", name: "Low Row", target: "10-12 × 3", note: null, assisted_mode: false, sort_order: 3, archived: false, image_url: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  { id: "ex-10", user_id: DEV_USER_ID, split: "pull", slug: "pull-around", name: "Pull-around", target: "10-12 × 2", note: null, assisted_mode: false, sort_order: 4, archived: false, image_url: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  { id: "ex-11", user_id: DEV_USER_ID, split: "pull", slug: "reverse-cable-flyes", name: "Reverse Cable Flyes", target: "12 × 3", note: "H8 · Sweep out", assisted_mode: false, sort_order: 5, archived: false, image_url: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  { id: "ex-12", user_id: DEV_USER_ID, split: "pull", slug: "preacher-curl", name: "Preacher Curl", target: "8-12 × 2", note: "2025：Curl 多版本，逐月取最高", assisted_mode: false, sort_order: 6, archived: false, image_url: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  // Legs
  { id: "ex-13", user_id: DEV_USER_ID, split: "legs", slug: "leg-curl", name: "Leg Curl", target: "12 × 3", note: null, assisted_mode: false, sort_order: 0, archived: false, image_url: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  { id: "ex-14", user_id: DEV_USER_ID, split: "legs", slug: "rdl", name: "RDL", target: "6-8 × 3", note: null, assisted_mode: false, sort_order: 1, archived: false, image_url: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  { id: "ex-15", user_id: DEV_USER_ID, split: "legs", slug: "squat", name: "Squat", target: "6-8 × 3", note: null, assisted_mode: false, sort_order: 2, archived: false, image_url: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  { id: "ex-16", user_id: DEV_USER_ID, split: "legs", slug: "leg-extension", name: "Leg Extension", target: "10-12 × 3", note: null, assisted_mode: false, sort_order: 3, archived: false, image_url: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
];

// ── Training logs ──────────────────────────────────────────────────────────────
// Real training log export (training_logs_rows.csv), stamped with the dev user id.

const TRAINING_LOGS = REAL_TRAINING_LOGS.map((r) => ({
  ...r,
  user_id: DEV_USER_ID,
  updated_at: r.created_at,
}));

// ── Nutrition config ───────────────────────────────────────────────────────────
// phase_deficits: [p0, p1, p2, p3, activeIdx] → active = idx 1 = 655 deficit
// calorie target = 2800 - 655 = 2145

// Manual QA toggle: flip to true to seed a Lean Bulk phase (intake above TDEE
// + a bulk baseline), so the bulk Journey card / re-rank / polarity paths can
// be eyeballed locally without editing Settings. Leave false for the normal
// cut fixture.
const DEV_BULK_PHASE = false;

const NUTRITION_CONFIG = {
  user_id: DEV_USER_ID,
  assume_complete_logging: false,
  tdee: 2800,
  protein_target: 175,
  phase_deficits: [805, 655, 455, 150, 1],
  height_cm: 178,
  training_age_months: 36,
  target_body_fat_pct: 12,
  target_tdee: 2800,
  // Cut baseline — pre-seeded so local dev doesn't re-show the initializer on
  // every reload (mockDb resets from this seed on each page load).
  cut_start_date: "2026-02-11",
  cut_start_body_fat_pct: 21.3,
  cut_start_weight: 98.4,
  // Bulk phase (0017) — null until a bulk actually starts, matching a fresh
  // production row so dev exercises the pre-baseline paths.
  bulk_start_date: null as string | null,
  bulk_start_weight: null as number | null,
  bulk_start_body_fat_pct: null as number | null,
  bulk_bf_ceiling: null as number | null,
  updated_at: "2026-06-01T00:00:00Z",
  ...(DEV_BULK_PHASE
    ? {
        // Intake goal 3,050 → deficit −250 → phaseFromDeficit names "Lean Bulk".
        phase_deficits: [805, 655, 455, 150, 3050],
        bulk_start_date: "2026-06-01",
        bulk_start_weight: 88.2,
        bulk_start_body_fat_pct: 14.5,
        bulk_bf_ceiling: 17,
      }
    : {}),
};

// ── Nutrition entries ──────────────────────────────────────────────────────────
// 30 days (Jun 1–30). Calories 1800-2400, protein 140-200.

function buildNutritionEntries() {
  const entries = [];
  for (let i = 0; i < 30; i++) {
    const date = daysAgo(29 - i);
    const calories = Math.round(fakeRand(i * 3, 1750, 2450));
    const protein = Math.round(fakeRand(i * 7, 140, 205));
    entries.push({
      id: `ne-${i}`,
      user_id: DEV_USER_ID,
      entry_date: date,
      calories,
      protein,
      tdee: 2800,
      calorie_target: 2145,
      protein_target: 175,
      deficit_target: 655,
      created_at: date + "T20:00:00Z",
      updated_at: date + "T20:00:00Z",
    });
  }
  return entries;
}

const NUTRITION_ENTRIES = buildNutritionEntries();

// ── Body metrics ───────────────────────────────────────────────────────────────
// Real Apple Health data (production health_metrics, last 365 days), stamped
// with the dev user id. Nulls are genuine gaps in the export, left as-is.

function buildBodyMetrics() {
  return REAL_HEALTH_METRICS.map((r) => ({ ...r, user_id: DEV_USER_ID }));
}

const BODY_METRICS = buildBodyMetrics();

// ── Nutrition evaluation (v2) ────────────────────────────────────────────────
// One persisted state row. Matches the seed above: Moderate Cut (target 2145),
// weight trending 99.0→96.8 over 180d ≈ −0.086 kg/wk → losing far slower than
// the 0.40–0.70 kg/wk band → below_target, high confidence (30d on target,
// dense daily weigh-ins, low scatter). The recompute path overwrites this on
// the first entry save; it's seeded so both cards render populated on load.

const NUTRITION_EVALUATION = {
  user_id: DEV_USER_ID,
  status: "below_target",
  observed_rate: -0.086,
  accel_direction: "slowing",
  target_min: 0.4,
  target_max: 0.7,
  confidence: "high",
  evaluated_at: daysAgo(0) + "T06:00:00Z",
  estimated_tdee: 2740,
  estimated_intake: 2645,
  intake_difference: 500,
  calorie_target: 2145,
  cut_mode: "Moderate Cut",
  window_days: 21,
  weight_data_points: 21,
  logged_intake: 2520,
  intake_gap: 125, // estimated_intake − logged_intake
  longest_gap: 1,
  rec_source: "nutrition",
  rec_priority: 72,
  // Mirror what the live engine actually persists for this state (too-slow loss,
  // high confidence): nutritionProvider surfaces the decision's eventType as the
  // title and actionLine as the subtitle — NOT the `reason` sentence. Keep these
  // in lock-step with nutritionDecision so the mock shows the real card shape.
  rec_title: "Review calorie target",
  rec_subtitle: "Weight loss has slowed",
  created_at: daysAgo(0) + "T06:00:00Z",
  updated_at: daysAgo(0) + "T06:00:00Z",
};

// ── In-memory store (mutable so write ops work during the session) ─────────────

const mockDb = {
  exercises: [...EXERCISES] as unknown as Record<string, unknown>[],
  training_logs: [...TRAINING_LOGS] as unknown as Record<string, unknown>[],
  nutrition_config: [{ ...NUTRITION_CONFIG }] as Record<string, unknown>[],
  nutrition_entries: [...NUTRITION_ENTRIES] as Record<string, unknown>[],
  nutrition_evaluations: [{ ...NUTRITION_EVALUATION }] as Record<string, unknown>[],
  health_metrics: [...BODY_METRICS] as Record<string, unknown>[],
};

type TableName = keyof typeof mockDb;

// ── Query builder ──────────────────────────────────────────────────────────────

class MockBuilder {
  private _table: TableName;
  private _op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  private _payload: Record<string, unknown>[] = [];
  private _writeOpts: Record<string, unknown> | null = null;
  private _filters: Array<(r: Record<string, unknown>) => boolean> = [];
  private _sorts: Array<[string, boolean]> = [];
  private _limitN: number | null = null;
  private _countOnly = false;
  private _inWriteMode = false;
  private _returning = false;

  constructor(table: string) {
    if (!(table in mockDb)) {
      console.warn(`[mock-supabase] unknown table: ${table}`);
    }
    this._table = (table in mockDb ? table : "exercises") as TableName;
  }

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this._inWriteMode) {
      this._returning = true;
    } else if (opts?.count === "exact") {
      this._countOnly = true;
    }
    return this;
  }

  eq(col: string, val: unknown) {
    this._filters.push((r) => r[col] === val);
    return this;
  }

  gte(col: string, val: unknown) {
    this._filters.push((r) => (r[col] as string) >= (val as string));
    return this;
  }

  lte(col: string, val: unknown) {
    this._filters.push((r) => (r[col] as string) <= (val as string));
    return this;
  }

  ilike(col: string, pattern: string) {
    const re = new RegExp(pattern.replace(/%/g, ".*"), "i");
    this._filters.push((r) => re.test(String(r[col] ?? "")));
    return this;
  }

  // Negated filter. Only the shapes we actually use are supported — today that's
  // `.not("col", "is", null)` (i.e. WHERE col IS NOT NULL) and plain equality.
  not(col: string, op: string, val: unknown) {
    if (op === "is" && val === null) {
      this._filters.push((r) => r[col] != null);
    } else {
      this._filters.push((r) => r[col] !== val);
    }
    return this;
  }

  order(_col: string, _opts?: { ascending?: boolean }) {
    this._sorts.push([_col, _opts?.ascending !== false]);
    return this;
  }

  limit(n: number) {
    this._limitN = n;
    return this;
  }

  insert(payload: Record<string, unknown> | Record<string, unknown>[]) {
    this._op = "insert";
    this._payload = Array.isArray(payload) ? payload : [payload];
    this._inWriteMode = true;
    return this;
  }

  upsert(
    payload: Record<string, unknown> | Record<string, unknown>[],
    opts?: Record<string, unknown>,
  ) {
    this._op = "upsert";
    this._payload = Array.isArray(payload) ? payload : [payload];
    this._writeOpts = opts ?? null;
    this._inWriteMode = true;
    return this;
  }

  update(patch: Record<string, unknown>) {
    this._op = "update";
    this._payload = [patch];
    this._inWriteMode = true;
    return this;
  }

  delete() {
    this._op = "delete";
    this._inWriteMode = true;
    return this;
  }

  async maybeSingle() {
    const r = this._execute();
    if (r.error) return { data: null, error: r.error };
    const arr = r.data as Record<string, unknown>[];
    return { data: arr?.[0] ?? null, error: null };
  }

  async single() {
    const r = this._execute();
    if (r.error) return { data: null, error: r.error };
    const arr = r.data as Record<string, unknown>[];
    const row = arr?.[0] ?? null;
    return { data: row, error: row ? null : { message: "No rows found", code: "PGRST116" } };
  }

  then(
    onFulfilled?: (value: unknown) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) {
    return Promise.resolve(this._execute()).then(onFulfilled, onRejected);
  }

  private _filtered() {
    const store = mockDb[this._table];
    return store.filter((r) => this._filters.every((f) => f(r)));
  }

  private _sorted(rows: Record<string, unknown>[]) {
    if (!this._sorts.length) return rows;
    return [...rows].sort((a, b) => {
      for (const [col, asc] of this._sorts) {
        const av = (a[col] ?? "") as string;
        const bv = (b[col] ?? "") as string;
        if (av < bv) return asc ? -1 : 1;
        if (av > bv) return asc ? 1 : -1;
      }
      return 0;
    });
  }

  private _execute(): { data: unknown; error: unknown; count?: number } {
    const store = mockDb[this._table];

    if (this._op === "select") {
      let rows = this._sorted(this._filtered());
      if (this._limitN !== null) rows = rows.slice(0, this._limitN);
      if (this._countOnly) return { data: null, error: null, count: rows.length };
      return { data: rows, error: null };
    }

    if (this._op === "insert") {
      const inserted: Record<string, unknown>[] = [];
      for (const row of this._payload) {
        const newRow = {
          id: `mock-${Math.random().toString(36).slice(2)}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...row,
        };
        store.push(newRow);
        inserted.push(newRow);
      }
      return { data: inserted, error: null };
    }

    if (this._op === "upsert") {
      const ignoreDups = this._writeOpts?.ignoreDuplicates === true;
      const conflictKey = (this._writeOpts?.onConflict as string) ?? "id";
      const keys = conflictKey.split(",").map((k) => k.trim());
      const upserted: Record<string, unknown>[] = [];

      for (const row of this._payload) {
        const existingIdx = store.findIndex((r) => keys.every((k) => r[k] === row[k]));
        if (existingIdx >= 0) {
          if (!ignoreDups) {
            Object.assign(store[existingIdx], row, { updated_at: new Date().toISOString() });
          }
          upserted.push(store[existingIdx]);
        } else {
          const newRow = {
            id: `mock-${Math.random().toString(36).slice(2)}`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...row,
          };
          store.push(newRow);
          upserted.push(newRow);
        }
      }
      return { data: this._returning ? upserted : null, error: null };
    }

    if (this._op === "update") {
      const patch = this._payload[0];
      const updated: Record<string, unknown>[] = [];
      for (const row of store) {
        if (this._filters.every((f) => f(row))) {
          Object.assign(row, patch, { updated_at: new Date().toISOString() });
          updated.push(row);
        }
      }
      return { data: this._returning ? updated : null, error: null };
    }

    if (this._op === "delete") {
      const toRemove = this._filtered();
      for (const row of toRemove) {
        const idx = store.indexOf(row);
        if (idx !== -1) store.splice(idx, 1);
      }
      return { data: null, error: null };
    }

    return { data: [], error: null };
  }
}

// ── Mock Supabase client ───────────────────────────────────────────────────────

const DEV_USER = {
  id: DEV_USER_ID,
  aud: "authenticated",
  role: "authenticated",
  email: "dev@local",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  app_metadata: {},
  user_metadata: { full_name: "Dev User", avatar_url: "" },
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  identities: [],
  factors: [],
};

export const mockSupabase = {
  from(table: string) {
    return new MockBuilder(table);
  },

  auth: {
    async getUser() {
      return { data: { user: DEV_USER }, error: null };
    },
    async getSession() {
      return { data: { session: null }, error: null };
    },
    onAuthStateChange(_event: unknown, _cb: unknown) {
      return { data: { subscription: { unsubscribe() {} } } };
    },
    async signInWithOAuth() {
      return { error: null };
    },
    async signOut() {
      return { error: null };
    },
  },

  storage: {
    from(_bucket: string) {
      return {
        upload(_path: string, _blob: unknown, _opts?: unknown) {
          return Promise.resolve({ error: null });
        },
        getPublicUrl(path: string) {
          return { data: { publicUrl: `https://placeholder.dev/mock/${path}` } };
        },
      };
    },
  },
};
