// In-memory mock for the Calorie Tracker API.
// Used by scripts/dev-server.mjs when NOTION_TOKEN is missing so the UI is
// fully interactive locally without a real Notion database.

const FAT_KCAL_PER_KG = 7700;

function pad(n) {
  return String(n).padStart(2, "0");
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseLocalDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date, delta) {
  const next = new Date(date);
  next.setDate(date.getDate() + delta);
  return next;
}

function getWeekBounds(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = addDays(date, diffToMonday);
  const sunday = addDays(monday, 6);
  return { start: formatDate(monday), end: formatDate(sunday) };
}

function seedEntries() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cutStart = formatDate(addDays(today, -42));

  // 14 days of data ending today, skip a couple to simulate missed days.
  const skipOffsets = new Set([3, 8]);
  const entries = [];
  for (let offset = 13; offset >= 0; offset -= 1) {
    if (skipOffsets.has(offset)) continue;
    const day = addDays(today, -offset);
    const wave = Math.sin(offset * 0.9);
    const calories = Math.round(2050 + wave * 220 - offset * 4);
    const protein = Math.round(178 + Math.cos(offset * 0.7) * 18);
    entries.push({
      id: `mock-${formatDate(day)}`,
      date: formatDate(day),
      calories,
      protein,
      tdee: 2705,
      calorieTarget: 2050,
      proteinTarget: 180,
      cutStartDate: cutStart,
      cutPhaseIndex: 1,
      cutPhaseName: "Moderate Cut",
      cutWeek: Math.floor(offset / 7) + 1,
      deficitTarget: 655
    });
  }
  return { cutStart, entries };
}

const seed = seedEntries();

const state = {
  config: {
    tdee: 2705,
    proteinTarget: 180,
    deficitTarget: 500,
    hasCutPhaseSettings: true,
    cutStartDate: seed.cutStart,
    activeCutPhase: 1,
    cutPhaseDeficits: [805, 655, 455, 150]
  },
  entries: seed.entries
};

