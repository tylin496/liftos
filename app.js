let TDEE = 2705;
let PROTEIN_TARGET = 180;
let DEFICIT_TARGET = 500;
const API_BASE = (() => {
  if (typeof window === "undefined") return "https://calorie-tracker-omega-ten.vercel.app";
  const { hostname, origin } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return origin;
  return "https://calorie-tracker-omega-ten.vercel.app";
})();

const GOOGLE_CLIENT_ID = window.CALORIE_TRACKER_CONFIG?.GOOGLE_CLIENT_ID || "";
const GOOGLE_REDIRECT_URI = "https://tylin496.github.io/calorie-tracker/";
const OAUTH_STATE_KEY = "calorieTracker/oauth-state";

let authUser = null;
function toWaterStage(p) { return Math.round(p / 20) * 20; }
const AUTH_TOKEN_STORAGE_KEY = "calorieTrackerAuthToken";
function getStoredAuthToken() {
  try {
    return window.localStorage?.getItem(AUTH_TOKEN_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}
function setStoredAuthToken(token) {
  try {
    if (token) {
      window.localStorage?.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage?.removeItem(AUTH_TOKEN_STORAGE_KEY);
    }
  } catch {
    // localStorage may be unavailable (private mode); silently ignore.
  }
}
const LAST_LOGGED_DATE_STORAGE_KEY = "calorieTrackerLastLoggedDate";
const MIN_DIET_DATE = "2026-02-09";
const CALENDAR_INITIAL_HISTORY_MONTHS = 6;
const CALENDAR_HISTORY_CHUNK_MONTHS = 3;

// Cut phase tracking (Notion/server is source of truth)
const CUT_PHASE_NAMES = ["Aggressive Cut", "Moderate Cut", "Cruise", "Maintenance"];
const CUT_PHASE_DEFAULT_DEFICITS = [805, 655, 455, 150];
let cutStartDate = null;       // YYYY-MM-DD string or null
let activeCutPhase = null;     // 0 | 1 | 2 | 3 | null
let cutPhaseDeficits = [...CUT_PHASE_DEFAULT_DEFICITS];

// The date the app defaults to on launch: yesterday if before 6am, today otherwise
const DIET_INITIAL_DATE = (() => {
  const now = new Date();
  if (now.getHours() < 6) now.setDate(now.getDate() - 1);
  return formatDate(now);
})();

let todayLogged = false;
let todayEntry = null;
let currentDate = DIET_INITIAL_DATE;
let toastTimer = null;

const ANALYTICS_KEY = "usage_events";

function track(event) {
  try {
    const raw = localStorage.getItem(ANALYTICS_KEY);
    const events = raw ? JSON.parse(raw) : [];
    events.push({ event, ts: Date.now() });
    localStorage.setItem(ANALYTICS_KEY, JSON.stringify(events));
  } catch { /* storage full or blocked — fail silently */ }
}

window.usageReport = function() {
  try {
    const events = JSON.parse(localStorage.getItem(ANALYTICS_KEY) || "[]");
    const counts = {};
    const byDay = {};
    events.forEach(({ event, ts }) => {
      counts[event] = (counts[event] || 0) + 1;
      const day = new Date(ts).toISOString().slice(0, 10);
      byDay[day] = byDay[day] || {};
      byDay[day][event] = (byDay[day][event] || 0) + 1;
    });
    console.log("=== Usage Report ===");
    console.log("Totals:", Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join("\n"));
    console.log("By day:", byDay);
    return { counts, byDay, events };
  } catch { return {}; }
};
let celebrationTimer = null;
let calendarVisibleMonth = null;
let calendarHistoryMonths = CALENDAR_INITIAL_HISTORY_MONTHS;
let calendarIsExtending = false;
let latestWeekSummary = null;
let latestPhaseLog = null;
let viewportResizeHandler = null;
let quickEntryScrollY = 0;

const HAPTIC_PATTERNS = {
  tap: 8,
  select: 12,
  success: [18, 30, 18],
  warning: [28, 40, 28],
  error: [50, 40, 50]
};

// Count-up is opt-in per render: on first paint and after a save, not on every
// day-swipe (which would make rapid navigation feel noisy).
let pendingCountUp = true;
let lastTrendWeekStart = null;

function runDailyCountUp() {
  if (!pendingCountUp) return;
  pendingCountUp = false;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
  // rAF is throttled in background tabs — leave the real numbers in place.
  if (document.hidden) return;

  document.querySelectorAll("#daily-result .metric-figure[data-count-to]").forEach((el) => {
    const target = Number(el.dataset.countTo);
    if (!Number.isFinite(target) || target <= 0) return;
    animateCountUp(el, target);
  });
}

function animateCountUp(el, target) {
  const DURATION = 520;
  const start = performance.now();

  el.textContent = "0";
  function step(now) {
    const t = Math.min(1, (now - start) / DURATION);
    const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
    el.textContent = formatInt(target * eased);
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = formatInt(target);
  }
  requestAnimationFrame(step);
}

function triggerHaptic(kind = "tap") {
  if (!navigator.vibrate) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;

  const pattern = HAPTIC_PATTERNS[kind] || HAPTIC_PATTERNS.tap;
  navigator.vibrate(pattern);
}

function getDietDate() {
  return formatDate(new Date());
}

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getMonthStart(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function isValidDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function isFutureDate(dateString) {
  return new Date(`${dateString}T12:00:00`) > new Date(`${getDietDate()}T12:00:00`);
}

function isBeforeMinDietDate(dateString) {
  return new Date(`${dateString}T12:00:00`) < new Date(`${MIN_DIET_DATE}T12:00:00`);
}

function setStatus(msg, variant = null) {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = msg;
  el.dataset.variant = variant || "";
}

function showToast(message) {
  let toast = document.querySelector(".toast");

  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.classList.remove("visible");
  void toast.offsetWidth;
  toast.classList.add("visible");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("visible");
  }, 2200);
}

function getLastLoggedDate() {
  return localStorage.getItem(LAST_LOGGED_DATE_STORAGE_KEY);
}

function rememberLoggedDate(dateString) {
  localStorage.setItem(LAST_LOGGED_DATE_STORAGE_KEY, dateString);
}

function forgetLoggedDate(dateString) {
  if (getLastLoggedDate() === dateString) {
    localStorage.removeItem(LAST_LOGGED_DATE_STORAGE_KEY);
  }
}

function randomToken() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function createAuthError(message) {
  const error = new Error(message);
  error.isAuthError = true;
  return error;
}

function showAccessGate(message = "") {
  const gate = document.getElementById("accessGate");
  const error = document.getElementById("accessError");

  document.body.classList.add("auth-locked");
  if (gate) gate.hidden = false;
  if (error) error.textContent = message;
}

function hideAccessGate() {
  const gate = document.getElementById("accessGate");
  const error = document.getElementById("accessError");

  document.body.classList.remove("auth-locked");
  if (gate) gate.hidden = true;
  if (error) error.textContent = "";
}

function updateDietDayDisplay() {
  const btn = document.getElementById("diet-day");
  const label = document.getElementById("diet-day-label");
  const nextBtn = document.getElementById("nextDayBtn");
  const prevBtn = document.getElementById("prevDayBtn");
  const isAtDietToday = currentDate === getDietDate();
  const isAtMinDietDate = currentDate === MIN_DIET_DATE || isBeforeMinDietDate(currentDate);

  if (label) {
    const displayLabel = getDisplayDateLabel(currentDate, { todayStyle: "compact" });
    label.textContent = displayLabel;
    if (btn) {
      btn.setAttribute("aria-label", `Selected day ${displayLabel}`);
    }
  }

  if (nextBtn) {
    nextBtn.setAttribute("aria-disabled", String(isAtDietToday));
    nextBtn.disabled = isAtDietToday;
  }

  if (prevBtn) {
    prevBtn.setAttribute("aria-disabled", String(isAtMinDietDate));
    prevBtn.disabled = isAtMinDietDate;
  }
}

function animateDietDayLabel(direction) {
  const label = document.getElementById("diet-day-label");
  if (!label || !direction) return;
  label.removeAttribute("data-slide-in");
  void label.offsetWidth;
  label.dataset.slideIn = direction === "forward" ? "left" : "right";
  label.addEventListener("animationend", () => label.removeAttribute("data-slide-in"), { once: true });
}

function formatDailyIntakeTargetSummary() {
  return `TDEE ${formatInt(TDEE)} · ${formatInt(PROTEIN_TARGET)} g`;
}

function updateTargetForm() {
  const tdeeInput = document.getElementById("tdeeInput");
  const proteinInput = document.getElementById("proteinTargetInput");
  const summary = document.getElementById("targetSummary");
  const tdeeSummaryDisplay = document.getElementById("tdeeSummaryDisplay");
  const proteinSummaryDisplay = document.getElementById("proteinSummaryDisplay");

  if (tdeeInput) tdeeInput.value = roundInt(TDEE);
  if (proteinInput) proteinInput.value = roundInt(PROTEIN_TARGET);
  if (tdeeSummaryDisplay) tdeeSummaryDisplay.textContent = formatInt(roundInt(TDEE));
  if (proteinSummaryDisplay) proteinSummaryDisplay.textContent = formatInt(roundInt(PROTEIN_TARGET));
  if (summary) {
    summary.textContent = formatDailyIntakeTargetSummary();
    summary.title = `TDEE ${formatInt(TDEE)} kcal · deficit ${formatInt(DEFICIT_TARGET)} kcal`;
  }
  updatePhaseCalorieTargets();
}

function showTargetsForm() {
  document.getElementById("targetsCompactRow")?.setAttribute("hidden", "");
  document.getElementById("targets-form")?.removeAttribute("hidden");
}

function hideTargetsForm() {
  document.getElementById("targetsCompactRow")?.removeAttribute("hidden");
  document.getElementById("targets-form")?.setAttribute("hidden", "");
}

// ── Cut phases ────────────────────────────────────────────────────────────────


function getConfigPayload(overrides = {}) {
  return {
    tdee: Math.round(overrides.tdee ?? TDEE),
    proteinTarget: Math.round(overrides.proteinTarget ?? PROTEIN_TARGET),
    deficitTarget: Math.round(overrides.deficitTarget ?? DEFICIT_TARGET),
    cutStartDate,
    activeCutPhase,
    cutPhaseDeficits: cutPhaseDeficits.map((value) => Math.round(value))
  };
}

function saveConfigToServer(overrides = {}) {
  return fetchJson(`${API_BASE}/api/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(getConfigPayload(overrides))
  });
}

function applyCutPhaseConfig(config) {
  if (!config?.hasCutPhaseSettings) return;

  cutStartDate = config.cutStartDate || null;
  activeCutPhase = Number.isInteger(config.activeCutPhase)
    && config.activeCutPhase >= 0
    && config.activeCutPhase < CUT_PHASE_NAMES.length
    ? config.activeCutPhase
    : null;

  if (Array.isArray(config.cutPhaseDeficits)) {
    cutPhaseDeficits = CUT_PHASE_DEFAULT_DEFICITS.map((defaultValue, index) => {
      const number = Number(config.cutPhaseDeficits[index]);
      return Number.isFinite(number) && number >= 0
        ? Math.round(number)
        : defaultValue;
    });
  }

  updateCutPhaseUI();
}

function getCutWeek(dateString = getDietDate()) {
  if (!cutStartDate) return null;
  const start = new Date(cutStartDate + "T00:00:00");
  const viewedDate = new Date(`${dateString}T00:00:00`);
  const diffDays = Math.floor((viewedDate - start) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return null;
  return Math.floor(diffDays / 7) + 1;
}

function isCutPhaseActiveForDate(dateString) {
  if (activeCutPhase === null) return false;
  if (!cutStartDate) return true;
  return dateString >= cutStartDate;
}

function getCutPhaseLabel(dateString = getDietDate()) {
  if (!isCutPhaseActiveForDate(dateString)) return null;
  const name = CUT_PHASE_NAMES[activeCutPhase];
  const week = getCutWeek(dateString);
  return week ? `${name} · Week ${week}` : name;
}

function getCutPhaseNameFromIndex(index) {
  const number = Number(index);
  return Number.isInteger(number) && number >= 0 && number < CUT_PHASE_NAMES.length
    ? CUT_PHASE_NAMES[number]
    : null;
}

function getCutWeekFromSnapshot(entry) {
  const week = Number(entry?.cutWeek);
  if (Number.isFinite(week) && week > 0) return Math.round(week);

  if (!entry?.cutStartDate || !entry?.date) return null;
  const start = new Date(`${entry.cutStartDate}T00:00:00`);
  const entryDate = new Date(`${entry.date}T00:00:00`);
  const diffDays = Math.floor((entryDate - start) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return null;
  return Math.floor(diffDays / 7) + 1;
}

function formatEntryCutPhaseLabel(entry) {
  const phaseName = entry?.cutPhaseName || getCutPhaseNameFromIndex(entry?.cutPhaseIndex);
  if (!phaseName) return null;
  if (entry?.cutStartDate && entry?.date && entry.date < entry.cutStartDate) return null;

  const week = getCutWeekFromSnapshot(entry);
  return week ? `${phaseName} · Week ${week}` : phaseName;
}

function isCurrentWeekRange(summary) {
  const today = getDietDate();
  return summary.weekStart <= today && today <= summary.weekEnd;
}

function getWeekCutPhaseLabel(summary) {
  const entries = summary.entries || [];
  const datedEntries = entries
    .filter((entry) => formatEntryCutPhaseLabel(entry))
    .sort((a, b) => a.date.localeCompare(b.date));
  const selectedEntry = formatEntryCutPhaseLabel(summary.todayEntry);
  if (selectedEntry) return selectedEntry;

  const latestPastEntry = [...datedEntries].reverse().find((entry) => entry.date <= currentDate);
  const historicalEntry = formatEntryCutPhaseLabel(latestPastEntry || datedEntries[0]);
  if (historicalEntry) return historicalEntry;

  return isCurrentWeekRange(summary) ? getCutPhaseLabel(currentDate) : null;
}

function getCutPhaseSnapshot(dateString) {
  if (!isCutPhaseActiveForDate(dateString)) {
    return { cutStartDate, cutPhaseIndex: null, cutPhaseName: null, cutWeek: null };
  }
  const cutWeek = getCutWeek(dateString);
  return {
    cutStartDate,
    cutPhaseIndex: activeCutPhase,
    cutPhaseName: CUT_PHASE_NAMES[activeCutPhase],
    cutWeek,
    deficitTarget: DEFICIT_TARGET
  };
}

function buildPhaseLogPlainText(phase) {
  const latestEntry = phase.latestEntry || {};
  const phaseName = latestEntry.cutPhaseName || getCutPhaseNameFromIndex(latestEntry.cutPhaseIndex) || "Latest phase";
  const range = formatDateRange(phase.start, phase.end).replace(/, \d{4}/g, "");
  const entries = phase.entries || [];

  const refTdee = latestEntry.tdee || TDEE;
  const refCalTarget = latestEntry.calorieTarget ?? Math.max(0, refTdee - (latestEntry.deficitTarget || DEFICIT_TARGET));
  const refProtTarget = latestEntry.proteinTarget || PROTEIN_TARGET;

  const dist = { "on-plan": 0, under: 0, over: 0, extreme: 0, surplus: 0 };
  let doubleHitCount = 0;
  entries.forEach((entry) => {
    const tdee = entry.tdee || refTdee;
    const deficitTarget = entry.deficitTarget ?? latestEntry.deficitTarget ?? DEFICIT_TARGET;
    const calResult = getCalorieResult(entry.calories, tdee, deficitTarget);
    dist[calResult.state] = (dist[calResult.state] || 0) + 1;
    if (calResult.state === "on-plan" && getProteinResult(entry.protein, entry.proteinTarget || refProtTarget).celebrated) {
      doubleHitCount++;
    }
  });

  const logged = phase.count || 0;
  const days = phase.days || 0;
  const avgDeficit = logged > 0 ? Math.round((phase.totalDeficit || 0) / logged) : 0;

  const lines = [
    `${phaseName} (${range})`,
    `Target ${formatInt(refTdee)}/${formatInt(refCalTarget)}/${formatInt(refProtTarget)} (TDEE/cal/protein)`,
    `${logged}/${days} days logged`,
    `Avg ${formatInt(phase.averageCalories || 0)} kcal, ${formatInt(phase.averageProtein || 0)}g protein`,
    `Avg deficit ${formatInt(avgDeficit)} kcal/day`,
    `Total deficit ${formatInt(phase.totalDeficit || 0)} kcal (${formatFatLossKg(phase.fatLossKg || 0)} kg est)`,
  ];

  if (entries.length) {
    lines.push("");
    if (doubleHitCount > 0) {
      const dPct = Math.round((doubleHitCount / logged) * 100);
      lines.push(`Double Hit   ${doubleHitCount} (${dPct}%)`);
    }
    lines.push("");
    const distOrder = ["on-plan", "under", "over", "extreme", "surplus"];
    distOrder.forEach(state => {
      if (dist[state] > 0) {
        const pct = Math.round((dist[state] / logged) * 100);
        lines.push(`${(STATE_LABELS[state] || state).padEnd(10)} ${dist[state]} (${pct}%)`);
      }
    });
  }

  lines.push("", "Daily");

  if (!entries.length) {
    lines.push("No entries");
    return lines.join("\n");
  }

  entries.forEach((entry) => {
    const entryTdee = entry.tdee || refTdee;
    const deficit = roundInt(entryTdee - entry.calories);
    const deficitText = deficit < 0
      ? `+${formatInt(Math.abs(deficit))}`
      : `-${formatInt(deficit)}`;
    lines.push(
      `${formatPlainDateLabel(entry.date)}: ${formatInt(entry.calories)} kcal, ${formatInt(entry.protein)}g, ${deficitText}`
    );
  });

  return lines.join("\n");
}

async function copyAllPhases(button) {
  track("copy_program_all");
  try {
    button.classList.remove("copied");
    button.classList.add("copying");
    const data = await fetchJson(`${API_BASE}/api/phases`);
    const phases = data.phases || [];
    if (!phases.length) { showToast("No phases found"); button.classList.remove("copying"); return; }

    const texts = await Promise.all(phases.map(async (p) => {
      const res = await fetchJson(`${API_BASE}/api/phase?start=${encodeURIComponent(p.start)}&end=${encodeURIComponent(p.end)}&tdee=${encodeURIComponent(TDEE)}`);
      return buildPhaseLogPlainText(res.phase);
    }));

    await copyTextToClipboard(texts.join("\n\n---\n\n"));
    button.disabled = true;
    button.classList.remove("copying");
    button.classList.add("copied");
    triggerHaptic("success");
    setTimeout(() => { button.classList.remove("copied"); button.disabled = false; }, 1400);
  } catch {
    button.classList.remove("copying", "copied");
    button.disabled = false;
    showToast("Copy failed");
  }
}

async function fetchLatestPhaseLog() {
  const data = await fetchJson(`${API_BASE}/api/phase?end=${encodeURIComponent(currentDate)}&tdee=${encodeURIComponent(TDEE)}`);
  return data.phase;
}

function updateCutPhaseUI() {
  CUT_PHASE_NAMES.forEach((_, i) => {
    const deficitInput = document.getElementById(`cutPhaseDeficit${i}`);
    if (deficitInput) deficitInput.value = cutPhaseDeficits[i];

    const btn = document.getElementById(`cutPhaseActivateBtn${i}`);
    const row = document.getElementById(`cutPhaseRow${i}`);
    const isActive = activeCutPhase === i;

    if (btn) {
      btn.textContent = isActive ? "Active" : "Activate";
      btn.classList.toggle("is-active", isActive);
      btn.disabled = isActive;
    }
    if (row) row.classList.toggle("is-active", isActive);
  });

  const summaryName = document.getElementById("cutPhaseSummaryName");
  const summaryCal = document.getElementById("cutPhaseSummaryCal");
  if (activeCutPhase !== null) {
    const deficit = cutPhaseDeficits[activeCutPhase];
    const cal = Math.max(0, roundInt(TDEE - deficit));
    if (summaryName) summaryName.textContent = `${CUT_PHASE_NAMES[activeCutPhase]} · ${formatInt(cal)} kcal/day`;
    if (summaryCal) summaryCal.textContent = `${formatInt(cal)} kcal/day`;
  } else {
    if (summaryName) summaryName.textContent = "";
    if (summaryCal) summaryCal.textContent = "";
  }

  const periodDisplay = document.getElementById("phasePeriodDisplay");
  const periodRow = document.getElementById("phasePeriodRow");
  const startInput = document.getElementById("cutStartDateInput");
  if (periodDisplay && periodRow) {
    if (cutStartDate) {
      const [y, m, d] = cutStartDate.split("-").map(Number);
      const start = new Date(y, m - 1, d);
      const todayMs = new Date(); todayMs.setHours(0, 0, 0, 0);
      const days = Math.round((todayMs - start) / 86400000) + 1;
      const startLabel = start.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
      periodDisplay.textContent = `Started ${startLabel} · ${days} days`;
      periodRow.hidden = false;
    } else {
      periodDisplay.textContent = "No start date set";
      periodRow.hidden = false;
    }
  }
  if (startInput) {
    startInput.value = cutStartDate || "";
    startInput.hidden = true;
  }

  updatePhaseCalorieTargets();
}

function updatePhaseCalorieTargets() {
  CUT_PHASE_NAMES.forEach((_, i) => {
    const calSpan = document.getElementById(`phaseTarget${i}`);
    const proteinSpan = document.getElementById(`phaseProtein${i}`);
    const deficit = cutPhaseDeficits[i];
    const cal = Math.max(0, roundInt(TDEE - deficit));
    if (calSpan) calSpan.textContent = `${formatInt(cal)} kcal/day`;
    if (proteinSpan) proteinSpan.textContent = `${formatInt(PROTEIN_TARGET)} g protein`;
  });
}

function handlePhaseActivate(index) {
  triggerHaptic("select");

  // Capture the deficit input value first
  const deficitInput = document.getElementById(`cutPhaseDeficit${index}`);
  if (deficitInput) {
    const val = Number(deficitInput.value);
    if (Number.isFinite(val) && val >= 0) cutPhaseDeficits[index] = Math.round(val);
  }

  activeCutPhase = index;
  DEFICIT_TARGET = cutPhaseDeficits[index];
  updateCutPhaseUI();
  updateTargetForm();
  updateEntryForm();

  saveConfigToServer()
    .then(data => { applyConfig(data.config); loadWeekSummary(); })
    .catch(() => { loadWeekSummary(); });
}

function handleCutStartDateChange(event) {
  cutStartDate = event.target.value || null;
  updateCutPhaseUI();
  // Re-render week card so label updates
  saveConfigToServer()
    .then(data => { applyConfig(data.config); loadWeekSummary(); })
    .catch(() => {
      if (document.getElementById("weekly-summary")?.innerHTML) loadWeekSummary();
    });
}

function handlePhaseDeficitBlur(index, value) {
  const val = Number(value);
  if (!Number.isFinite(val) || val < 0) return;
  cutPhaseDeficits[index] = Math.round(val);
  if (activeCutPhase === index) {
    DEFICIT_TARGET = cutPhaseDeficits[index];
    updateTargetForm();
    updateEntryForm();
  } else {
    updatePhaseCalorieTargets();
  }
  saveConfigToServer()
    .then(data => { applyConfig(data.config); loadWeekSummary(); })
    .catch(() => {
      if (document.getElementById("weekly-summary")?.innerHTML) loadWeekSummary();
    });
}

function handleCutPhasePanelClick(event) {
  const btn = event.target.closest("[data-phase-activate]");
  if (!btn) return;
  const index = Number(btn.dataset.phaseActivate);
  if (!Number.isNaN(index)) handlePhaseActivate(index);
}

// ─────────────────────────────────────────────────────────────────────────────

function applyConfig(config) {
  TDEE = roundInt(config?.tdee) || 2705;
  PROTEIN_TARGET = roundInt(config?.proteinTarget) || 180;
  DEFICIT_TARGET = roundInt(config?.deficitTarget) || 500;
  applyCutPhaseConfig(config);
  updateTargetForm();
}

function updateEntryForm() {
  const calories = document.getElementById("calories");
  const protein = document.getElementById("protein");
  const deleteBtn = document.getElementById("deleteBtn");
  const saveBtn = document.getElementById("saveBtn");
  const isViewingToday = currentDate === getDietDate();
  const form = document.getElementById("today-form");

  if (calories) {
    calories.value = todayEntry ? roundInt(todayEntry.calories) : "";
    calories.inputMode = "numeric";
    calories.autocomplete = "off";
    calories.placeholder = "";
  }

  if (protein) {
    protein.value = todayEntry ? roundInt(todayEntry.protein) : "";
    protein.inputMode = "numeric";
    protein.autocomplete = "off";
    protein.placeholder = "";
  }

  const proteinUnit = document.querySelector('[data-unit="protein"]');
  if (proteinUnit) {
    proteinUnit.textContent = "g";
  }

  if (deleteBtn) {
    deleteBtn.hidden = !todayEntry;
    deleteBtn.textContent = "Delete entry";
    deleteBtn.setAttribute("aria-label", "Delete this entry");
  }
  if (saveBtn) {
    if (todayEntry) {
      saveBtn.textContent = "Update entry";
    } else {
      saveBtn.textContent = isViewingToday ? "Commit today" : "Save entry";
    }
  }
  if (form) {
    form.classList.toggle("compact-entry-fields", window.matchMedia?.("(max-width: 620px)")?.matches ?? false);
    setEntryFormVisible(isQuickEntryOpen());
  }
}

function setEntryFormVisible(isVisible) {
  if (!isVisible) closeQuickEntry({ haptic: false });
}

function hideEntryFormWhileLoading() {
  if (isQuickEntryOpen()) return;

  const form = document.getElementById("today-form");
  if (!form) return;

  form.classList.add("entry-form-collapsed");
  form.setAttribute("aria-hidden", "true");
  form.inert = true;
  form.hidden = true;
}


function setLoading(isLoading) {
  const saveBtn = document.getElementById("saveBtn");
  const deleteBtn = document.getElementById("deleteBtn");

  if (saveBtn) {
    if (isLoading) {
      saveBtn.dataset.idleText = saveBtn.textContent;
      saveBtn.textContent = "Saving...";
    } else if (saveBtn.dataset.idleText && saveBtn.textContent === "Saving...") {
      saveBtn.textContent = saveBtn.dataset.idleText;
      delete saveBtn.dataset.idleText;
    } else {
      delete saveBtn.dataset.idleText;
    }

    saveBtn.disabled = isLoading;
    saveBtn.classList.toggle("is-loading", isLoading);
  }
  if (deleteBtn) deleteBtn.disabled = isLoading;
}

function isQuickEntryOpen() {
  return document.body.classList.contains("quick-entry-open");
}

function isCalendarOpen() {
  return document.body.classList.contains("calendar-open");
}

function isCompactQuickEntry() {
  return window.matchMedia?.("(max-width: 620px)")?.matches ?? false;
}

// Inline editing — browser handles scroll-to-focus natively.
function adjustQuickEntryForKeyboard() {}

function openQuickEntry(focusField = "calories") {
  if (isQuickEntryOpen()) return;
  triggerHaptic("tap");

  const card = document.querySelector(".daily-card:not(.loading-card)");
  const form = document.getElementById("today-form");
  const calories = document.getElementById("calories");
  const protein = document.getElementById("protein");

  if (!card || !form || !calories || !protein) return;

  // Move form inside the card so it expands inline
  card.appendChild(form);
  card.classList.add("is-editing");

  form.hidden = false;
  form.classList.remove("entry-form-collapsed");
  form.setAttribute("aria-hidden", "false");
  form.inert = false;
  document.body.classList.add("quick-entry-open");

  if (!todayEntry) {
    calories.value = "";
    protein.value = "";
  }

  [calories, protein].forEach((input) => {
    input.type = "number";
    input.inputMode = "numeric";
    input.autocomplete = "off";
    input.removeAttribute("readonly");
    input.removeAttribute("disabled");
  });

  const focusTarget = focusField === "protein" ? protein : calories;
  if (window.__quickEntryUserGesture === true) {
    forceQuickEntryFocus(focusTarget);
  } else {
    focusTarget.focus();
  }
}

function teardownQuickEntryViewportListeners() {}

function forceQuickEntryFocus(input) {
  if (!input) return;
  const focus = () => {
    if (!isQuickEntryOpen()) return;
    input.focus();
    input.select?.();
  };
  focus();
  requestAnimationFrame(focus);
  setTimeout(focus, 60);
}

function handleQuickEntryPointerFocus(event) {
  if (!isQuickEntryOpen()) return;
  if (event.target.closest("button")) return;

  const calories = document.getElementById("calories");
  const protein = document.getElementById("protein");
  const tappedInput = event.target.matches("input") ? event.target : null;
  const focusTarget = tappedInput || (document.activeElement === protein ? protein : calories);

  // Don't call select() here — it would dismiss the iOS long-press paste menu.
  // select() is only called on initial open via forceQuickEntryFocus.
  focusTarget?.focus();
  adjustQuickEntryForKeyboard();
  requestAnimationFrame(() => adjustQuickEntryForKeyboard());
}

function closeQuickEntry(options = {}) {
  if (!isQuickEntryOpen()) return;
  if (options.haptic !== false) triggerHaptic("tap");

  const card = document.querySelector(".daily-card:not(.loading-card).is-editing");
  const form = document.getElementById("today-form");
  const dailyResult = document.getElementById("daily-result");

  if (card) card.classList.remove("is-editing");

  // Move form back to its original position after #daily-result
  if (form && dailyResult?.parentNode && form.parentNode !== dailyResult.parentNode) {
    dailyResult.after(form);
  }

  if (form) {
    form.hidden = true;
    form.classList.add("entry-form-collapsed");
    form.setAttribute("aria-hidden", "true");
    form.inert = true;
  }

  document.body.classList.remove("quick-entry-open");
}

function showCelebration(options = {}) {
  const { variant = "logged" } = options;
  let celebration = document.getElementById("saveCelebration");
  const isDoubleHit = variant === "double-hit";

  if (!celebration) {
    celebration = document.createElement("div");
    celebration.id = "saveCelebration";
    celebration.className = "save-celebration";
    celebration.setAttribute("role", "status");
    celebration.setAttribute("aria-live", "polite");
    celebration.innerHTML = `
      <div class="celebration-confetti" aria-hidden="true">
        ${Array.from({ length: 18 }, (_, index) => `<span style="--i:${index}"></span>`).join("")}
      </div>
      <div class="celebration-card">
        <span class="celebration-icon" aria-hidden="true">✓</span>
        <strong>Logged</strong>
        <span>Saved.</span>
      </div>
    `;
    document.body.appendChild(celebration);
  }

  celebration.classList.toggle("double-hit", isDoubleHit);
  const confetti = celebration.querySelector(".celebration-confetti");
  const icon = celebration.querySelector(".celebration-icon");
  const title = celebration.querySelector(".celebration-card strong");
  const text = celebration.querySelector(".celebration-card span:last-child");

  if (confetti) {
    const confettiCount = isDoubleHit ? 34 : 18;
    confetti.innerHTML = Array.from({ length: confettiCount }, (_, index) => `<span style="--i:${index}"></span>`).join("");
  }
  if (icon) icon.textContent = isDoubleHit ? "★" : "✓";
  if (title) title.textContent = isDoubleHit ? "Double hit!" : "Logged";
  if (text) text.textContent = isDoubleHit ? "Deficit and protein on track" : "Saved";

  clearTimeout(celebrationTimer);
  celebration.classList.remove("visible");
  void celebration.offsetWidth;
  celebration.classList.add("visible");

  celebrationTimer = setTimeout(() => {
    celebration.classList.remove("visible");
  }, 2100);
}

function openCalendar() {
  triggerHaptic("tap");

  const panel = document.getElementById("calendarPanel");
  const backdrop = document.getElementById("calendarBackdrop");
  const dietTodayString = getDietDate();

  renderCalendar();

  if (panel) panel.hidden = false;
  if (backdrop) backdrop.hidden = false;
  document.body.classList.add("calendar-open");

  // Double-RAF: first frame shows panel, second frame has stable layout (avoids
  // modal-in CSS transform skewing getBoundingClientRect values)
  const grid = document.getElementById("calendarGrid");
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const todayButton = grid?.querySelector(`.calendar-day.today`);
    const selectedButton = grid?.querySelector(`.calendar-day.selected`);
    const scrollTarget = selectedButton || todayButton;

    scrollCalendarToSelectedDate(grid, scrollTarget);
    updateCalendarMonthLabel(grid);
  }));
}

function scrollCalendarToSelectedDate(grid, scrollTarget) {
  if (!grid || !scrollTarget) {
    grid?.querySelector(`[data-month="${getDietDate().slice(0, 7)}"]`)?.scrollIntoView({ block: "start" });
    return;
  }

  const gridRect = grid.getBoundingClientRect();
  const targetRect = scrollTarget.getBoundingClientRect();
  const targetCenter = targetRect.top + targetRect.height / 2;
  const gridCenter = gridRect.top + gridRect.height / 2;

  grid.scrollTop += targetCenter - gridCenter;
}

function closeCalendar(options = {}) {
  if (options.haptic !== false) triggerHaptic("tap");

  const panel = document.getElementById("calendarPanel");
  const backdrop = document.getElementById("calendarBackdrop");

  if (panel) panel.hidden = true;
  if (backdrop) backdrop.hidden = true;
  document.body.classList.remove("calendar-open");
}

function openDeleteConfirm() {
  if (!todayEntry) return;
  triggerHaptic("warning");

  const panel = document.getElementById("deleteConfirmPanel");
  const backdrop = document.getElementById("deleteConfirmBackdrop");
  const confirmBtn = document.getElementById("confirmDeleteBtn");

  if (panel) panel.hidden = false;
  if (backdrop) backdrop.hidden = false;
  document.body.classList.add("delete-confirm-open");
  confirmBtn?.focus();
}

function closeDeleteConfirm(options = {}) {
  if (options.haptic !== false) triggerHaptic("tap");

  const panel = document.getElementById("deleteConfirmPanel");
  const backdrop = document.getElementById("deleteConfirmBackdrop");

  if (panel) panel.hidden = true;
  if (backdrop) backdrop.hidden = true;
  document.body.classList.remove("delete-confirm-open");
}

function renderCalendar() {
  const grid = document.getElementById("calendarGrid");
  const dietTodayString = getDietDate();
  const dietToday = new Date(`${dietTodayString}T12:00:00`);

  if (!grid) return;

  // Set initial month label to the currently selected date
  const label = document.getElementById("calendarMonthLabel");
  if (label) label.innerHTML = getCalendarMonthLabel(new Date(`${currentDate}T12:00:00`));

  renderCalendarMonths(grid, dietToday, dietTodayString);

  grid.onscroll = () => {
    extendCalendarIfNeeded(grid);
    updateCalendarMonthLabel(grid);
  };
}

function renderCalendarMonths(grid, dietToday, dietTodayString) {
  const weeks = [];
  let weekCells = [];

  // Start from Monday of the week containing (calendarHistoryMonths ago)
  const historyAnchor = new Date(dietToday.getFullYear(), dietToday.getMonth() - calendarHistoryMonths, 1);
  const anchorOffset = (historyAnchor.getDay() + 6) % 7; // Mon=0
  const startDate = new Date(historyAnchor);
  startDate.setDate(historyAnchor.getDate() - anchorOffset);
  const minDate = new Date(`${MIN_DIET_DATE}T12:00:00`);

  // If the selected date is before our start, extend back to include it
  const selectedAnchor = new Date(`${currentDate}T12:00:00`);
  if (selectedAnchor < startDate) {
    const selOffset = (selectedAnchor.getDay() + 6) % 7;
    startDate.setTime(selectedAnchor.getTime());
    startDate.setDate(selectedAnchor.getDate() - selOffset);
  }

  if (startDate < minDate) {
    startDate.setTime(minDate.getTime());
  }

  // End at Sunday of current week + 4 more weeks.
  // These disabled future rows fill the 8-row window so today sits centred
  // and there's nothing past row 8 to scroll into.
  const todayOffset = (dietToday.getDay() + 6) % 7; // Mon=0
  const endDate = new Date(dietToday);
  endDate.setDate(dietToday.getDate() + (6 - todayOffset) + 28);

  const cursor = new Date(startDate);
  let isFirst = true;
  let cellIndex = 0;

  while (cursor <= endDate) {
    // Mark first cell and every calendar month's 1st for label tracking
    const isMonthMarker = isFirst || cursor.getDate() === 1;
    isFirst = false;
    weekCells.push(renderCalendarDay(cursor, dietToday, dietTodayString, isMonthMarker ? "month-start" : ""));
    cursor.setDate(cursor.getDate() + 1);
    cellIndex++;

    // Flush completed week row
    if (cellIndex % 7 === 0) {
      weeks.push(`<div class="calendar-week">${weekCells.join("")}</div>`);
      weekCells = [];
    }
  }
  if (weekCells.length > 0) {
    weeks.push(`<div class="calendar-week">${weekCells.join("")}</div>`);
  }

  grid.innerHTML = `<div class="calendar-grid">${weeks.join("")}</div>`;
}

function getCalendarMonthLabel(monthDate) {
  const month = monthDate.toLocaleDateString("en-US", { month: "long" });
  const year = monthDate.toLocaleDateString("en-US", { year: "numeric" });
  return `<strong>${month}</strong> ${year}`;
}

function updateCalendarMonthLabel(grid) {
  const label = document.getElementById("calendarMonthLabel");
  if (!label) return;
  const markers = [...grid.querySelectorAll(".calendar-day[data-month]")];
  const containerRect = grid.getBoundingClientRect();
  const referenceY = containerRect.top + containerRect.height * 0.45;
  let current = markers[0];

  for (const marker of markers) {
    const rect = marker.getBoundingClientRect();
    if (rect.top <= referenceY) {
      current = marker;
    } else {
      break;
    }
  }

  if (current?.dataset.month) {
    const newMonth = current.dataset.month;
    label.innerHTML = getCalendarMonthLabel(new Date(`${newMonth}-01T12:00:00`));
    if (newMonth !== calendarVisibleMonth) {
      calendarVisibleMonth = newMonth;
      grid.querySelectorAll(".calendar-day[data-day-month]").forEach(btn => {
        btn.classList.toggle("viewed-calendar-month", btn.dataset.dayMonth === calendarVisibleMonth);
      });
    }
  }
}

function extendCalendarIfNeeded(grid) {
  if (calendarIsExtending || grid.scrollTop > 96) return;
  const earliestButton = grid.querySelector(".calendar-day[data-date]");
  if (earliestButton?.dataset.date && earliestButton.dataset.date <= MIN_DIET_DATE) return;

  calendarIsExtending = true;
  const previousHeight = grid.scrollHeight;
  const dietTodayString = getDietDate();
  const dietToday = new Date(`${dietTodayString}T12:00:00`);

  calendarHistoryMonths += CALENDAR_HISTORY_CHUNK_MONTHS;
  renderCalendarMonths(grid, dietToday, dietTodayString);

  requestAnimationFrame(() => {
    grid.scrollTop += grid.scrollHeight - previousHeight;
    updateCalendarMonthLabel(grid);
    calendarIsExtending = false;
  });
}


function renderCalendarDay(date, dietToday, dietTodayString, extraClass = "") {
  const dateString = formatDate(date);
  const dayMonth = dateString.slice(0, 7);
  const isSelected = dateString === currentDate;
  const isToday = dateString === dietTodayString;
  const isFuture = date > dietToday;
  const isTooEarly = isBeforeMinDietDate(dateString);
  const isMonthStart = extraClass === "month-start";
  const isFutureMonth = dayMonth > dietTodayString.slice(0, 7);

  const classes = [
    "calendar-day",
    dayMonth === calendarVisibleMonth ? "viewed-calendar-month" : "",
    isFutureMonth ? "future-calendar-month" : "",
    extraClass,
    isSelected ? "selected" : "",
    isToday ? "today" : ""
  ].filter(Boolean).join(" ");

  return `
    <button
      class="${classes}"
      type="button"
      data-date="${dateString}"
      data-day-month="${dayMonth}"
      ${isMonthStart ? `data-month="${dayMonth}"` : ""}
      ${isFuture || isTooEarly ? "disabled" : ""}
    >
      ${date.getDate()}
    </button>
  `;
}



function handleCalendarDayClick(event) {
  const btn = event.target.closest("[data-date]");
  if (!btn || btn.disabled) return;

  triggerHaptic("select");
  setDietDay(btn.dataset.date);
  closeCalendar({ haptic: false });
}

function foldSettingsPanels() {
  document.querySelectorAll(".settings-panel[open]").forEach(el => el.removeAttribute("open"));
}

function setDietDay(date, { direction = null, skipAnimation = false } = {}) {
  if (!isValidDateString(date) || isFutureDate(date) || isBeforeMinDietDate(date)) return;
  if (date === currentDate) return;

  currentDate = date;
  foldSettingsPanels();
  calendarVisibleMonth = date.slice(0, 7);
  todayLogged = false;
  todayEntry = null;

  updateDietDayDisplay();
  animateDietDayLabel(direction);
  updateTargetForm();
  hideEntryFormWhileLoading();

  document.querySelectorAll('[data-unit="protein"]').forEach((el) => {
    el.textContent = "g";
  });

  if (direction && !skipAnimation) {
    const animClass = direction === "forward" ? "day-nav-forward" : "day-nav-backward";
    [document.getElementById("daily-result"), document.getElementById("weekly-summary")].forEach((el) => {
      if (!el) return;
      el.classList.remove("day-nav-forward", "day-nav-backward");
      void el.offsetWidth;
      el.classList.add(animClass);
      el.addEventListener("animationend", () => el.classList.remove(animClass), { once: true });
    });
  }

  renderInitialLoadingState();
  loadWeekSummary();
  loadAdherenceData();
  loadMonthlyData();
}

function shiftDietDay(days) {
  const d = new Date(`${currentDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  const nextDate = formatDate(d);

  if (isFutureDate(nextDate) || isBeforeMinDietDate(nextDate)) return;

  triggerHaptic("select");
  setDietDay(nextDate, { direction: days > 0 ? "forward" : "backward" });
}

function initCarouselSwipe() {
  const viewport = document.getElementById("swipe-viewport");
  const track = document.getElementById("swipe-track");
  if (!viewport || !track) return;

  const GAP = 16;
  const THRESHOLD = 50;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTarget = null;
  let activeDrag = false;
  let dragCancelled = false;
  let transitioning = false;
  let crossedThreshold = false;
  let suppressClickUntil = 0;

  function overlayOpen() {
    return document.body.classList.contains("calendar-open") ||
      document.body.classList.contains("quick-entry-open") ||
      document.body.classList.contains("auth-locked") ||
      document.body.classList.contains("delete-confirm-open");
  }

  function pw() { return viewport.offsetWidth; }
  function co() { return -(pw() + GAP); }

  function setTrackX(x, animated) {
    track.style.transition = animated ? "transform 380ms cubic-bezier(0.25, 1, 0.5, 1)" : "none";
    track.style.transform = `translateX(${x}px)`;
  }

  function resetToCenter() { setTrackX(co(), false); }

  function getSwipeStep(target) {
    return target instanceof Element && target.closest(".week-card") ? 7 : 1;
  }

  function populateSidePanels() {
    ["swipe-panel-prev", "swipe-panel-next"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = dailySkeletonHtml() + weekSkeletonHtml();
    });
  }

  function updateSizes() {
    const w = pw();
    document.querySelectorAll(".swipe-panel").forEach((el, i) => {
      el.style.width = `${w}px`;
      el.style.marginRight = i < 2 ? `${GAP}px` : "";
    });
    resetToCenter();
  }

  function snapBack() {
    setTrackX(co(), true);
    track.addEventListener("transitionend", () => { transitioning = false; }, { once: true });
  }

  function commitSwipe(days) {
    transitioning = true;
    suppressClickUntil = Date.now() + 700;
    const target = co() + (days > 0 ? -(pw() + GAP) : (pw() + GAP));
    triggerHaptic("select");
    setTrackX(target, true);
    track.addEventListener("transitionend", () => {
      resetToCenter();
      populateSidePanels();
      const d = new Date(`${currentDate}T12:00:00`);
      d.setDate(d.getDate() + days);
      setDietDay(formatDate(d), { direction: days > 0 ? "forward" : "backward", skipAnimation: true });
      transitioning = false;
    }, { once: true });
  }

  updateSizes();
  populateSidePanels();
  window.addEventListener("resize", updateSizes);

  document.addEventListener("click", (e) => {
    if (Date.now() > suppressClickUntil) return;
    if (!(e.target instanceof Element) || !e.target.closest(".daily-card, .week-card")) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  document.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1 || transitioning) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchStartTarget = e.target;
    activeDrag = false;
    dragCancelled = false;
    crossedThreshold = false;
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    if (e.touches.length !== 1 || dragCancelled || transitioning) return;
    if (overlayOpen()) { dragCancelled = true; resetToCenter(); return; }
    if (touchStartTarget instanceof Element && touchStartTarget.closest("input, textarea, select, #monthly-viewport")) {
      dragCancelled = true;
      return;
    }

    const deltaX = e.touches[0].clientX - touchStartX;
    const deltaY = e.touches[0].clientY - touchStartY;

    if (!activeDrag) {
      if ((Math.abs(deltaY) > Math.abs(deltaX) * 1.2) && (Math.abs(deltaY) > 8 || Math.abs(deltaX) > 8)) {
        dragCancelled = true;
        return;
      }
      if (Math.abs(deltaX) > 8) activeDrag = true;
      else return;
    }

    e.preventDefault();

    const d = new Date(`${currentDate}T12:00:00`);
    const step = getSwipeStep(touchStartTarget);
    d.setDate(d.getDate() + (deltaX < 0 ? step : -step));
    const atBoundary = (deltaX < 0 && isFutureDate(formatDate(d))) || (deltaX > 0 && isBeforeMinDietDate(formatDate(d)));

    // Anticipatory haptic: tick the moment the drag passes the commit threshold,
    // so the user knows they'll change days before lifting their finger.
    const wouldCommit = !atBoundary && Math.abs(deltaX) >= THRESHOLD && Math.abs(deltaX) >= Math.abs(deltaY) * 1.5;
    if (wouldCommit && !crossedThreshold) {
      crossedThreshold = true;
      triggerHaptic("tap");
    } else if (!wouldCommit && crossedThreshold) {
      crossedThreshold = false;
    }

    setTrackX(co() + (atBoundary ? deltaX * 0.08 : deltaX), false);
  }, { passive: false });

  document.addEventListener("touchend", (e) => {
    if (!activeDrag) { activeDrag = false; dragCancelled = false; return; }
    activeDrag = false;
    dragCancelled = false;

    if (overlayOpen()) { snapBack(); return; }

    const deltaX = e.changedTouches[0].clientX - touchStartX;
    const deltaY = e.changedTouches[0].clientY - touchStartY;

    if (Math.abs(deltaX) < THRESHOLD || Math.abs(deltaX) < Math.abs(deltaY) * 1.5) {
      snapBack();
      return;
    }

    const dir = deltaX < 0 ? 1 : -1;
    const step = getSwipeStep(touchStartTarget);
    const days = dir * step;
    const d = new Date(`${currentDate}T12:00:00`);
    d.setDate(d.getDate() + days);
    if (isFutureDate(formatDate(d)) || isBeforeMinDietDate(formatDate(d))) {
      snapBack();
      return;
    }

    commitSwipe(days);
  }, { passive: true });
}

function handleGlobalKeydown(event) {
  if (event.key === "Escape") {
    if (document.body.classList.contains("quick-entry-open")) {
      event.preventDefault();
      closeQuickEntry();
      return;
    }

    if (document.body.classList.contains("delete-confirm-open")) {
      event.preventDefault();
      closeDeleteConfirm();
      return;
    }

    if (document.body.classList.contains("calendar-open")) {
      event.preventDefault();
      closeCalendar();
      return;
    }
  }

  const activeElement = document.activeElement;
  const isTyping = activeElement?.matches?.("input, textarea, select, button") || activeElement?.isContentEditable;
  const isOverlayOpen = document.body.classList.contains("calendar-open") || document.body.classList.contains("quick-entry-open") || document.body.classList.contains("auth-locked") || document.body.classList.contains("delete-confirm-open");

  if (isTyping || isOverlayOpen || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    shiftDietDay(-1);
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    shiftDietDay(1);
  }
}

function getFormValues() {
  const calories = Number(document.getElementById("calories")?.value);
  const protein = Number(document.getElementById("protein")?.value);

  if (!Number.isFinite(calories) || calories < 0) {
    throw new Error("Calories must be a valid number");
  }

  if (!Number.isFinite(protein) || protein < 0) {
    throw new Error("Protein must be a valid number");
  }

  return {
    calories: roundInt(calories),
    protein: roundInt(protein)
  };
}

async function fetchJson(url, options = {}) {
  const token = getStoredAuthToken();
  let res;
  try {
    res = await fetch(url, {
      ...options,
      credentials: "include",
      headers: {
        ...(options.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    });
  } catch {
    throw new Error("Network error. Restart with: node scripts/dev-server.mjs");
  }

  let data = null;
  let parseOk = true;

  try {
    data = await res.json();
  } catch {
    data = {};
    parseOk = false;
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      setStoredAuthToken("");
      authUser = null;
      updateAuthUI();
      showAccessGate(
        res.status === 403
          ? "This Google account is not allowed"
          : "Session expired — sign in again"
      );
      throw createAuthError(parseOk && data.error ? data.error : "Unauthorized");
    }

    const message = parseOk && (data.error || data.detail?.message);
    throw new Error(message || `Request failed (${res.status})`);
  }

  return data;
}

// ─── Entries cache ──────────────────────────────────────────────────────────
// /api/entries hits Notion, which is slow (~1-2s/request). Past date ranges are
// immutable within a session, so cache responses by range and only invalidate
// when an entry is written. This makes month-to-month navigation instant after
// the first visit (a back-swipe reuses the month just viewed).
const entriesCache = new Map();

function invalidateEntriesCache() {
  entriesCache.clear();
}

async function fetchEntries(since, until) {
  const key = `${since}|${until ?? ""}`;
  const cached = entriesCache.get(key);
  if (cached) return cached;

  const url = until
    ? `${API_BASE}/api/entries?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`
    : `${API_BASE}/api/entries?since=${encodeURIComponent(since)}`;
  const data = await fetchJson(url);
  if (data && data.ok) entriesCache.set(key, data);
  return data;
}

function updateAuthUI() {
  const bar = document.getElementById("authUserBar");
  const label = document.getElementById("authUserLabel");
  const email = document.getElementById("authUserEmail");
  const avatar = document.getElementById("authUserAvatar");
  const initial = document.getElementById("authUserInitial");

  if (!bar || !label) return;

  const copyAllBtn = document.getElementById("copyAllDataBtn");
  if (!authUser) {
    bar.hidden = true;
    if (copyAllBtn) copyAllBtn.hidden = true;
    closeAuthMenu();
    return;
  }

  bar.hidden = false;
  if (copyAllBtn) copyAllBtn.hidden = false;
  const name = authUser.name || authUser.email || "";
  label.textContent = name;
  if (email) {
    // Only show the email line when it adds info beyond the name.
    const showEmail = authUser.email && authUser.email !== name;
    email.textContent = showEmail ? authUser.email : "";
    email.hidden = !showEmail;
  }

  if (avatar && authUser.picture) {
    avatar.src = authUser.picture;
    avatar.alt = name;
    avatar.hidden = false;
    if (initial) initial.hidden = true;
  } else {
    if (avatar) avatar.hidden = true;
    if (initial) {
      initial.textContent = (name.trim()[0] || "?").toUpperCase();
      initial.hidden = false;
    }
  }
}

function openAuthMenu() {
  const trigger = document.getElementById("authUserTrigger");
  const popover = document.getElementById("authUserPopover");
  if (!trigger || !popover) return;
  popover.hidden = false;
  trigger.setAttribute("aria-expanded", "true");
  document.addEventListener("pointerdown", handleAuthMenuOutside, true);
  document.addEventListener("keydown", handleAuthMenuKeydown, true);
}

function closeAuthMenu() {
  const trigger = document.getElementById("authUserTrigger");
  const popover = document.getElementById("authUserPopover");
  if (popover) popover.hidden = true;
  if (trigger) trigger.setAttribute("aria-expanded", "false");
  document.removeEventListener("pointerdown", handleAuthMenuOutside, true);
  document.removeEventListener("keydown", handleAuthMenuKeydown, true);
}

function toggleAuthMenu() {
  const popover = document.getElementById("authUserPopover");
  if (popover && popover.hidden) openAuthMenu();
  else closeAuthMenu();
}

function handleAuthMenuOutside(event) {
  const bar = document.getElementById("authUserBar");
  if (bar && !bar.contains(event.target)) closeAuthMenu();
}

function handleAuthMenuKeydown(event) {
  if (event.key === "Escape") {
    closeAuthMenu();
    document.getElementById("authUserTrigger")?.focus();
  }
}

function startGoogleRedirect() {
  if (!GOOGLE_CLIENT_ID) {
    showAccessGate("Google sign-in is not configured");
    return;
  }
  const nonce = randomToken();
  const state = randomToken();
  sessionStorage.setItem(OAUTH_STATE_KEY, state);

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "id_token",
    scope: "openid email profile",
    nonce,
    state,
    prompt: "select_account",
  });

  window.location.href = "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString();
}

