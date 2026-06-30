// Dev-only mock Supabase client. Active when VITE_DEV_BYPASS_AUTH=true.
// Implements the subset of the Supabase query builder used by this app,
// backed by an in-memory store so write operations work across the session.

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
// 6 sessions per split (push/pull/legs), oldest → newest.
// Session dates — within last 7 days = "this week" for overview.
// Push: ...28, Pull: ...27, Legs: ...26 → 3 sessions this week.

const PUSH_DATES = [daysAgo(37), daysAgo(30), daysAgo(23), daysAgo(16), daysAgo(9), daysAgo(2)];
const PULL_DATES = [daysAgo(38), daysAgo(31), daysAgo(24), daysAgo(17), daysAgo(10), daysAgo(3)];
const LEGS_DATES = [daysAgo(39), daysAgo(32), daysAgo(25), daysAgo(18), daysAgo(11), daysAgo(4)];

interface MockLog {
  id: string; user_id: string; exercise_slug: string;
  log_date: string; raw: string; reps: string; weight_kg: number;
  unit: string; note: string | null; kind: string;
  assistance: number | null; bodyweight: number | null;
  created_at: string; updated_at: string;
}

function makeLogs(slug: string, dates: string[], raws: string[]): MockLog[] {
  return dates.map((d, i) => {
    const raw = raws[i];
    const m = raw.match(/^([\d.]+)\*([\d]+)/);
    const w = m ? parseFloat(m[1]) : 50;
    const r = m ? m[2] : "8";
    return {
      id: `log-${slug}-${i}`,
      user_id: DEV_USER_ID,
      exercise_slug: slug,
      log_date: d,
      raw,
      reps: r,
      weight_kg: w,
      unit: "kg",
      note: null,
      kind: "normal",
      assistance: null,
      bodyweight: null,
      created_at: d + "T10:00:00Z",
      updated_at: d + "T10:00:00Z",
    };
  });
}

// Assisted pullup — use normal format with net weight for simplicity
function makePullupLogs(dates: string[], raws: string[]): MockLog[] {
  return dates.map((d, i) => {
    const raw = raws[i];
    const m = raw.match(/^97\.19-\(([\d.]+)\)\*([\d]+)/);
    const assist = m ? parseFloat(m[1]) : 25;
    const r = m ? m[2] : "6";
    return {
      id: `log-pullup-${i}`,
      user_id: DEV_USER_ID,
      exercise_slug: "assisted-pullup",
      log_date: d,
      raw,
      reps: r,
      weight_kg: 97.19 - assist,
      unit: "kg",
      note: null,
      kind: "assisted",
      assistance: assist,
      bodyweight: 97.19,
      created_at: d + "T10:00:00Z",
      updated_at: d + "T10:00:00Z",
    };
  });
}