function summarizeWeek(today, fallbackTdee, entries, start, end) {
  const todayEntry = entries.find((entry) => entry.date === today) || null;
  const count = entries.length;
  const totalCalories = entries.reduce((sum, entry) => sum + entry.calories, 0);
  const totalProtein = entries.reduce((sum, entry) => sum + entry.protein, 0);
  const totalDeficit = entries.reduce((sum, entry) => {
    return sum + ((entry.tdee || fallbackTdee) - entry.calories);
  }, 0);
  const deficits = entries.map((entry) => (entry.tdee || fallbackTdee) - entry.calories);
  const averageDeficit = deficits.length
    ? deficits.reduce((sum, value) => sum + value, 0) / deficits.length
    : 0;
  const averageVariance = deficits.length
    ? deficits.reduce((sum, value) => sum + Math.abs(value - averageDeficit), 0) / deficits.length
    : 0;
  const consistency =
    count < 3
      ? "Building"
      : averageVariance < 250
      ? "Stable"
      : averageVariance < 500
      ? "Moderate"
      : "Variable";

  return {
    weekStart: start,
    weekEnd: end,
    tdee: fallbackTdee,
    count,
    todayLogged: Boolean(todayEntry),
    todayEntry,
    averageCalories: count ? Math.round(totalCalories / count) : 0,
    averageProtein: count ? Math.round(totalProtein / count) : 0,
    totalDeficit,
    fatLossKg: totalDeficit / FAT_KCAL_PER_KG,
    consistency,
    entries
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function toNumberOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function handleConfigGet(res) {
  sendJson(res, 200, { ok: true, config: state.config });
}

function handleConfigPost(res, body) {
  if (body.tdee !== undefined) state.config.tdee = Math.round(Number(body.tdee)) || state.config.tdee;
  if (body.proteinTarget !== undefined) state.config.proteinTarget = Math.round(Number(body.proteinTarget)) || state.config.proteinTarget;
  if (body.deficitTarget !== undefined) state.config.deficitTarget = Math.round(Number(body.deficitTarget));
  if (body.cutStartDate !== undefined) state.config.cutStartDate = body.cutStartDate || null;
  if (body.activeCutPhase !== undefined) state.config.activeCutPhase = body.activeCutPhase === null ? null : Number(body.activeCutPhase);
  if (Array.isArray(body.cutPhaseDeficits)) {
    state.config.cutPhaseDeficits = body.cutPhaseDeficits.map((value, index) => {
      const next = Number(value);
      return Number.isFinite(next) ? Math.round(next) : state.config.cutPhaseDeficits[index];
    });
  }
  state.config.hasCutPhaseSettings = true;
  sendJson(res, 200, { ok: true, config: state.config });
}

function handleSummary(res, url) {
  const today = url.searchParams.get("today") || formatDate(new Date());
  const tdee = toNumberOrNull(url.searchParams.get("tdee")) || state.config.tdee;
  const { start, end } = getWeekBounds(today);
  const weekEntries = state.entries.filter((entry) => entry.date >= start && entry.date <= end);
  sendJson(res, 200, { ok: true, summary: summarizeWeek(today, tdee, weekEntries, start, end) });
}

function handleSave(res, body) {
  if (!body?.date) {
    sendJson(res, 400, { error: "Invalid date" });
    return;
  }
  const entry = {
    id: `mock-${body.date}`,
    date: body.date,
    calories: Math.round(Number(body.calories) || 0),
    protein: Math.round(Number(body.protein) || 0),
    tdee: Math.round(Number(body.tdee) || state.config.tdee),
    calorieTarget: toNumberOrNull(body.calorieTarget),
    proteinTarget: toNumberOrNull(body.proteinTarget),
    cutStartDate: body.cutStartDate || null,
    cutPhaseIndex: body.cutPhaseIndex === null || body.cutPhaseIndex === undefined ? null : Number(body.cutPhaseIndex),
    cutPhaseName: body.cutPhaseName || null,
    cutWeek: toNumberOrNull(body.cutWeek),
    deficitTarget: toNumberOrNull(body.deficitTarget)
  };
  const index = state.entries.findIndex((existing) => existing.date === body.date);
  if (index >= 0) {
    state.entries[index] = entry;
    sendJson(res, 200, { ok: true, mode: "updated", id: entry.id });
  } else {
    state.entries.push(entry);
    state.entries.sort((a, b) => a.date.localeCompare(b.date));
    sendJson(res, 200, { ok: true, mode: "created", id: entry.id });
  }
}

function handleDelete(res, body) {
  const index = state.entries.findIndex((entry) => entry.date === body?.date);
  if (index < 0) {
    sendJson(res, 404, { error: "Entry not found" });
    return;
  }
  state.entries.splice(index, 1);
  sendJson(res, 200, { ok: true });
}

export function isMockMode() {
  return !process.env.NOTION_TOKEN;
}

export function getMockSummary() {
  return {
    entryCount: state.entries.length,
    firstDate: state.entries[0]?.date,
    lastDate: state.entries[state.entries.length - 1]?.date
  };
}

// Returns true when the request was handled (data routes only).
// Auth routes (/api/auth/*) are still served by the real handlers so the
// DEV_BYPASS_AUTH flow keeps working unchanged.
export function tryHandleMockApi(req, res, url, body) {
  const pathname = url.pathname;
  const method = req.method;

  if (!pathname.startsWith("/api/") || pathname.startsWith("/api/auth/")) {
    return false;
  }

  if (pathname === "/api/config" && method === "GET") {
    handleConfigGet(res);
    return true;
  }
  if (pathname === "/api/config" && method === "POST") {
    handleConfigPost(res, body || {});
    return true;
  }
  if (pathname === "/api/summary" && method === "GET") {
    handleSummary(res, url);
    return true;
  }
  if (pathname === "/api/save" && method === "POST") {
    handleSave(res, body || {});
    return true;
  }
  if (pathname === "/api/delete" && method === "POST") {
    handleDelete(res, body || {});
    return true;
  }

  return false;
}