function consumeGoogleRedirect() {
  const hash = window.location.hash || "";
  if (!hash.includes("id_token") && !hash.includes("error")) return null;

  const params = new URLSearchParams(hash.replace(/^#/, ""));
  window.history.replaceState(null, "", window.location.pathname + window.location.search);

  const savedState = sessionStorage.getItem(OAUTH_STATE_KEY) || "";
  sessionStorage.removeItem(OAUTH_STATE_KEY);
  if (!savedState || params.get("state") !== savedState)
    return { error: "Sign-in state mismatch — please try again." };

  const error = params.get("error");
  if (error) return { error: params.get("error_description") || error };

  return { credential: params.get("id_token") };
}

function enableSignInButton() {
  const signInBtn = document.getElementById("googleSignInBtn");
  if (!signInBtn) return;
  signInBtn.disabled = false;
  signInBtn.onclick = () => startGoogleRedirect();
}

async function completeGoogleSignIn(payload) {
  const error = document.getElementById("accessError");
  if (error) error.textContent = "";
  setStatus("Signing in...");

  try {
    const data = await fetchJson(`${API_BASE}/api/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (data?.token) setStoredAuthToken(data.token);
    authUser = data.user;
    hideAccessGate();
    updateAuthUI();
    setStatus("");
    await loadConfig();
    await loadWeekSummary();
    loadAdherenceData();
    loadMonthlyData();
  } catch (signInError) {
    setStatus("Locked");
    showAccessGate(signInError.message || "Could not sign in");
  }
}

async function restoreSession() {
  const token = getStoredAuthToken();
  const sessionRes = await fetch(`${API_BASE}/api/auth/session`, {
    credentials: "include",
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!sessionRes.ok) {
    if (sessionRes.status === 401 || sessionRes.status === 403) {
      setStoredAuthToken("");
    }
    return false;
  }

  const data = await sessionRes.json().catch(() => null);
  if (!data?.user) return false;

  authUser = data.user;
  hideAccessGate();
  updateAuthUI();
  try {
    await loadConfig();
  } catch (configError) {
    if (configError?.isAuthError) throw configError;
    console.warn("loadConfig failed:", configError);
    setStatus("Could not load settings");
  }
  loadAdherenceData();
  loadMonthlyData();
  try {
    await loadWeekSummary();
  } catch (summaryError) {
    if (summaryError?.isAuthError) throw summaryError;
    console.warn("loadWeekSummary failed:", summaryError);
  }
  return true;
}

async function signOut() {
  const token = getStoredAuthToken();
  try {
    await fetch(`${API_BASE}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
  } catch {
    // Still clear local UI if network fails.
  }

  setStoredAuthToken("");
  authUser = null;
  updateAuthUI();
  setStatus("Locked");
  startGoogleRedirect();
}

async function loadConfig() {
  const data = await fetchJson(`${API_BASE}/api/config`);
  applyConfig(data.config);
}

async function repairEntryPhaseIfNeeded(entry) {
  if (!entry || !cutStartDate || entry.date >= cutStartDate) return;
  if (entry.cutPhaseIndex === null || entry.cutPhaseIndex === undefined) return;
  try {
    await fetchJson(`${API_BASE}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: entry.date,
        calories: Math.round(entry.calories),
        protein: Math.round(entry.protein),
        tdee: entry.tdee || TDEE,
        calorieTarget: entry.calorieTarget ?? Math.max(0, (entry.tdee || TDEE) - DEFICIT_TARGET),
        proteinTarget: entry.proteinTarget ?? PROTEIN_TARGET,
        ...getCutPhaseSnapshot(entry.date)
      })
    });
    invalidateEntriesCache();
  } catch {
    // best-effort silent repair
  }
}

async function saveEntry(calories, protein) {
  setLoading(true);
  const roundedCalories = roundInt(calories);
  const roundedProtein = roundInt(protein);
  const calorieTarget = Math.max(0, roundInt(TDEE - DEFICIT_TARGET));
  const savedDeficit = roundInt(TDEE - roundedCalories);
  const shouldCelebrateTodayCommit = !todayEntry && currentDate === DIET_INITIAL_DATE;

  try {
    await fetchJson(`${API_BASE}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: currentDate,
        calories: roundedCalories,
        protein: roundedProtein,
        tdee: TDEE,
        calorieTarget,
        proteinTarget: PROTEIN_TARGET,
        ...getCutPhaseSnapshot(currentDate)
      })
    });

    todayLogged = true;
    rememberLoggedDate(currentDate);
    const savedDeficitTarget = Math.max(0, roundInt(TDEE - calorieTarget));
    const savedCalResult = getCalorieResult(roundedCalories, TDEE, savedDeficitTarget);
    const savedProtResult = getProteinResult(roundedProtein, PROTEIN_TARGET);
    const didDoubleHit = savedCalResult.state === "on-plan" && savedProtResult.celebrated;
    closeQuickEntry({ haptic: false });
    pendingCountUp = true;
    invalidateEntriesCache();
    await loadWeekSummary();
    loadAdherenceData();
    loadMonthlyData();
    triggerHaptic("success");
    triggerSaveReward();
    const celebrationVariant = didDoubleHit ? "double-hit" : null;
    if (celebrationVariant || shouldCelebrateTodayCommit) {
      showCelebration({ variant: celebrationVariant ?? "logged" });
    }
  } catch (error) {
    setStatus("Could not save");
    alert(error.message || "Could not save");
  } finally {
    setLoading(false);
  }
}