const TRAINING_LOGS: MockLog[] = [
  // Push – bench press improving (recent 3 > prior 3 by ~7%)
  ...makeLogs("bench-press", PUSH_DATES, ["70*5", "70*6", "72.5*5", "75*5", "75*6", "77.5*5"]),
  // Push – pec deck stable
  ...makeLogs("pec-deck", PUSH_DATES, ["55*10", "55*11", "57.5*10", "57.5*11", "57.5*12", "57.5*12"]),
  // Push – cable fly improving
  ...makeLogs("cable-fly", PUSH_DATES, ["22.5*10", "22.5*12", "25*10", "25*11", "25*12", "27.5*10"]),
  // Push – incline laterals stable
  ...makeLogs("incline-laterals", PUSH_DATES, ["10*12", "10*12", "12*12", "12*12", "12*12", "12*12"]),
  // Push – overhead triceps improving
  ...makeLogs("overhead-triceps-extension", PUSH_DATES, ["27.5*12", "30*10", "30*12", "32.5*10", "32.5*12", "32.5*12"]),

  // Pull – assisted pullup improving (less assistance = stronger)
  ...makePullupLogs(PULL_DATES, ["97.19-(30)*6", "97.19-(30)*7", "97.19-(27.5)*6", "97.19-(25)*6", "97.19-(25)*7", "97.19-(25)*8"]),
  // Pull – plate lat pulldown stable
  ...makeLogs("plate-lat-pulldown", PULL_DATES, ["70*10", "70*11", "72.5*10", "72.5*10", "72.5*11", "72.5*12"]),
  // Pull – cable lat pulldown stable
  ...makeLogs("cable-lat-pulldown", PULL_DATES, ["60*10", "60*12", "62.5*10", "62.5*10", "62.5*11", "62.5*12"]),
  // Pull – low row stable
  ...makeLogs("low-row", PULL_DATES, ["60*10", "60*11", "62.5*10", "62.5*11", "62.5*12", "62.5*12"]),
  // Pull – pull-around stable
  ...makeLogs("pull-around", PULL_DATES, ["27.5*10", "27.5*12", "30*10", "30*10", "30*12", "30*12"]),
  // Pull – reverse cable flyes stable
  ...makeLogs("reverse-cable-flyes", PULL_DATES, ["12*12", "12*12", "12*12", "15*10", "15*10", "15*12"]),
  // Pull – preacher curl improving
  ...makeLogs("preacher-curl", PULL_DATES, ["30*10", "30*12", "32.5*10", "32.5*12", "35*8", "35*10"]),

  // Legs – leg curl stable
  ...makeLogs("leg-curl", LEGS_DATES, ["45*12", "45*12", "47.5*10", "47.5*12", "47.5*12", "50*10"]),
  // Legs – RDL improving (PR this month)
  ...makeLogs("rdl", LEGS_DATES, ["85*6", "85*7", "87.5*6", "90*6", "90*7", "92.5*6"]),
  // Legs – squat improving (PR this month)
  ...makeLogs("squat", LEGS_DATES, ["80*6", "80*7", "82.5*6", "85*6", "85*7", "87.5*5"]),
  // Legs – leg extension stable
  ...makeLogs("leg-extension", LEGS_DATES, ["55*12", "55*12", "57.5*10", "57.5*12", "60*10", "60*10"]),
];

// ── Nutrition config ───────────────────────────────────────────────────────────
// phase_deficits: [p0, p1, p2, p3, activeIdx] → active = idx 1 = 655 deficit
// calorie target = 2800 - 655 = 2145

const NUTRITION_CONFIG = {
  user_id: DEV_USER_ID,
  tdee: 2800,
  protein_target: 175,
  phase_deficits: [805, 655, 455, 150, 1],
  updated_at: "2026-06-01T00:00:00Z",
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
// 180 days of Apple Health data so the 6-month chart fills its window.
// Weight trending down from 99.0 → 96.8 over the half-year.

const BODY_METRIC_DAYS = 180;

function buildBodyMetrics() {
  const metrics = [];
  const last = BODY_METRIC_DAYS - 1;
  for (let i = 0; i < BODY_METRIC_DAYS; i++) {
    const date = daysAgo(last - i);
    const weightBase = 99.0 - (i / last) * 2.2; // 99.0 → 96.8
    const weight = Math.round((weightBase + fakeRand(i, -0.3, 0.3)) * 10) / 10;
    const resting = Math.round(fakeRand(i * 2, 1860, 1940));
    const active = Math.round(fakeRand(i * 5, 350, 720));
    const steps = Math.round(fakeRand(i * 11, 5800, 10500));
    const exercise = Math.round(fakeRand(i * 13, 30, 80));
    metrics.push({
      id: `bm-${i}`,
      user_id: DEV_USER_ID,
      metric_date: date,
      weight_kg: weight,
      resting_energy_kcal: resting,
      active_energy_kcal: active,
      steps,
      exercise_minutes: exercise,
      body_fat_pct: null,
      created_at: date + "T06:00:00Z",
      updated_at: date + "T06:00:00Z",
    });
  }
  return metrics;
}

const BODY_METRICS = buildBodyMetrics();

// ── In-memory store (mutable so write ops work during the session) ─────────────

const mockDb = {
  exercises: [...EXERCISES] as unknown as Record<string, unknown>[],
  training_logs: [...TRAINING_LOGS] as unknown as Record<string, unknown>[],
  nutrition_config: [{ ...NUTRITION_CONFIG }] as Record<string, unknown>[],
  nutrition_entries: [...NUTRITION_ENTRIES] as Record<string, unknown>[],
  body_metrics: [...BODY_METRICS] as Record<string, unknown>[],
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