function triggerSaveReward() {
  const card = document.querySelector(".daily-card");
  if (!card) return;

  card.classList.remove("saved-pulse");
  void card.offsetWidth;
  card.classList.add("saved-pulse");
}

function setSummaryRefreshing(isRefreshing) {
  const daily = document.getElementById("daily-result");
  const weekly = document.getElementById("weekly-summary");

  daily?.classList.toggle("content-refreshing", isRefreshing);
  weekly?.classList.toggle("content-refreshing", isRefreshing);

  if (isRefreshing) {
    if (daily && !daily.innerHTML.trim()) {
      daily.innerHTML = dailySkeletonHtml();
    }
    if (weekly && !weekly.innerHTML.trim()) {
      weekly.innerHTML = weekSkeletonHtml();
    }
  }
}

function dailySkeletonHtml() {
  return `
    <section class="daily-card loading-card">
      <div class="daily-card-top">
        <h2 class="daily-card-heading">Today</h2>
        <button class="copy-phase-header-btn" type="button" tabindex="-1" aria-hidden="true"></button>
      </div>
      <div class="daily-metrics">
        <div class="stat-row">
          <span class="stat-main">
            <span class="stat-number">0000</span>
            <span class="stat-unit">kcal</span>
          </span>
          <span class="stat-label">Calories</span>
        </div>
        <div class="stat-row">
          <span class="stat-main">
            <span class="stat-number">000</span>
            <span class="stat-unit">g</span>
          </span>
          <span class="stat-label">Protein</span>
        </div>
      </div>
    </section>
  `;
}

function weekSkeletonHtml() {
  return `
    <section class="card week-card loading-card">
      <div class="card-header">
        <div class="card-header-left">
          <div class="card-header-title-row"><h2>This Week</h2></div>
          <p class="cut-phase-label">Loading</p>
        </div>
        <div class="card-actions">
          <span class="status-pill">—</span>
        </div>
      </div>
      <div class="week-snapshot">
        <div class="kpi-item">
          <span class="kpi-value">0,000<small>kcal</small></span>
          <span class="kpi-label">Avg calories</span>
        </div>
        <div class="kpi-item">
          <span class="kpi-value">000<small>g</small></span>
          <span class="kpi-label">Avg protein</span>
        </div>
        <div class="kpi-item">
          <span class="kpi-value">0.00<small>kg</small></span>
          <span class="kpi-label">Fat loss</span>
        </div>
      </div>
      <div class="week-trend-panel">
        <div class="week-trend-header">
          <div class="week-trend-header-start"><span>Daily intake</span></div>
          <strong class="trend-status">—</strong>
        </div>
        <div class="skel" style="height:var(--trend-bar-track-height,96px);margin-top:8px;border-radius:4px"></div>
      </div>
    </section>
  `;
}

function adherenceSkeletonHtml() {
  const DIST_STATES = [
    { label: "On Plan", cls: "on-plan" },
    { label: "Under",   cls: "under"   },
    { label: "Over",    cls: "over"    },
    { label: "Extreme", cls: "extreme" },
    { label: "Surplus", cls: "surplus" }
  ];
  return `
    <section class="card adherence-card loading-card">
      <div class="card-header">
        <div class="card-header-left">
          <h2 class="card-title">Last 30 Days</h2>
        </div>
      </div>
      <div class="adherence-hero">
        <span class="adherence-hero-label">Adherence</span>
        <strong class="adherence-hero-value">00%</strong>
      </div>
      <div class="adherence-secondary">
        <div class="adherence-stat adherence-stat--double-hit">
          <span class="adherence-stat-label">Double Hit</span>
          <strong class="adherence-stat-value">00%</strong>
          <span class="adherence-stat-pct">0/30 days</span>
        </div>
      </div>
      <div class="adherence-dist">
        <div class="adherence-dist-head" aria-hidden="true">
          <span></span><span></span><span>%</span><span>days</span>
        </div>
        ${DIST_STATES.map(({ label, cls }) => `
        <div class="adherence-dist-row adherence-dist-row--${cls}">
          <span class="adherence-dist-label">${label}</span>
          <span class="adherence-dist-bar" aria-hidden="true"></span>
          <span class="adherence-dist-pct">00%</span>
          <strong class="adherence-dist-value">00</strong>
        </div>`).join("")}
      </div>
    </section>
  `;
}

function monthlyContentSkeletonHtml() {
  return `
    <div class="monthly-logged-row">
      <div class="monthly-logged-text">
        <strong class="monthly-logged-value">00</strong>
        <span class="monthly-logged-sub">days recorded</span>
      </div>
    </div>
    <div class="adherence-dist monthly-review-details">
      <div class="adherence-dist-row">
        <span class="adherence-dist-label">Avg Calories</span>
        <strong class="adherence-dist-value">0,000</strong>
      </div>
      <div class="adherence-dist-row">
        <span class="adherence-dist-label">Avg Protein</span>
        <strong class="adherence-dist-value">000 g</strong>
      </div>
      <div class="adherence-dist-row">
        <span class="adherence-dist-label">Best streak</span>
        <strong class="adherence-dist-value">00 days</strong>
      </div>
    </div>
    <div class="monthly-verdict monthly-verdict--in-progress">
      <strong class="monthly-verdict-headline">Month in progress</strong>
    </div>
  `;
}

function monthlySkeletonHtml() {
  const now = new Date();
  return `
    <section class="card monthly-review-card loading-card">
      <div class="monthly-card-header">
        <span class="monthly-card-eyebrow">Monthly Review</span>
      </div>
      <div class="monthly-month-switch" role="group" aria-label="Browse month">
        <button id="monthlyPrevBtn" class="monthly-nav-btn" type="button" aria-label="Previous month">‹</button>
        <h2 class="card-title monthly-month-label">${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}</h2>
        <button id="monthlyNextBtn" class="monthly-nav-btn" type="button" aria-label="Next month" disabled>›</button>
      </div>
      <div class="monthly-content loading">
        ${monthlyContentSkeletonHtml()}
      </div>
    </section>
  `;
}

function renderInitialLoadingState() {
  const daily = document.getElementById("daily-result");
  const weekly = document.getElementById("weekly-summary");
  const adherence = document.getElementById("adherence-card");
  const monthly = document.getElementById("monthly-review");
  if (daily) daily.innerHTML = dailySkeletonHtml();
  if (weekly) weekly.innerHTML = weekSkeletonHtml();
  if (adherence) adherence.innerHTML = adherenceSkeletonHtml();
  if (monthly) monthly.innerHTML = monthlySkeletonHtml();
}

function getCopySummaryButtonHtml(disabled = false) {
  return `
    <button
      class="copy-phase-header-btn"
      type="button"
      data-copy-week-summary
      aria-label="Copy weekly summary"
      ${disabled ? "disabled" : ""}
    >
      <span class="copy-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">
          <rect x="9" y="9" width="13" height="13" rx="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
      </span>
      <span class="check-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </span>
    </button>
  `;
}

function deleteEntry() {
  openDeleteConfirm();
}

async function confirmDeleteEntry() {
  if (!todayEntry) return;

  closeQuickEntry({ haptic: false });
  setLoading(true);
  closeDeleteConfirm({ haptic: false });

  // Collapse the card out while the delete request is in flight.
  const card = document.querySelector(".daily-card:not(.empty)");
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const exitAnim = card && !reduceMotion
    ? new Promise((resolve) => {
        card.classList.add("deleting");
        card.addEventListener("animationend", resolve, { once: true });
        window.setTimeout(resolve, 260);
      })
    : Promise.resolve();

  try {
    await fetchJson(`${API_BASE}/api/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: currentDate })
    });

    await exitAnim;

    todayLogged = false;
    todayEntry = null;
    forgetLoggedDate(currentDate);
    invalidateEntriesCache();
    updateEntryForm();
    await loadWeekSummary();
    loadAdherenceData();
    loadMonthlyData();
    triggerHaptic("warning");
  } catch (error) {
    setStatus("Could not delete");
    alert(error.message || "Could not delete");
  } finally {
    setLoading(false);
  }
}

function getConsistency(entries) {
  if (entries.length < 3) return "Building";

  const deficits = entries.map((entry) => (entry.tdee || TDEE) - entry.calories);
  const average = deficits.reduce((sum, value) => sum + value, 0) / deficits.length;
  const variance = deficits.reduce((sum, value) => sum + Math.abs(value - average), 0) / deficits.length;

  if (variance < 250) return "Stable";
  if (variance < 500) return "Moderate";
  return "Variable";
}

function getDayLabel() {
  return getDisplayDateLabel(currentDate, { todayStyle: "plain" });
}

function getDisplayDateLabel(dateString, options = {}) {
  const { todayStyle = "compact" } = options;
  const date = new Date(`${dateString}T12:00:00`);
  const weekday = date.toLocaleDateString("en-US", { weekday: "short" });
  const shortDate = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric"
  });
  if (dateString === getDietDate()) {
    return todayStyle === "plain" ? "Today" : `${weekday} · Today`;
  }
  return `${weekday}, ${shortDate}`;
}

function formatDateRange(startDateString, endDateString) {
  if (!startDateString || !endDateString) return "";

  const start = new Date(`${startDateString}T12:00:00`);
  const end = new Date(`${endDateString}T12:00:00`);
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();

  if (sameMonth) {
    return `${start.toLocaleDateString("en-US", { month: "short" })} ${start.getDate()}-${end.getDate()}, ${end.getFullYear()}`;
  }

  const startOptions = sameYear
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" };
  const endOptions = { month: "short", day: "numeric", year: "numeric" };

  return `${start.toLocaleDateString("en-US", startOptions)}-${end.toLocaleDateString("en-US", endOptions)}`;
}

function formatPlainDateLabel(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

function roundInt(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function formatInt(value) {
  return roundInt(value).toLocaleString();
}

function formatFatLossKg(value) {
  const kg = Number(value);
  if (!Number.isFinite(kg) || kg <= 0) return "0";
  if (kg >= 10) return Math.round(kg).toLocaleString();
  if (kg >= 1) {
    return kg.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  }
  return kg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const METRIC_NOTE_PERFECT = "Perfect!";
const METRIC_NOTE_ON_TARGET = "On target";

function formatMetricOffset(delta, unit) {
  const v = roundInt(delta);
  if (v === 0) return METRIC_NOTE_ON_TARGET;
  const direction = v > 0 ? "over" : "under";
  return `${direction} by ${formatInt(Math.abs(v))} ${unit}`;
}

function formatCalorieSurplusNote(surplus) {
  return `${formatInt(surplus)} kcal surplus`;
}

function renderMetricAddPrompt() {
  return `
    <strong class="metric-add-prompt" aria-hidden="true">
      <span class="metric-add-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" focusable="false">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </span>
    </strong>
  `;
}

function getProgressPercent(value, target) {
  const safeTarget = Math.max(roundInt(target), 1);
  return Math.max(0, Math.min(100, Math.round((roundInt(value) / safeTarget) * 100)));
}

function getCalorieResult(calories, tdee = TDEE, deficitTarget = DEFICIT_TARGET) {
  const rawDelta = roundInt(tdee - calories);
  const isSurplus = rawDelta < 0;
  const deficit = Math.max(rawDelta, 0);
  const surplus = Math.max(-rawDelta, 0);
  const roundedDeficitTarget = roundInt(deficitTarget);

  let state;
  if (isSurplus) {
    state = "surplus";
  } else if (roundedDeficitTarget === 0) {
    state = "on-plan";
  } else {
    const ratio = deficit / roundedDeficitTarget;
    if (ratio < 0.75) state = "under";
    else if (ratio <= 1.25) state = "on-plan";
    else if (ratio <= 1.35) state = "over";
    else state = "extreme";
  }

  const isPerfect = state === "on-plan" && deficit === roundedDeficitTarget;
  const celebrated = state === "on-plan";

  return {
    deficit,
    surplus,
    isSurplus,
    isPerfect,
    state,
    celebrated,
    progress: state === "under" ? getProgressPercent(deficit, roundedDeficitTarget) : 100,
    tone: isSurplus ? "surplus" : "logged",
    status: isSurplus ? "Surplus" : "Deficit"
  };
}

function getProteinResult(protein, proteinTarget = PROTEIN_TARGET) {
  const roundedProtein = roundInt(protein);
  const roundedProteinTarget = roundInt(proteinTarget);
  const gap = Math.max(roundInt(roundedProteinTarget - roundedProtein), 0);
  const isPerfect = roundedProtein === roundedProteinTarget;

  return {
    status: "Protein",
    isPerfect,
    progress: getProgressPercent(roundedProtein, roundedProteinTarget),
    celebrated: gap <= (roundedProteinTarget * 0.1)
  };
}

function buildWeeklyPlainTextSummary(summary) {
  const entries = summary.entries || [];
  const range = formatDateRange(summary.weekStart, summary.weekEnd).replace(/, \d{4}/g, "");
  const targetSnapshots = entries.map((entry) => {
    const tdee = entry.tdee || TDEE;
    const calorieTarget = entry.calorieTarget ?? Math.max(0, tdee - DEFICIT_TARGET);
    const proteinTarget = entry.proteinTarget ?? PROTEIN_TARGET;
    return `${formatInt(tdee)}/${formatInt(calorieTarget)}/${formatInt(proteinTarget)}`;
  });
  const uniqueTargets = [...new Set(targetSnapshots)];
  const targetLine = uniqueTargets.length === 1
    ? `Targets ${uniqueTargets[0]} (TDEE/cal/protein)`
    : "Targets vary by day";
  const lines = [
    `Week summary (${range})`,
    targetLine,
    `${summary.count || 0}/7 days logged, ${summary.consistency || getConsistency(entries)}`,
    `Avg ${formatInt(summary.averageCalories || 0)} kcal, ${formatInt(summary.averageProtein || 0)}g protein`,
    `Total deficit ${formatInt(summary.totalDeficit || 0)} kcal (${formatFatLossKg(summary.fatLossKg || 0)} kg est)`,
    "",
    "Daily"
  ];

  if (!entries.length) {
    lines.push("No entries");
    return lines.join("\n");
  }

  entries.forEach((entry) => {
    const tdee = entry.tdee || TDEE;
    const calorieTarget = entry.calorieTarget ?? Math.max(0, tdee - DEFICIT_TARGET);
    const proteinTarget = entry.proteinTarget ?? PROTEIN_TARGET;
    const deficit = roundInt(tdee - entry.calories);
    const deficitText = deficit < 0
      ? `+${formatInt(Math.abs(deficit))}`
      : `-${formatInt(deficit)}`;
    const targetsText = uniqueTargets.length > 1
      ? `, target ${formatInt(calorieTarget)} kcal/${formatInt(proteinTarget)}g`
      : "";

    lines.push(
      `${formatPlainDateLabel(entry.date)}: ${formatInt(entry.calories)} kcal, ${formatInt(entry.protein)}g, ${deficitText}${targetsText}`
    );
  });

  return lines.join("\n");
}

function buildTodayPlainTextSummary(today, entryCalorieTarget, entryDeficitTarget, entryProteinTarget) {
  const tdee = today.tdee || TDEE;
  const deficit = roundInt(tdee - today.calories);
  const deficitText = deficit < 0 ? `+${formatInt(Math.abs(deficit))}` : `-${formatInt(deficit)}`;
  const dateLabel = formatPlainDateLabel(today.date);
  return [
    `${dateLabel}: ${formatInt(roundInt(today.calories))} kcal, ${formatInt(roundInt(today.protein))}g, ${deficitText}`,
    `Target ${formatInt(tdee)}/${formatInt(entryCalorieTarget)}/${formatInt(entryProteinTarget)} (TDEE/cal/protein)`
  ].join("\n");
}

function buildMonthInsightText(stats) {
  const { logged, onPlan, dist } = stats;
  if (!logged) return "";
  const offPlan = logged - onPlan;
  const under = dist.under || 0;
  const over = dist.over || 0;
  const extreme = dist.extreme || 0;
  const surplus = dist.surplus || 0;
  const sentences = [];
  if (offPlan === 0) {
    sentences.push("All days on plan so far.");
  } else {
    if (under > over) {
      sentences.push("Mostly under target.");
    } else if (over > under) {
      sentences.push("Mostly over target.");
    } else if (under > 0 && over > 0) {
      sentences.push("Split evenly above and below target.");
    }
    if (extreme > 0) {
      sentences.push(`${extreme} day${extreme === 1 ? "" : "s"} with unusually large deficits.`);
    }
    if (surplus > 0) {
      sentences.push(`${surplus} surplus day${surplus === 1 ? "" : "s"}.`);
    } else if (extreme === 0) {
      sentences.push("No surplus or extreme days.");
    }
  }
  return sentences.join(" ");
}

function buildMonthlyPlainTextSummary(stats) {
  const { year, month, logged, daysInMonth, avgCalories, avgProtein, bestStreak, currentStreak } = stats;
  const now = new Date();
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;

  const lines = [
    `${MONTH_NAMES[month - 1]} ${year}`,
    "",
    isCurrentMonth ? `${logged} day${logged === 1 ? "" : "s"} recorded` : `${logged}/${daysInMonth} days logged`,
  ];

  if (avgCalories > 0 || avgProtein > 0) lines.push("");
  if (avgCalories > 0) lines.push(`Avg ${formatInt(avgCalories)} kcal`);
  if (avgProtein > 0) lines.push(`Avg ${avgProtein} g protein`);

  if (currentStreak > 0 || bestStreak > 0) lines.push("");
  if (currentStreak > 0) lines.push(`Current streak ${currentStreak} day${currentStreak === 1 ? "" : "s"}`);
  if (bestStreak > 0) lines.push(`Best streak ${bestStreak} day${bestStreak === 1 ? "" : "s"}`);

  if (isCurrentMonth && logged > 0) {
    const insight = buildMonthInsightText(stats);
    if (insight) {
      lines.push("", "Month in progress", "", insight);
    }
  } else {
    const verdict = getMonthlyVerdict(stats);
    if (verdict?.headline) lines.push("", verdict.headline);
  }

  return lines.join("\n");
}

async function handleCopyMonthSummaryClick(event) {
  const button = event.target.closest("[data-copy-month-summary]");
  if (!button) return;
  if (!latestMonthStats) return;
  track("copy_month");
  try {
    button.classList.remove("copied");
    await copyTextToClipboard(buildMonthlyPlainTextSummary(latestMonthStats));
    button.classList.add("copied");
    triggerHaptic("success");
    setTimeout(() => button.classList.remove("copied"), 1400);
  } catch {
    showToast("Could not copy");
  }
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to textarea fallback.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none";
  document.body.appendChild(textarea);

  try {
    // iOS requires contentEditable + manual range selection; textarea.select() doesn't work there.
    const isIOS = /ipad|iphone|ipod/i.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isIOS) {
      textarea.contentEditable = "true";
      textarea.readOnly = false;
      const range = document.createRange();
      range.selectNodeContents(textarea);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(0, textarea.value.length);
    const copied = document.execCommand("copy");
    if (!copied) throw new Error("execCommand failed");
  } finally {
    textarea.remove();
  }
}

function getEntryTargets(entry) {
  const entryTdee = entry.tdee || TDEE;
  const entryCalorieTarget = entry.calorieTarget ?? Math.max(0, entryTdee - DEFICIT_TARGET);
  const entryDeficitTarget = Math.max(0, entryTdee - entryCalorieTarget);
  const entryProteinTarget = entry.proteinTarget ?? PROTEIN_TARGET;
  return { entryTdee, entryCalorieTarget, entryDeficitTarget, entryProteinTarget };
}

function formatTrendDayValueHtml(trendDay) {
  if (!trendDay?.entry) return "";
  return `
    <span class="trend-value-line trend-value-kcal">${formatInt(trendDay.entry.calories)}</span>
    <span class="trend-value-line trend-value-protein">${formatInt(trendDay.entry.protein)}</span>
  `;
}

function formatTrendDayValueLabel(trendDay) {
  if (!trendDay?.entry) return "Not logged";
  const { calorieResult, entryDeficitTarget, entryProteinTarget } = trendDay;
  const deficitText = calorieResult.isSurplus
    ? `+${formatInt(calorieResult.surplus)} kcal surplus`
    : `${formatInt(calorieResult.deficit)} / ${formatInt(entryDeficitTarget)} kcal deficit`;
  return `${deficitText}, ${formatInt(trendDay.entry.protein)} / ${formatInt(entryProteinTarget)} g protein`;
}

const TREND_BAR_TRACK_HEIGHT = 96;
const TREND_BAR_MIN_HEIGHT = 10;
// Placeholder silhouette: left (deficit) lower, right (protein) higher — matches typical logged days.
const TREND_BAR_MISSING_KCAL_RATIO = 0.35;
const TREND_BAR_MISSING_PROTEIN_RATIO = 0.46;

function getMissingTrendBarHeights() {
  return {
    kcalHeight: Math.max(TREND_BAR_MIN_HEIGHT, Math.round(TREND_BAR_TRACK_HEIGHT * TREND_BAR_MISSING_KCAL_RATIO)),
    proteinHeight: Math.max(TREND_BAR_MIN_HEIGHT, Math.round(TREND_BAR_TRACK_HEIGHT * TREND_BAR_MISSING_PROTEIN_RATIO))
  };
}

function progressToTrendBarHeight(progress) {
  const clamped = Math.max(0, Math.min(130, roundInt(progress)));
  return Math.max(
    TREND_BAR_MIN_HEIGHT,
    Math.round((clamped / 100) * TREND_BAR_TRACK_HEIGHT)
  );
}

function getTrendDayMetrics(entry) {
  if (!entry) {
    const { kcalHeight, proteinHeight } = getMissingTrendBarHeights();
    return {
      entry: null,
      kcalHeight,
      kcalOverHeight: 0,
      proteinHeight,
      proteinOverHeight: 0,
      kcalState: "missing",
      proteinState: "missing"
    };
  }

  const { entryTdee, entryCalorieTarget, entryDeficitTarget, entryProteinTarget } = getEntryTargets(entry);
  const calorieResult = getCalorieResult(entry.calories, entryTdee, entryDeficitTarget);
  const proteinResult = getProteinResult(entry.protein, entryProteinTarget);

  const kcalProgress = getProgressPercent(entry.calories, entryCalorieTarget);
  const kcalBaseHeight = progressToTrendBarHeight(Math.min(100, kcalProgress));
  const proteinBaseHeight = progressToTrendBarHeight(Math.min(100, proteinResult.progress));

  return {
    entry,
    calorieResult,
    proteinResult,
    entryDeficitTarget,
    entryProteinTarget,
    kcalHeight: kcalBaseHeight,
    kcalOverHeight: progressToTrendBarHeight(kcalProgress) - kcalBaseHeight,
    proteinHeight: proteinBaseHeight,
    proteinOverHeight: progressToTrendBarHeight(proteinResult.progress) - proteinBaseHeight,
    kcalState: calorieResult.isSurplus ? "surplus" : calorieResult.celebrated ? "celebrated" : "neutral",
    proteinState: proteinResult.celebrated ? "celebrated" : "neutral"
  };
}

function renderTrendLegend() {
  return `
    <div class="trend-legend" aria-hidden="true">
      <span class="trend-legend-item"><span class="trend-legend-swatch trend-legend-swatch-kcal"></span>deficit</span>
      <span class="trend-legend-item"><span class="trend-legend-swatch trend-legend-swatch-protein"></span>protein</span>
    </div>
  `;
}

function renderTrendBars(entries) {
  const weekEntries = entries || [];
  const entryByDate = new Map(weekEntries.map((entry) => [entry.date, entry]));
  const start = getWeekStart(currentDate);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });

  // Cascade the bars in only when the week actually changes — not on every
  // same-week day-swipe, which would make the chart flicker.
  const weekStartKey = formatDate(start);
  const stagger = weekStartKey !== lastTrendWeekStart;
  lastTrendWeekStart = weekStartKey;

  return `
    <div class="trend-bars" aria-label="Weekly progress trend">
      ${days
        .map((date, dayIndex) => {
          const dateString = formatDate(date);
          const entry = entryByDate.get(dateString);
          const isMissing = !entry;
          const trendDay = getTrendDayMetrics(entry);
          const { kcalHeight, kcalOverHeight, proteinHeight, proteinOverHeight, kcalState, proteinState } = trendDay;
          const isSelected = dateString === currentDate;
          const isFuture = isFutureDate(dateString);
          const weekday = date.toLocaleDateString("en-US", { weekday: "short" });
          const shortDate = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          const valueLabel = formatTrendDayValueLabel(trendDay);
          const barTitle = entry ? `${dateString}: ${valueLabel}` : `${dateString}: No data`;

          return `
            <button
              type="button"
              class="trend-day ${isSelected ? "selected" : ""} ${isMissing ? "missing" : ""} ${isFuture ? "future" : ""}"
              ${stagger ? `style="--bar-index:${dayIndex}"` : ""}
              data-date="${dateString}"
              aria-label="Select ${weekday}, ${shortDate}. ${valueLabel}"
              ${isFuture ? "disabled" : ""}
              ${isSelected ? "aria-current=\"date\"" : ""}
            >
              <span class="trend-value">${formatTrendDayValueHtml(trendDay)}</span>
              <div class="trend-bar-pair" title="${barTitle}">
                <div class="trend-bar-slot">
                  ${kcalOverHeight > 0 ? `<div class="trend-bar-cap trend-bar-kcal ${kcalState}" style="height:${kcalOverHeight}px"></div>` : ""}
                  <div class="trend-bar trend-bar-kcal ${kcalState}" style="height:${kcalHeight}px"></div>
                </div>
                <div class="trend-bar-slot">
                  ${proteinOverHeight > 0 ? `<div class="trend-bar-cap trend-bar-protein ${proteinState}" style="height:${proteinOverHeight}px"></div>` : ""}
                  <div class="trend-bar trend-bar-protein ${proteinState}" style="height:${proteinHeight}px"></div>
                </div>
              </div>
              <span class="trend-weekday">${weekday}<span class="trend-date">${date.getDate()}</span></span>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

function getWeekStart(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diffToMonday);
  return date;
}

function handleTrendDayClick(event) {
  const button = event.target.closest(".trend-day[data-date]");
  if (!button || button.disabled) return;

  const date = button.dataset.date;
  if (!date) return;

  setDietDay(date);
}

async function handleCopyWeeklySummaryClick(event) {
  const button = event.target.closest("[data-copy-week-summary]");
  if (!button || !latestWeekSummary) return;
  track("copy_week");
  event.preventDefault();
  event.stopPropagation();

  try {
    button.classList.remove("copied");
    button.classList.add("copying");
    await copyTextToClipboard(buildWeeklyPlainTextSummary(latestWeekSummary));
    button.disabled = true;
    button.classList.remove("copying");
    button.classList.add("copied");
    button.setAttribute("aria-label", "Weekly summary copied");
    triggerHaptic("success");
    setTimeout(() => {
      button.classList.remove("copied");
      button.disabled = false;
      button.setAttribute("aria-label", "Copy weekly summary");
    }, 1400);
  } catch (error) {
    button.classList.remove("copying", "copied");
    button.disabled = false;
    button.setAttribute("aria-label", "Copy weekly summary");
    showToast("Copy failed");
  }
}

async function handleCopyTodaySummaryClick(event) {
  const button = event.target.closest("[data-copy-today-summary]");
  if (!button || !todayEntry) return;
  track("copy_today");
  event.preventDefault();
  event.stopPropagation();

  const entryTdee = todayEntry.tdee || TDEE;
  const entryCalorieTarget = todayEntry.calorieTarget ?? Math.max(0, entryTdee - DEFICIT_TARGET);
  const entryDeficitTarget = Math.max(0, entryTdee - entryCalorieTarget);
  const entryProteinTarget = todayEntry.proteinTarget ?? PROTEIN_TARGET;

  try {
    button.classList.remove("copied");
    button.classList.add("copying");
    await copyTextToClipboard(buildTodayPlainTextSummary(todayEntry, entryCalorieTarget, entryDeficitTarget, entryProteinTarget));
    button.disabled = true;
    button.classList.remove("copying");
    button.classList.add("copied");
    button.setAttribute("aria-label", "Today copied");
    triggerHaptic("success");
    setTimeout(() => {
      button.classList.remove("copied");
      button.disabled = false;
      button.setAttribute("aria-label", "Copy today's summary");
    }, 1400);
  } catch {
    button.classList.remove("copying", "copied");
    button.disabled = false;
    button.setAttribute("aria-label", "Copy today's summary");
    showToast("Copy failed");
  }
}

let suppressDailyClickUntil = 0;

// Press and hold the logged day card to jump straight to delete — a non-colliding
// alternative to swipe (horizontal swipe is reserved for day navigation here).
function initLongPressDelete() {
  const el = document.getElementById("daily-result");
  if (!el) return;

  const HOLD_MS = 500;
  const MOVE_TOLERANCE = 10;
  let timer = null;
  let startX = 0;
  let startY = 0;
  let charging = null;

  function clear() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (charging) { charging.classList.remove("lp-charging"); charging = null; }
  }

  el.addEventListener("touchstart", (e) => {
    clear();
    if (!todayEntry || e.touches.length !== 1) return;
    const metric = e.target instanceof Element ? e.target.closest("[data-edit-field]") : null;
    if (!metric) return;

    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    charging = metric;
    metric.classList.add("lp-charging");
    timer = window.setTimeout(() => {
      timer = null;
      if (charging) { charging.classList.remove("lp-charging"); charging = null; }
      suppressDailyClickUntil = Date.now() + 700;
      triggerHaptic("warning");
      openDeleteConfirm();
    }, HOLD_MS);
  }, { passive: true });

  el.addEventListener("touchmove", (e) => {
    if (!timer || e.touches.length !== 1) return;
    const dx = Math.abs(e.touches[0].clientX - startX);
    const dy = Math.abs(e.touches[0].clientY - startY);
    if (dx > MOVE_TOLERANCE || dy > MOVE_TOLERANCE) clear();
  }, { passive: true });

  el.addEventListener("touchend", clear, { passive: true });
  el.addEventListener("touchcancel", clear, { passive: true });
}

function handleDailyMetricClick(event) {
  const metric = event.target.closest("[data-edit-field]");
  if (!metric) return;

  const field = metric.dataset.editField;
  if (field !== "calories" && field !== "protein") return;

  // Swallow the click that follows a long-press delete gesture.
  if (Date.now() < suppressDailyClickUntil) {
    event.preventDefault();
    return;
  }

  event.preventDefault();
  window.__quickEntryUserGesture = true;
  openQuickEntry(field);
  window.__quickEntryUserGesture = false;
}

function renderSummary(summary) {
  const dailyEl = document.getElementById("daily-result");
  const weeklyEl = document.getElementById("weekly-summary");
  if (!dailyEl || !weeklyEl) return;

  const today = summary.todayEntry;
  const rawConsistency = summary.consistency || getConsistency(summary.entries || []);
  const consistency = rawConsistency === "Stable" ? "Consistent" : rawConsistency;
  const consistencyTone = rawConsistency.toLowerCase();
  const isCompactLayout = window.matchMedia?.("(max-width: 620px)")?.matches;
  const loggedDays = summary.count || 0;
  const _weekStart = new Date(`${summary.weekStart}T12:00:00`);
  const _weekEnd = new Date(`${summary.weekEnd}T12:00:00`);
  const _dietToday = new Date(`${getDietDate()}T12:00:00`);
  const _effectiveEnd = _dietToday < _weekEnd ? _dietToday : _weekEnd;
  const daysElapsed = Math.round((_effectiveEnd - _weekStart) / (1000 * 60 * 60 * 24)) + 1;
  const weeklyPillText = loggedDays >= daysElapsed ? "Full week" : `${loggedDays} ${loggedDays === 1 ? "day" : "days"}`;
  const weekRangeText = formatDateRange(summary.weekStart, summary.weekEnd).replace(/, \d{4}/g, "");
  const dailyHeadingText = currentDate === getDietDate() ? "Today" : "This Day";
  latestWeekSummary = summary;
  let dailyHtml = "";

  if (today) {
    const entryTdee = today.tdee || TDEE;
    const entryCalorieTarget = today.calorieTarget ?? Math.max(0, entryTdee - DEFICIT_TARGET);
    const entryDeficitTarget = Math.max(0, entryTdee - entryCalorieTarget);
    const entryProteinTarget = today.proteinTarget ?? PROTEIN_TARGET;
    const calorieResult = getCalorieResult(today.calories, entryTdee, entryDeficitTarget);
    const proteinResult = getProteinResult(today.protein, entryProteinTarget);
    const roundedCalories = roundInt(today.calories);
    const roundedProtein = roundInt(today.protein);
    const calorieIntakeTarget = Math.max(0, entryCalorieTarget);
    const proteinOverTarget = Math.max(roundInt(roundedProtein - entryProteinTarget), 0);
    const proteinPerfect = roundedProtein === entryProteinTarget;
    // Within ±2 g counts as hitting target — a 1 g "miss" shouldn't read as off-plan.
    const proteinWithinTolerance = Math.abs(roundedProtein - entryProteinTarget) <= 2;
    const doubleHit = calorieResult.state === "on-plan" && proteinResult.celebrated;
    const statusPillText = doubleHit ? "Double hit" : "Logged";
    const statusPillClass = doubleHit ? "double-hit" : "logged";
    const cardHitClass = doubleHit ? "double-hit" : "";
    const calorieMetricTone = calorieResult.state === "surplus"
      ? "caution"
      : calorieResult.state === "extreme"
        ? "extreme"
        : calorieResult.state === "on-plan"
          ? "rewarded"
          : "";
    const proteinMetricTone = (proteinOverTarget > 0 || proteinPerfect || proteinWithinTolerance) ? "rewarded" : proteinResult.celebrated ? "on-track" : "";
    const proteinAlmostThere = proteinResult.celebrated && roundedProtein < entryProteinTarget;
    const calorieOverIntake = calorieResult.state === "under";
    const beyondPlanKcal = roundInt(calorieIntakeTarget - roundedCalories);
    const calorieMetricText = (() => {
      switch (calorieResult.state) {
        case "surplus": return formatCalorieSurplusNote(calorieResult.surplus);
        case "under": return `${formatInt(roundedCalories - calorieIntakeTarget)} kcal short`;
        case "on-plan": return calorieResult.isPerfect ? METRIC_NOTE_PERFECT : "On plan";
        case "over": return `${formatInt(beyondPlanKcal)} kcal beyond plan`;
        case "extreme": return "Recovery matters";
        default: return "";
      }
    })();
    const proteinDelta = roundedProtein - entryProteinTarget;
    const proteinMetricText = proteinPerfect || proteinDelta === 0 || proteinWithinTolerance
      ? METRIC_NOTE_PERFECT
      : proteinDelta > 0
        ? `+${formatInt(proteinDelta)} g over target`
        : `${formatInt(Math.abs(proteinDelta))} g short`;

    const calNoteClass = calorieResult.state === "surplus" || calorieResult.state === "extreme" ? "stat-note--warn" : "";
    const protNoteClass = "";

    dailyHtml = `
      <section class="daily-card ${cardHitClass}">
        <div class="daily-card-top">
          <h2 class="daily-card-heading">${dailyHeadingText}</h2>
          <button class="copy-phase-header-btn" type="button" data-copy-today-summary aria-label="Copy today's summary">
            <span class="copy-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></span>
            <span class="check-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false"><polyline points="20 6 9 17 4 12"/></svg></span>
          </button>
        </div>

        <div class="daily-metrics">
          <button class="stat-row" type="button" data-edit-field="calories" aria-label="Edit calories">
            <span class="stat-main">
              <span class="stat-number metric-figure ${calorieMetricTone}" data-count-to="${roundedCalories}">${formatInt(roundedCalories)}</span>
              <span class="stat-unit">kcal</span>
              ${doubleHit ? `<span class="status-pill ${statusPillClass}">${statusPillText}</span>` : ''}
            </span>
            <span class="stat-label">Calories</span>
            ${calorieMetricText ? `<span class="stat-note ${calNoteClass}">${calorieMetricText}</span>` : ''}
          </button>
          <button class="stat-row" type="button" data-edit-field="protein" aria-label="Edit protein">
            <span class="stat-main">
              <span class="stat-number metric-figure ${proteinMetricTone}" data-count-to="${roundedProtein}">${formatInt(roundedProtein)}</span>
              <span class="stat-unit">g</span>
            </span>
            <span class="stat-label">Protein</span>
            ${proteinMetricText ? `<span class="stat-note">${proteinMetricText}</span>` : ''}
          </button>
        </div>

      </section>
    `;
  } else {
    dailyHtml = `
      <section class="daily-card empty">
        <div class="daily-card-top">
          <h2 class="daily-card-heading">${dailyHeadingText}</h2>
          <span class="status-pill missing">No entry</span>
        </div>
        <div class="daily-metrics">
          <button class="stat-row stat-row--empty" type="button" data-edit-field="calories" aria-label="Add calories, tap to enter">
            <span class="stat-number stat-number--empty">—</span>
            <span class="stat-right">
              <span class="stat-unit">kcal</span>
              <span class="stat-meta">
                <span class="stat-label">Calories</span>
                <span class="stat-note">Target ${formatInt(Math.max(0, TDEE - DEFICIT_TARGET))} kcal</span>
              </span>
            </span>
          </button>
          <button class="stat-row stat-row--empty" type="button" data-edit-field="protein" aria-label="Add protein, tap to enter">
            <span class="stat-number stat-number--empty">—</span>
            <span class="stat-right">
              <span class="stat-unit">g</span>
              <span class="stat-meta">
                <span class="stat-label">Protein</span>
                <span class="stat-note">Target ${formatInt(PROTEIN_TARGET)} g</span>
              </span>
            </span>
          </button>
        </div>
      </section>
    `;
  }

  const cutLabel = getWeekCutPhaseLabel(summary);

  // Weekly metric water levels
  const weekCalorieTarget = Math.max(1, Math.round(TDEE - DEFICIT_TARGET));
  const weekAvgCal = roundInt(summary.averageCalories || 0);
  const weekAvgProtein = roundInt(summary.averageProtein || 0);
  const weekFatLossKg = summary.fatLossKg || 0;
  const weekFatLossTarget = (DEFICIT_TARGET * 7) / 7700;

  const weekCalOverTarget = weekAvgCal > weekCalorieTarget && (TDEE - weekAvgCal) > 0;
  const weekCalProgress = weekCalOverTarget
    ? Math.min(50, Math.round((weekAvgCal - weekCalorieTarget) / weekCalorieTarget * 100))
    : Math.min(100, Math.round(weekAvgCal / weekCalorieTarget * 100));
  const weekCalRewarded = !weekCalOverTarget && (TDEE - weekAvgCal) >= DEFICIT_TARGET * 0.9;
  const weekCalOver = weekCalOverTarget;

  const weekProteinProgress = Math.min(100, Math.round(weekAvgProtein / Math.max(1, PROTEIN_TARGET) * 100));
  const weekProteinRewarded = weekAvgProtein >= PROTEIN_TARGET * 0.9;

  const weekFatRewarded = weekFatLossKg >= weekFatLossTarget * 0.9;
  const isFullWeek = loggedDays >= 7;
  const weekDoubleHit = isFullWeek && weekCalRewarded && weekProteinRewarded && weekFatRewarded;
  const weekShowRewards = isFullWeek;

  const weekHtml = `
    <section class="card week-card ${weekDoubleHit ? "double-hit" : ""}">
      <div class="card-header">
        <div class="card-header-left">
          <div class="card-header-title-row">
            <h2>${isCurrentWeekRange(summary) ? "This Week" : weekRangeText}</h2>
          </div>
          ${cutLabel ? `<p class="cut-phase-label">${cutLabel}</p>` : ""}
        </div>
        <div class="card-actions">
          ${getCopySummaryButtonHtml()}
          <span class="status-pill logged">${weeklyPillText}</span>
        </div>
      </div>
      <div class="week-snapshot">
        <div class="kpi-item">
          <span class="kpi-value">${formatInt(summary.averageCalories || 0)}<small>kcal</small></span>
          <span class="kpi-label">Avg calories</span>
        </div>
        <div class="kpi-item">
          <span class="kpi-value">${formatInt(summary.averageProtein || 0)}<small>g</small></span>
          <span class="kpi-label">Avg protein</span>
        </div>
        <div class="kpi-item">
          <span class="kpi-value">${formatFatLossKg(summary.fatLossKg || 0)}<small>kg</small></span>
          <span class="kpi-label">Fat loss</span>
        </div>
      </div>
      <div class="week-trend-panel">
        <div class="week-trend-header">
          <div class="week-trend-header-start">
            <span>Daily intake</span>
            ${renderTrendLegend()}
          </div>
          <strong class="trend-status ${consistencyTone}">${consistency}</strong>
        </div>
        ${renderTrendBars(summary.entries || [])}
      </div>
    </section>
  `;

  dailyEl.innerHTML = dailyHtml;
  weeklyEl.innerHTML = weekHtml;
  runDailyCountUp();
}

function getSinceDate(daysBack = 29) {
  const date = new Date();
  date.setDate(date.getDate() - daysBack);
  return formatDate(date);
}

function computeAdherenceStats(entries, calendarDays, since, until) {
  let onPlan = 0, doubleHit = 0;
  const dist = { surplus: 0, under: 0, "on-plan": 0, over: 0, extreme: 0 };
  const entryMap = new Map(entries.map((e) => [e.date, e]));

  for (const entry of entries) {
    const tdee = entry.tdee || TDEE;
    const deficitTarget = entry.deficitTarget ?? Math.max(0, tdee - (entry.calorieTarget ?? Math.max(0, tdee - DEFICIT_TARGET)));
    const proteinTarget = entry.proteinTarget ?? PROTEIN_TARGET;
    const calResult = getCalorieResult(entry.calories, tdee, deficitTarget);
    const protResult = getProteinResult(entry.protein, proteinTarget);

    if (calResult.state in dist) dist[calResult.state]++;

    if (calResult.state === "on-plan") {
      onPlan++;
      if (protResult.celebrated) doubleHit++;
    }
  }

  // Current streak: consecutive on-plan days counting back from `until`
  let currentStreak = 0;
  if (since && until) {
    const [uy, um, ud] = until.split("-").map(Number);
    const [sy, sm, sd] = since.split("-").map(Number);
    const untilDate = new Date(uy, um - 1, ud);
    const sinceDate = new Date(sy, sm - 1, sd);
    for (let d = new Date(untilDate); d >= sinceDate; d.setDate(d.getDate() - 1)) {
      const dateStr = formatDate(d);
      const entry = entryMap.get(dateStr);
      if (!entry) break;
      const tdee = entry.tdee || TDEE;
      const deficitTarget = entry.deficitTarget ?? Math.max(0, tdee - (entry.calorieTarget ?? Math.max(0, tdee - DEFICIT_TARGET)));
      const calResult = getCalorieResult(entry.calories, tdee, deficitTarget);
      if (calResult.state !== "on-plan") break;
      currentStreak++;
    }
  }

  return {
    calendarDays,
    logged: entries.length,
    onPlan,
    doubleHit,
    adherence: calendarDays > 0 ? Math.round(onPlan / calendarDays * 100) : 0,
    dist,
    currentStreak
  };
}

function renderAdherenceCard(stats) {
  const { calendarDays, logged, doubleHit, adherence, dist, currentStreak } = stats;
  const doubleHitPct = Math.round(doubleHit / calendarDays * 100);
  const adherenceClass = adherence >= 80 ? "good" : adherence >= 60 ? "fair" : "low";

  const streakLine = currentStreak > 0
    ? `<div class="adherence-streak">Current streak <strong>${currentStreak}</strong> day${currentStreak === 1 ? "" : "s"}</div>`
    : "";

  return `
    <section class="card adherence-card">
      <div class="card-header">
        <div class="card-header-left">
          <h2 class="card-title">Last ${calendarDays} Days</h2>
        </div>
      </div>
      <div class="adherence-hero">
        <span class="adherence-hero-label">Adherence</span>
        <strong class="adherence-hero-value adherence-hero-value--${adherenceClass}">${adherence}%</strong>
      </div>
      <div class="adherence-secondary">
        <div class="adherence-stat adherence-stat--double-hit">
          <span class="adherence-stat-label">Double Hit</span>
          <strong class="adherence-stat-value">${doubleHitPct}%</strong>
          <span class="adherence-stat-pct">${doubleHit}/${calendarDays} days</span>
        </div>
      </div>
      <div class="adherence-dist">
        <div class="adherence-dist-head" aria-hidden="true">
          <span></span><span></span><span>%</span><span>days</span>
        </div>
        ${buildDistRows(dist, calendarDays)}
      </div>
      ${streakLine}
    </section>
  `;
}

async function loadAdherenceData() {
  const calendarDays = 30;
  const since = getSinceDate(calendarDays); // 30 days ago
  const until = getSinceDate(1);            // yesterday — today is in-progress, not a completed day
  const el = document.getElementById("adherence-card");
  if (!el) return;

  try {
    const data = await fetchEntries(since, until);
    if (!data.ok || !Array.isArray(data.entries)) return;
    const stats = computeAdherenceStats(data.entries, calendarDays, since, until);
    el.innerHTML = renderAdherenceCard(stats);
  } catch {
    // fail silently — adherence card is non-critical
  }
}

// ─── Monthly Review ───────────────────────────────────────────────────────────

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const STATE_LABELS = { "on-plan": "On Plan", under: "Under", over: "Over", extreme: "Extreme", surplus: "Surplus" };

let monthlyYear = new Date().getFullYear();
let monthlyMonth = new Date().getMonth() + 1;
let latestMonthStats = null;

function getMonthBounds(year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const pad = (n) => String(n).padStart(2, "0");
  return {
    since: `${year}-${pad(month)}-01`,
    until: `${year}-${pad(month)}-${pad(daysInMonth)}`,
    daysInMonth
  };
}

function computeMonthlyStats(entries, year, month, daysInMonth) {
  const entryMap = new Map(entries.map((e) => [e.date, e]));
  let onPlan = 0, doubleHit = 0, totalCalories = 0, totalProtein = 0;
  let runStreak = 0, bestStreak = 0;
  const dist = { surplus: 0, under: 0, "on-plan": 0, over: 0, extreme: 0 };
  const entryStates = new Map();
  const pad = (n) => String(n).padStart(2, "0");

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${pad(month)}-${pad(day)}`;
    const entry = entryMap.get(dateStr);

    if (entry) {
      const tdee = entry.tdee || TDEE;
      const deficitTarget = entry.deficitTarget ?? Math.max(0, tdee - (entry.calorieTarget ?? Math.max(0, tdee - DEFICIT_TARGET)));
      const proteinTarget = entry.proteinTarget ?? PROTEIN_TARGET;
      const calResult = getCalorieResult(entry.calories, tdee, deficitTarget);
      const protResult = getProteinResult(entry.protein, proteinTarget);
      entryStates.set(dateStr, calResult.state);
      if (calResult.state in dist) dist[calResult.state]++;
      totalCalories += entry.calories;
      totalProtein += entry.protein;
      if (calResult.state === "on-plan") {
        onPlan++;
        runStreak++;
        bestStreak = Math.max(bestStreak, runStreak);
        if (protResult.celebrated) doubleHit++;
      } else {
        runStreak = 0;
      }
    } else {
      runStreak = 0;
    }
  }

  const logged = entries.length;
  const nonZeroDist = Object.entries(dist).filter(([, v]) => v > 0);
  const mostCommonState = nonZeroDist.length
    ? nonZeroDist.reduce((a, b) => b[1] > a[1] ? b : a)[0]
    : null;

  const todayDate = new Date(); todayDate.setHours(0, 0, 0, 0);
  const isCurrentMonth = year === todayDate.getFullYear() && month === todayDate.getMonth() + 1;
  const cutoffDay = isCurrentMonth ? todayDate.getDate() : daysInMonth;
  let currentStreak = 0;
  for (let day = cutoffDay; day >= 1; day--) {
    const ds = `${year}-${pad(month)}-${pad(day)}`;
    const state = entryStates.get(ds);
    if (!state) break;
    if (state === "on-plan") currentStreak++;
    else break;
  }

  return {
    year, month, daysInMonth, logged, onPlan, doubleHit,
    adherence: Math.round(onPlan / daysInMonth * 100),
    loggedAdherence: logged > 0 ? Math.round(onPlan / logged * 100) : 0,
    avgCalories: logged > 0 ? Math.round(totalCalories / logged) : 0,
    avgProtein: logged > 0 ? Math.round(totalProtein / logged) : 0,
    dist, bestStreak, currentStreak, mostCommonState
  };
}

function getMonthlyVerdict(stats) {
  const { adherence, loggedAdherence, logged, daysInMonth, doubleHit, onPlan } = stats;
  if (logged === 0) return { headline: "No data for this month", detail: "" };

  const now = new Date();
  const isCurrentMonth = stats.year === now.getFullYear() && stats.month === now.getMonth() + 1;
  const scoringAdherence = isCurrentMonth ? (loggedAdherence ?? adherence) : adherence;

  const elapsedDays = isCurrentMonth
    ? (new Date().getDate())
    : daysInMonth;
  const logRate = logged / elapsedDays;
  const hitRate = onPlan > 0 ? doubleHit / onPlan : 0;
  const score = logRate * 35 + (scoringAdherence / 100) * 45 + hitRate * 20;

  let headline;
  if (score >= 85) headline = "Excellent month";
  else if (score >= 70) headline = "Good month";
  else if (score >= 50) headline = "Fair month";
  else headline = "Tough month";

  const detail = `${logged}/${daysInMonth} logged. ${scoringAdherence}% adherence. ${doubleHit} double ${doubleHit === 1 ? "hit" : "hits"}.`;

  return { headline, detail };
}

function buildDistRows(dist, denominator, { hideZero = false } = {}) {
  const all = [
    { key: "on-plan", label: "On Plan", cls: "on-plan" },
    { key: "under",   label: "Under",   cls: "under"   },
    { key: "over",    label: "Over",    cls: "over"    },
    { key: "extreme", label: "Extreme", cls: "extreme" },
    { key: "surplus", label: "Surplus", cls: "surplus" }
  ];
  const onPlanRow = all[0];
  const rest = all.slice(1).sort((a, b) => (dist[b.key] ?? 0) - (dist[a.key] ?? 0));
  const rows = [onPlanRow, ...rest];
  const maxCount = Math.max(1, ...rows.map(({ key }) => dist[key] ?? 0));
  return rows
    .filter(({ key }) => !hideZero || (dist[key] ?? 0) > 0)
    .map(({ key, label, cls }) => {
      const count = dist[key] ?? 0;
      const barPct = Math.round(count / maxCount * 100);
      const calPct = Math.round(count / denominator * 100);
      return `
    <div class="adherence-dist-row adherence-dist-row--${cls}">
      <span class="adherence-dist-label">${label}</span>
      <span class="adherence-dist-bar" style="--bar-pct:${barPct}%" aria-hidden="true"></span>
      <span class="adherence-dist-pct">${calPct}%</span>
      <strong class="adherence-dist-value">${count}</strong>
    </div>`;
    }).join("");
}

function renderMonthlyContentHtml(stats, prevStats = null) {
  const { year, month, daysInMonth, logged, avgCalories, avgProtein, bestStreak } = stats;
  const now = new Date();
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;

  const hasPrev = prevStats && prevStats.logged > 0;
  const delta = (curr, prev, suffix = "") => {
    if (!hasPrev) return "";
    const d = curr - prev;
    if (d === 0) return "";
    const up = d > 0;
    return `<span class="monthly-delta monthly-delta--${up ? "up" : "down"}">${up ? "↑" : "↓"} ${Math.abs(d)}${suffix}</span>`;
  };

  const verdict = getMonthlyVerdict(stats);

  return `
    <div class="monthly-logged-row">
      <div class="monthly-logged-text">
        <strong class="monthly-logged-value">
          ${isCurrentMonth ? `${logged}` : `${logged}<small>/${daysInMonth}</small>`}
        </strong>
        <span class="monthly-logged-sub">${isCurrentMonth ? "days recorded" : "days logged"}</span>
      </div>
      <button class="copy-phase-header-btn" type="button" data-copy-month-summary aria-label="Copy month report">
        <span class="copy-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">
            <rect x="9" y="9" width="13" height="13" rx="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </span>
        <span class="check-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </span>
      </button>
    </div>
    <div class="adherence-dist monthly-review-details">
      <div class="adherence-dist-row">
        <span class="adherence-dist-label">Avg Calories</span>
        <strong class="adherence-dist-value">${avgCalories > 0 ? formatInt(avgCalories) : "—"}</strong>
      </div>
      <div class="adherence-dist-row">
        <span class="adherence-dist-label">Avg Protein</span>
        <strong class="adherence-dist-value">${avgProtein > 0 ? avgProtein + " g" : "—"}</strong>
      </div>
      <div class="adherence-dist-row">
        <span class="adherence-dist-label">Best streak</span>
        <strong class="adherence-dist-value">${bestStreak > 0 ? bestStreak + (bestStreak === 1 ? " day" : " days") : "—"}</strong>
        ${delta(bestStreak, prevStats?.bestStreak ?? 0, bestStreak === 1 ? " day" : " days")}
      </div>
    </div>
    ${isCurrentMonth ? `
    <div class="monthly-verdict monthly-verdict--in-progress">
      <strong class="monthly-verdict-headline">Month in progress</strong>
      ${logged > 0 ? (() => {
        const insight = buildMonthInsightText(stats);
        return insight ? `<span class="monthly-verdict-detail">${insight}</span>` : "";
      })() : ""}
    </div>` : verdict.headline ? `
    <div class="monthly-verdict">
      <strong class="monthly-verdict-headline">${verdict.headline}</strong>
      ${verdict.detail ? `<span class="monthly-verdict-detail">${verdict.detail}</span>` : ""}
    </div>` : ""}
  `;
}

async function loadMonthlyData({ slideDirection } = {}) {
  const el = document.getElementById("monthly-review");
  if (!el) return;

  const now = new Date();
  const canGoNext = !(monthlyYear === now.getFullYear() && monthlyMonth === now.getMonth() + 1);

  // Create shell if completely absent (e.g. container was wiped)
  let card = el.querySelector(".monthly-review-card");
  if (!card) {
    el.innerHTML = `
      <section class="card monthly-review-card">
        <div class="monthly-card-header">
          <span class="monthly-card-eyebrow">Monthly Review</span>
        </div>
        <div class="monthly-month-switch" role="group" aria-label="Browse month">
          <button id="monthlyPrevBtn" class="monthly-nav-btn" type="button" aria-label="Previous month">‹</button>
          <h2 class="card-title monthly-month-label">${MONTH_NAMES[monthlyMonth - 1]} ${monthlyYear}</h2>
          <button id="monthlyNextBtn" class="monthly-nav-btn" type="button" aria-label="Next month" ${canGoNext ? "" : "disabled"}>›</button>
        </div>
        <div class="monthly-content">${monthlyContentSkeletonHtml()}</div>
      </section>`;
    card = el.querySelector(".monthly-review-card");
  }

  // Sweep the month label; everything else is stationary
  const label = card.querySelector(".monthly-month-label");
  if (label) {
    label.textContent = `${MONTH_NAMES[monthlyMonth - 1]} ${monthlyYear}`;
    if (slideDirection) {
      label.removeAttribute("data-slide-in");
      void label.offsetWidth; // force reflow so animation restarts
      label.dataset.slideIn = slideDirection;
      label.addEventListener("animationend", () => label.removeAttribute("data-slide-in"), { once: true });
    }
  }
  const nextBtn = card.querySelector("#monthlyNextBtn");
  if (nextBtn) nextBtn.disabled = !canGoNext;

  // Attach nav listeners exactly once (skeleton may have rendered the buttons already)
  if (!card.dataset.navReady) {
    card.dataset.navReady = "1";
    card.querySelector("#monthlyPrevBtn")?.addEventListener("click", () => {
      track("open_month_prev");
      monthlyMonth--;
      if (monthlyMonth < 1) { monthlyMonth = 12; monthlyYear--; }
      loadMonthlyData({ slideDirection: "right" });
    });
    card.querySelector("#monthlyNextBtn")?.addEventListener("click", () => {
      const n = new Date();
      if (monthlyYear === n.getFullYear() && monthlyMonth === n.getMonth() + 1) return;
      track("open_month_next");
      monthlyMonth++;
      if (monthlyMonth > 12) { monthlyMonth = 1; monthlyYear++; }
      loadMonthlyData({ slideDirection: "left" });
    });
  }

  // On first load: replace with skeleton HTML. On month switch: just add
  // .loading so CSS shimmers only the value elements — labels stay put.
  const contentEl = card.querySelector(".monthly-content");
  const isFirstLoad = !contentEl || contentEl.innerHTML.trim() === "" || contentEl.classList.contains("loading");
  if (contentEl) {
    contentEl.classList.add("loading");
    if (isFirstLoad) contentEl.innerHTML = monthlyContentSkeletonHtml();
  }

  const { since, until, daysInMonth } = getMonthBounds(monthlyYear, monthlyMonth);
  const prevMonthDate = new Date(monthlyYear, monthlyMonth - 2, 1);
  const prevY = prevMonthDate.getFullYear();
  const prevM = prevMonthDate.getMonth() + 1;
  const { since: prevSince, until: prevUntil, daysInMonth: prevDays } = getMonthBounds(prevY, prevM);
  try {
    const [currData, prevData] = await Promise.all([
      fetchEntries(since, until),
      fetchEntries(prevSince, prevUntil)
    ]);
    if (!currData.ok || !Array.isArray(currData.entries)) throw new Error("Failed to load entries");
    const stats = computeMonthlyStats(currData.entries, monthlyYear, monthlyMonth, daysInMonth);
    latestMonthStats = stats;
    const prevStats = (prevData.ok && Array.isArray(prevData.entries) && prevData.entries.length > 0)
      ? computeMonthlyStats(prevData.entries, prevY, prevM, prevDays)
      : null;

    card.classList.remove("loading-card");
    const freshContent = card.querySelector(".monthly-content");
    if (freshContent) {
      freshContent.classList.remove("loading");
      freshContent.innerHTML = renderMonthlyContentHtml(stats, prevStats);
    }
    card.querySelector("[data-copy-month-summary]")?.addEventListener("click", handleCopyMonthSummaryClick);
  } catch (err) {
    if (err && err.isAuthError) return;
    console.error("[monthly]", err);
    card?.classList.remove("loading-card");
    const freshContent = card?.querySelector(".monthly-content");
    if (freshContent) {
      freshContent.classList.remove("loading");
      freshContent.innerHTML = `<p class="monthly-error">Unable to load — tap to retry</p>`;
      freshContent.addEventListener("click", () => loadMonthlyData(), { once: true });
    }
  }
}

function initMonthlySwipe() {
  const viewport = document.getElementById("monthly-viewport");
  if (!viewport) return;

  const THRESHOLD = 50;
  let touchStartX = 0;
  let touchStartY = 0;
  let activeDrag = false;
  let dragCancelled = false;
  let transitioning = false;
  let crossedThreshold = false;

  function atForwardBoundary() {
    const now = new Date();
    return monthlyYear === now.getFullYear() && monthlyMonth === now.getMonth() + 1;
  }

  function commitSwipe(forward) {
    transitioning = true;
    triggerHaptic("select");
    if (forward) {
      monthlyMonth++;
      if (monthlyMonth > 12) { monthlyMonth = 1; monthlyYear++; }
    } else {
      monthlyMonth--;
      if (monthlyMonth < 1) { monthlyMonth = 12; monthlyYear--; }
    }
    loadMonthlyData({ slideDirection: forward ? "left" : "right" });
    transitioning = false;
  }

  viewport.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1 || transitioning) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    activeDrag = false;
    dragCancelled = false;
    crossedThreshold = false;
  }, { passive: true });

  viewport.addEventListener("touchmove", (e) => {
    if (e.touches.length !== 1 || dragCancelled || transitioning) return;

    const deltaX = e.touches[0].clientX - touchStartX;
    const deltaY = e.touches[0].clientY - touchStartY;

    if (!activeDrag) {
      if ((Math.abs(deltaY) > Math.abs(deltaX) * 1.2) && (Math.abs(deltaY) > 8 || Math.abs(deltaX) > 8)) {
        dragCancelled = true;
        return;
      }
      if (Math.abs(deltaX) > 8) activeDrag = true;
      else return;
    }

    e.preventDefault();

    const atBoundary = deltaX < 0 && atForwardBoundary();
    const wouldCommit = !atBoundary && Math.abs(deltaX) >= THRESHOLD && Math.abs(deltaX) >= Math.abs(deltaY) * 1.5;
    if (wouldCommit && !crossedThreshold) {
      crossedThreshold = true;
      triggerHaptic("tap");
    } else if (!wouldCommit && crossedThreshold) {
      crossedThreshold = false;
    }
  }, { passive: false });

  viewport.addEventListener("touchend", (e) => {
    if (!activeDrag) { activeDrag = false; dragCancelled = false; return; }
    activeDrag = false;
    dragCancelled = false;

    const deltaX = e.changedTouches[0].clientX - touchStartX;
    const deltaY = e.changedTouches[0].clientY - touchStartY;

    if (Math.abs(deltaX) < THRESHOLD || Math.abs(deltaX) < Math.abs(deltaY) * 1.5) return;

    const forward = deltaX < 0;
    if (forward && atForwardBoundary()) return;

    commitSwipe(forward);
  }, { passive: true });
}

async function loadWeekSummary() {
  const requestedDate = currentDate;

  updateDietDayDisplay();
  hideEntryFormWhileLoading();
  setSummaryRefreshing(true);

  try {
    const data = await fetchJson(`${API_BASE}/api/summary?today=${encodeURIComponent(requestedDate)}&tdee=${encodeURIComponent(TDEE)}`);

    if (requestedDate !== currentDate) return;

    todayLogged = Boolean(data.summary.todayLogged);
    todayEntry = data.summary.todayEntry;

    if (todayEntry) {
      rememberLoggedDate(currentDate);
      repairEntryPhaseIfNeeded(todayEntry);
    } else {
      forgetLoggedDate(currentDate);
    }

    updateEntryForm();
    renderSummary(data.summary);
    setSummaryRefreshing(false);
    setStatus("");
    fetchLatestPhaseLog().then(phase => { latestPhaseLog = phase; }).catch(() => {});
  } catch (error) {
    if (error.isAuthError) {
      setSummaryRefreshing(false);
      setStatus("Locked");
      return;
    }

    setStatus("Could not load summary");
    setSummaryRefreshing(false);
    const dailyResult = document.getElementById("daily-result");
    if (dailyResult) {
      const section = document.createElement("section");
      section.className = "daily-card empty";
      const h2 = document.createElement("h2");
      h2.textContent = "Unable to load data";
      const p = document.createElement("p");
      p.className = "empty-state";
      p.textContent = error.message || "Please try again later.";
      section.appendChild(h2);
      section.appendChild(p);
      dailyResult.replaceChildren(section);
    }
    const weeklySummary = document.getElementById("weekly-summary");
    if (weeklySummary) weeklySummary.innerHTML = "";
  }
}

function handleFormSubmit(event) {
  event.preventDefault();

  try {
    const { calories, protein } = getFormValues();
    saveEntry(calories, protein);
  } catch (error) {
    triggerHaptic("error");
    setStatus(error.message);
  }
}

function handleCaloriesInput(event) {
  const calories = event.currentTarget;
  const protein = document.getElementById("protein");
  let digits = calories.value.replace(/\D/g, "");

  if (digits.length > 4) digits = digits.slice(0, 4);
  if (digits !== calories.value) calories.value = digits;

  if (digits.length === 4 && protein && document.activeElement === calories) {
    protein.focus();
    protein.select();
  }
}

function handleProteinInput(event) {
  const protein = event.currentTarget;
  let digits = protein.value.replace(/\D/g, "");

  if (digits.length > 3) digits = digits.slice(0, 3);
  if (digits !== protein.value) protein.value = digits;

  if (digits.length === 3) {
    document.getElementById("today-form")?.requestSubmit();
  }
}

function handleTargetsSubmit(event) {
  event.preventDefault();

  const nextTdee = Number(document.getElementById("tdeeInput")?.value);
  const nextProteinTarget = Number(document.getElementById("proteinTargetInput")?.value);

  if (!Number.isFinite(nextTdee) || nextTdee <= 0) {
    setStatus("Invalid TDEE");
    return;
  }

  if (!Number.isFinite(nextProteinTarget) || nextProteinTarget <= 0) {
    setStatus("Invalid protein target");
    return;
  }

  setLoading(true);

  fetchJson(`${API_BASE}/api/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tdee: Math.round(nextTdee),
      proteinTarget: Math.round(nextProteinTarget),
      deficitTarget: Math.round(DEFICIT_TARGET),
      cutStartDate,
      activeCutPhase,
      cutPhaseDeficits: cutPhaseDeficits.map((value) => Math.round(value))
    })
  })
    .then((data) => {
      applyConfig(data.config);
      hideTargetsForm();
      return loadWeekSummary();
    })
    .catch((error) => {
      if (error.isAuthError) {
        setStatus("Locked");
        return;
      }

      setStatus("Could not save targets");
      alert(error.message || "Could not save targets");
    })
    .finally(() => {
      setLoading(false);
    });
}

// Drag a centered modal downward to dismiss it. The panel follows the finger
// (downward 1:1, upward with resistance), the backdrop fades proportionally,
// and releasing past the threshold closes it; otherwise it springs back.
function initSheetDragDismiss(panelId, handleSelector, closeFn, backdropId) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const handle = handleSelector ? panel.querySelector(handleSelector) : panel;
  if (!handle) return;
  const backdrop = backdropId ? document.getElementById(backdropId) : null;

  const DISMISS = 110;
  const FADE_RANGE = 320;
  let startY = 0;
  let startX = 0;
  let dragging = false;
  let decided = false;
  let dy = 0;
  let crossed = false;

  function setOffset(offset, animated) {
    panel.style.transition = animated
      ? "transform 260ms cubic-bezier(0.25, 1, 0.5, 1)"
      : "none";
    panel.style.transform = `translate(-50%, calc(-50% + ${offset}px))`;
    if (backdrop) {
      backdrop.style.transition = animated ? "opacity 220ms ease" : "none";
      const fade = Math.max(0, 1 - (Math.min(Math.max(offset, 0), FADE_RANGE) / FADE_RANGE) * 0.92);
      backdrop.style.opacity = String(fade);
    }
  }

  function reset() {
    panel.style.transition = "";
    panel.style.transform = "";
    if (backdrop) {
      backdrop.style.transition = "";
      backdrop.style.opacity = "";
    }
  }

  handle.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    if (e.target instanceof Element && e.target.closest("button, input, textarea, select, a")) {
      dragging = false;
      return;
    }
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    dragging = true;
    decided = false;
    dy = 0;
    crossed = false;
  }, { passive: true });

  handle.addEventListener("touchmove", (e) => {
    if (!dragging || e.touches.length !== 1) return;
    const ddy = e.touches[0].clientY - startY;
    const ddx = e.touches[0].clientX - startX;

    if (!decided) {
      if (Math.abs(ddx) > Math.abs(ddy) * 1.2 && Math.abs(ddx) > 8) { dragging = false; return; }
      if (Math.abs(ddy) > 6) decided = true;
      else return;
    }

    dy = ddy > 0 ? ddy : ddy * 0.2;
    e.preventDefault();
    setOffset(dy, false);

    if (dy >= DISMISS && !crossed) { crossed = true; triggerHaptic("tap"); }
    else if (dy < DISMISS && crossed) { crossed = false; }
  }, { passive: false });

  function end() {
    if (!dragging) return;
    dragging = false;

    if (decided && dy >= DISMISS) {
      setOffset(window.innerHeight, true);
      window.setTimeout(() => { reset(); closeFn(); }, 200);
    } else if (decided) {
      setOffset(0, true);
      window.setTimeout(reset, 280);
    }
  }

  handle.addEventListener("touchend", end, { passive: true });
  handle.addEventListener("touchcancel", end, { passive: true });
}

// Pull down from the top of the page to refresh the current day's summary.
function initPullToRefresh() {
  const TRIGGER = 64;
  const MAX = 96;
  let startY = 0;
  let startX = 0;
  let pulling = false;
  let decided = false;
  let dist = 0;
  let refreshing = false;
  let indicator = null;

  function overlayOpen() {
    return document.body.classList.contains("calendar-open") ||
      document.body.classList.contains("quick-entry-open") ||
      document.body.classList.contains("auth-locked") ||
      document.body.classList.contains("delete-confirm-open");
  }

  function ensureIndicator() {
    if (!indicator) {
      indicator = document.createElement("div");
      indicator.className = "ptr-indicator";
      indicator.innerHTML = '<span class="ptr-spinner" aria-hidden="true"></span>';
      document.body.appendChild(indicator);
    }
    return indicator;
  }

  function setPull(d) {
    const ind = ensureIndicator();
    ind.style.transition = "none";
    ind.style.transform = `translateX(-50%) translateY(${Math.min(d, MAX)}px)`;
    ind.style.opacity = String(Math.min(1, d / TRIGGER));
    ind.classList.toggle("ready", d >= TRIGGER);
  }

  function reset(animated) {
    const ind = ensureIndicator();
    ind.style.transition = animated ? "transform 240ms ease, opacity 240ms ease" : "none";
    ind.style.transform = "translateX(-50%) translateY(0)";
    ind.style.opacity = "0";
    ind.classList.remove("ready", "spinning");
  }

  document.addEventListener("touchstart", (e) => {
    if (refreshing || e.touches.length !== 1 || window.scrollY > 0 || overlayOpen()) { pulling = false; return; }
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    pulling = true;
    decided = false;
    dist = 0;
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    if (!pulling || refreshing || e.touches.length !== 1) return;
    if (overlayOpen()) { pulling = false; return; }

    const dy = e.touches[0].clientY - startY;
    const dx = e.touches[0].clientX - startX;

    if (!decided) {
      if (Math.abs(dx) > Math.abs(dy)) { pulling = false; return; }
      if (dy > 8) decided = true;
      else return;
    }

    if (dy <= 0 || window.scrollY > 0) { pulling = false; reset(false); return; }

    e.preventDefault();
    dist = dy * 0.5;
    setPull(dist);
  }, { passive: false });

  document.addEventListener("touchend", () => {
    if (!pulling) return;
    pulling = false;

    if (dist >= TRIGGER) {
      refreshing = true;
      const ind = ensureIndicator();
      ind.classList.add("spinning");
      ind.style.transition = "transform 200ms ease";
      ind.style.transform = `translateX(-50%) translateY(${TRIGGER}px)`;
      ind.style.opacity = "1";
      triggerHaptic("select");
      Promise.resolve(loadWeekSummary()).finally(() => {
        refreshing = false;
        reset(true);
      });
    } else {
      reset(true);
    }
  }, { passive: true });
}

function initApp() {
  document.getElementById("authUserTrigger")?.addEventListener("click", toggleAuthMenu);
  document.getElementById("signOutBtn")?.addEventListener("click", () => { closeAuthMenu(); signOut(); });
  document.getElementById("copyAllDataBtn")?.addEventListener("click", (e) => copyAllPhases(e.currentTarget));
  document.getElementById("today-form")?.addEventListener("submit", handleFormSubmit);
  document.getElementById("targets-form")?.addEventListener("submit", handleTargetsSubmit);
  document.getElementById("targetsEditBtn")?.addEventListener("click", showTargetsForm);
  document.getElementById("targetsCancelBtn")?.addEventListener("click", hideTargetsForm);
  document.getElementById("diet-day")?.addEventListener("click", openCalendar);
  document.getElementById("closeCalendarBtn")?.addEventListener("click", closeCalendar);
  document.getElementById("calendarBackdrop")?.addEventListener("click", closeCalendar);
  document.getElementById("jumpTodayBtn")?.addEventListener("click", () => {
    const todayString = getDietDate();
    if (currentDate !== todayString) setDietDay(todayString);
    closeCalendar({ haptic: false });
  });
  document.getElementById("calendarGrid")?.addEventListener("click", handleCalendarDayClick);
  document.getElementById("prevDayBtn")?.addEventListener("click", () => shiftDietDay(-1));
  document.getElementById("nextDayBtn")?.addEventListener("click", () => shiftDietDay(1));
  document.getElementById("weekly-summary")?.addEventListener("click", handleTrendDayClick);
  document.getElementById("weekly-summary")?.addEventListener("click", handleCopyWeeklySummaryClick);
  document.getElementById("daily-result")?.addEventListener("click", handleDailyMetricClick);
  document.getElementById("daily-result")?.addEventListener("click", handleCopyTodaySummaryClick);
  document.getElementById("deleteBtn")?.addEventListener("click", deleteEntry);
  document.getElementById("deleteConfirmBackdrop")?.addEventListener("click", closeDeleteConfirm);
  document.getElementById("cancelDeleteBtn")?.addEventListener("click", closeDeleteConfirm);
  document.getElementById("confirmDeleteBtn")?.addEventListener("click", confirmDeleteEntry);
  document.getElementById("cancelBtn")?.addEventListener("click", closeQuickEntry);
  // Close inline editor when clicking outside the editing card
  document.addEventListener("pointerdown", (e) => {
    if (!isQuickEntryOpen()) return;
    if (e.target.closest(".daily-card:not(.loading-card).is-editing")) return;
    closeQuickEntry();
  }, { passive: true });
  document.getElementById("calories")?.addEventListener("input", handleCaloriesInput);
  document.getElementById("protein")?.addEventListener("input", handleProteinInput);
  document.addEventListener("keydown", handleGlobalKeydown);
  initCarouselSwipe();
  initMonthlySwipe();
  initSheetDragDismiss("calendarPanel", ".calendar-header", () => closeCalendar({ haptic: false }), "calendarBackdrop");
  initSheetDragDismiss("deleteConfirmPanel", null, () => closeDeleteConfirm({ haptic: false }), "deleteConfirmBackdrop");
  initLongPressDelete();
  initPullToRefresh();

  window.matchMedia?.("(max-width: 620px)")?.addEventListener?.("change", (event) => {
    document.getElementById("today-form")?.classList.toggle("compact-entry-fields", event.matches);
    if (todayEntry || document.getElementById("daily-result")?.innerHTML) {
      loadWeekSummary();
    }
  });
  // Cut phases — clear legacy localStorage keys (migrated to Notion)
  ["calorieTrackerCutStartDate", "calorieTrackerActiveCutPhase", "calorieTrackerCutPhaseDeficits"]
    .forEach(key => localStorage.removeItem(key));

  updateCutPhaseUI();
  const cutStartDateInput = document.getElementById("cutStartDateInput");
  cutStartDateInput?.addEventListener("change", (e) => {
    e.target.hidden = true;
    handleCutStartDateChange(e);
  });
  document.getElementById("phasePeriodEditBtn")?.addEventListener("click", () => {
    const input = document.getElementById("cutStartDateInput");
    if (!input) return;
    input.hidden = false;
    try { input.showPicker(); } catch { input.focus(); }
  });
  document.getElementById("cutPhasesPanel")?.addEventListener("click", handleCutPhasePanelClick);
  document.getElementById("cutPhasesPanel")?.addEventListener("toggle", (e) => {
    if (e.newState === "open") track("open_program");
  });
  document.querySelector(".settings-panel:not(#cutPhasesPanel)")?.addEventListener("toggle", (e) => {
    if (e.newState === "open") track("open_settings");
  });
  CUT_PHASE_NAMES.forEach((_, i) => {
    document.getElementById(`cutPhaseDeficit${i}`)?.addEventListener("blur", (e) => handlePhaseDeficitBlur(i, e.target.value));
  });

  updateDietDayDisplay();
  updateTargetForm();
  setEntryFormVisible(false);
  renderInitialLoadingState();
  showAccessGate();
  setStatus("Locked");

  const redirectResult = consumeGoogleRedirect();
  if (redirectResult) {
    if (redirectResult.error) {
      showAccessGate(redirectResult.error);
      enableSignInButton();
    } else {
      completeGoogleSignIn({ credential: redirectResult.credential });
    }
    return;
  }

  restoreSession()
    .then((ok) => {
      if (ok) { setStatus(""); return; }
      // Fresh visit: auto-redirect to Google.
      // If OAUTH_STATE_KEY is still in sessionStorage, the user previously
      // hit Back from Google's account picker — show the button instead.
      if (GOOGLE_CLIENT_ID && !sessionStorage.getItem(OAUTH_STATE_KEY)) {
        startGoogleRedirect();
      } else {
        enableSignInButton();
      }
    })
    .catch((error) => {
      setStatus("Locked");
      showAccessGate(error.message || "Could not start sign-in");
      enableSignInButton();
    });
}

document.addEventListener("DOMContentLoaded", initApp);
