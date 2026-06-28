let TDEE = 2705;
let PROTEIN_TARGET = 180;
let DEFICIT_TARGET = 500;
const API_BASE = (() => {
  if (typeof window === "undefined") return "https://calorie-tracker-omega-ten.vercel.app";
  const { hostname, origin } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return origin;
  return "https://calorie-tracker-omega-ten.vercel.app";
})();
let authUser = null;
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
let celebrationTimer = null;
let calendarVisibleMonth = null;
let calendarHistoryMonths = CALENDAR_INITIAL_HISTORY_MONTHS;
let calendarIsExtending = false;
let latestWeekSummary = null;
let viewportResizeHandler = null;
let quickEntryScrollY = 0;
let daySwipeState = null;
let suppressNextSwipeClick = false;

const DAY_SWIPE_AXIS_THRESHOLD = 10;
const DAY_SWIPE_TRIGGER_DISTANCE = 56;
const DAY_SWIPE_MAX_VERTICAL_DRIFT = 80;

const HAPTIC_PATTERNS = {
  tap: 8,
  select: 12,
  success: [18, 30, 18],
  warning: [28, 40, 28],
  error: [50, 40, 50]
};

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
  const isAtDietToday = currentDate === getDietDate();

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
}

function formatDailyIntakeTargetSummary() {
  const calorieTarget = Math.max(0, roundInt(TDEE - DEFICIT_TARGET));
  return `${formatInt(calorieTarget)} kcal · ${formatInt(PROTEIN_TARGET)} g`;
}

function updateTargetForm() {
  const tdeeInput = document.getElementById("tdeeInput");
  const proteinInput = document.getElementById("proteinTargetInput");
  const deficitInput = document.getElementById("deficitTargetInput");
  const summary = document.getElementById("targetSummary");

  if (tdeeInput) tdeeInput.value = roundInt(TDEE);
  if (proteinInput) proteinInput.value = roundInt(PROTEIN_TARGET);
  if (deficitInput) deficitInput.value = roundInt(DEFICIT_TARGET);
  if (summary) {
    summary.textContent = formatDailyIntakeTargetSummary();
    summary.title = `TDEE ${formatInt(TDEE)} kcal · deficit ${formatInt(DEFICIT_TARGET)} kcal`;
  }
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

function getCutPhaseLabel(dateString = getDietDate()) {
  if (activeCutPhase === null) return null;
  const name = CUT_PHASE_NAMES[activeCutPhase];
  const week = getCutWeek(dateString);
  return week ? `${name} · Week ${week}` : name;
}

function getCutPhaseSnapshot(dateString) {
  const cutWeek = activeCutPhase === null ? null : getCutWeek(dateString);

  return {
    cutStartDate,
    cutPhaseIndex: activeCutPhase,
    cutPhaseName: activeCutPhase === null ? null : CUT_PHASE_NAMES[activeCutPhase],
    cutWeek,
    deficitTarget: DEFICIT_TARGET
  };
}

function updateCutPhaseUI() {
  const startInput = document.getElementById("cutStartDateInput");
  if (startInput) startInput.value = cutStartDate || "";

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

  const summary = document.getElementById("cutPhaseSummary");
  if (summary) summary.textContent = activeCutPhase !== null ? CUT_PHASE_NAMES[activeCutPhase] : "";
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
  const form = document.getElementById("today-form");
  if (!form) return;
  const isQuickEntryOverlayOpen = isQuickEntryOpen();
  const showInline = isVisible && isQuickEntryOverlayOpen;

  if (!isQuickEntryOverlayOpen) {
    form.classList.remove("quick-entry");
  }

  form.classList.toggle("entry-form-collapsed", !showInline);
  form.setAttribute("aria-hidden", String(!showInline));
  form.inert = !showInline;
  form.hidden = !showInline;

  form.querySelectorAll(".input-card, #saveBtn").forEach((element) => {
    element.hidden = false;
  });

  const deleteBtn = document.getElementById("deleteBtn");
  if (deleteBtn) {
    deleteBtn.hidden = !todayEntry;
  }
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

function lockQuickEntryScroll() {
  quickEntryScrollY = window.scrollY || document.documentElement.scrollTop || 0;
  document.body.style.position = "fixed";
  document.body.style.top = `-${quickEntryScrollY}px`;
  document.body.style.left = "0";
  document.body.style.right = "0";
  document.body.style.width = "100%";
}

function unlockQuickEntryScroll() {
  const scrollY = quickEntryScrollY || 0;
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.left = "";
  document.body.style.right = "";
  document.body.style.width = "";
  window.scrollTo(0, scrollY);
  quickEntryScrollY = 0;
}

function isCompactQuickEntry() {
  return window.matchMedia?.("(max-width: 620px)")?.matches ?? false;
}

function clearQuickEntryPosition(form) {
  if (!form) return;
  form.style.top = "";
  form.style.bottom = "";
  form.style.left = "";
  form.style.transform = "";
  form.style.maxHeight = "";
  form.style.overflowY = "";
}

// Mobile: bottom sheet flush above the keyboard. Desktop: centred modal via CSS.
function adjustQuickEntryForKeyboard() {
  const form = document.getElementById("today-form");
  if (!form || !isQuickEntryOpen()) return;

  if (!isCompactQuickEntry()) {
    clearQuickEntryPosition(form);
    document.body.classList.remove("quick-entry-keyboard");
    return;
  }

  const vv = window.visualViewport;
  const edgeGap = 8;

  form.style.left = "50%";
  form.style.transform = "translateX(-50%)";
  form.style.overflowY = "auto";

  if (!vv) {
    form.style.top = "auto";
    form.style.bottom = `${edgeGap}px`;
    form.style.maxHeight = `calc(100dvh - ${edgeGap * 2}px)`;
    return;
  }

  const visibleBottom = vv.offsetTop + vv.height;
  const keyboardInset = Math.max(0, window.innerHeight - visibleBottom);
  const isKeyboardOpen = keyboardInset > 50;

  document.body.classList.toggle("quick-entry-keyboard", isKeyboardOpen);

  // Bottom edge of the sheet aligns with the top of the keyboard (visible viewport bottom).
  form.style.top = "auto";
  form.style.bottom = `${Math.round(isKeyboardOpen ? keyboardInset + edgeGap : edgeGap)}px`;
  form.style.maxHeight = `${Math.round(Math.max(180, vv.height - edgeGap * 2))}px`;
}

function openQuickEntry(focusField = "calories") {
  triggerHaptic("tap");

  const form = document.getElementById("today-form");
  if (form) form.hidden = false;
  const backdrop = document.getElementById("quickEntryBackdrop");
  const calories = document.getElementById("calories");
  const protein = document.getElementById("protein");

  if (!form || !calories || !protein) return;

  if (!isQuickEntryOpen()) {
    lockQuickEntryScroll();
  }

  form.classList.remove("entry-form-collapsed");
  form.setAttribute("aria-hidden", "false");
  form.inert = false;
  form.classList.add("quick-entry");
  form.classList.toggle("compact-entry-fields", window.matchMedia?.("(max-width: 620px)")?.matches ?? false);
  document.body.classList.add("quick-entry-open");
  if (backdrop) backdrop.hidden = false;

  if (!todayEntry) {
    calories.value = "";
    protein.value = "";
  }

  const focusTarget = focusField === "protein" ? protein : calories;

  [calories, protein].forEach((input) => {
    input.type = "number";
    input.inputMode = "numeric";
    input.autocomplete = "off";
    input.removeAttribute("readonly");
    input.removeAttribute("disabled");
  });

  form.removeEventListener("pointerdown", handleQuickEntryPointerFocus);
  form.addEventListener("pointerdown", handleQuickEntryPointerFocus, { passive: true });
  if (window.__quickEntryUserGesture === true) {
    forceQuickEntryFocus(focusTarget);
  } else {
    adjustQuickEntryForKeyboard();
  }

  teardownQuickEntryViewportListeners();
  if (window.visualViewport) {
    viewportResizeHandler = adjustQuickEntryForKeyboard;
    window.visualViewport.addEventListener("resize", viewportResizeHandler);
    window.visualViewport.addEventListener("scroll", viewportResizeHandler);
  }
  window.addEventListener("resize", adjustQuickEntryForKeyboard);
  adjustQuickEntryForKeyboard();
  requestAnimationFrame(adjustQuickEntryForKeyboard);
}

function teardownQuickEntryViewportListeners() {
  if (window.visualViewport && viewportResizeHandler) {
    window.visualViewport.removeEventListener("resize", viewportResizeHandler);
    window.visualViewport.removeEventListener("scroll", viewportResizeHandler);
    viewportResizeHandler = null;
  }
  window.removeEventListener("resize", adjustQuickEntryForKeyboard);
}

function forceQuickEntryFocus(input) {
  if (!input) return;

  const focus = () => {
    if (!isQuickEntryOpen()) return;
    input.focus();
    input.select?.();
    adjustQuickEntryForKeyboard();
    requestAnimationFrame(() => adjustQuickEntryForKeyboard());
  };

  focus();
  requestAnimationFrame(focus);
  setTimeout(focus, 60);
  setTimeout(focus, 180);
  setTimeout(focus, 360);
}

function handleQuickEntryPointerFocus(event) {
  if (!isQuickEntryOpen()) return;
  if (event.target.closest("button")) return;

  const calories = document.getElementById("calories");
  const protein = document.getElementById("protein");
  const tappedInput = event.target.matches("input") ? event.target : null;
  const focusTarget = tappedInput || (document.activeElement === protein ? protein : calories);

  focusTarget?.focus();
  focusTarget?.select?.();
  adjustQuickEntryForKeyboard();
  requestAnimationFrame(() => adjustQuickEntryForKeyboard());
}

function closeQuickEntry(options = {}) {
  if (options.haptic !== false) triggerHaptic("tap");

  const form = document.getElementById("today-form");

  teardownQuickEntryViewportListeners();
  if (form) {
    clearQuickEntryPosition(form);
    form.removeEventListener("pointerdown", handleQuickEntryPointerFocus);
  }
  document.body.classList.remove("quick-entry-keyboard");

  setEntryFormVisible(false);
  const backdrop = document.getElementById("quickEntryBackdrop");

  if (form) {
    form.classList.remove("quick-entry");
    form.classList.toggle("compact-entry-fields", window.matchMedia?.("(max-width: 620px)")?.matches ?? false);
  }
  document.body.classList.remove("quick-entry-open");
  unlockQuickEntryScroll();
  if (backdrop) backdrop.hidden = true;
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
  if (text) text.textContent = isDoubleHit ? "Deficit and protein cleared." : "Saved.";

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

  // If the selected date is before our start, extend back to include it
  const selectedAnchor = new Date(`${currentDate}T12:00:00`);
  if (selectedAnchor < startDate) {
    const selOffset = (selectedAnchor.getDay() + 6) % 7;
    startDate.setTime(selectedAnchor.getTime());
    startDate.setDate(selectedAnchor.getDate() - selOffset);
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
      ${isFuture ? "disabled" : ""}
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

function setDietDay(date) {
  if (!isValidDateString(date) || isFutureDate(date)) return;
  if (date === currentDate) return;

  currentDate = date;
  foldSettingsPanels();
  calendarVisibleMonth = date.slice(0, 7);
  todayLogged = false;
  todayEntry = null;

  updateDietDayDisplay();
  updateTargetForm();
  hideEntryFormWhileLoading();

  document.querySelectorAll('[data-unit="protein"]').forEach((el) => {
    el.textContent = "g";
  });

  renderInitialLoadingState();
  loadWeekSummary();
}

function shiftDietDay(days) {
  const d = new Date(`${currentDate}T12:00:00`);
  d.setDate(d.getDate() + days);

  if (d > new Date(`${getDietDate()}T12:00:00`)) return;

  triggerHaptic("select");
  setDietDay(formatDate(d));
}

function isDaySwipeBlocked() {
  return document.body.classList.contains("calendar-open")
    || document.body.classList.contains("quick-entry-open")
    || document.body.classList.contains("auth-locked")
    || document.body.classList.contains("delete-confirm-open");
}

function handleDaySwipeStart(event) {
  if (isDaySwipeBlocked() || event.touches.length !== 1) {
    daySwipeState = null;
    return;
  }

  const touch = event.touches[0];
  daySwipeState = {
    startX: touch.clientX,
    startY: touch.clientY,
    lastX: touch.clientX,
    lastY: touch.clientY,
    axis: null
  };
}

function handleDaySwipeMove(event) {
  if (!daySwipeState || event.touches.length !== 1) return;

  const touch = event.touches[0];
  const dx = touch.clientX - daySwipeState.startX;
  const dy = touch.clientY - daySwipeState.startY;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  daySwipeState.lastX = touch.clientX;
  daySwipeState.lastY = touch.clientY;

  if (!daySwipeState.axis && Math.max(absX, absY) >= DAY_SWIPE_AXIS_THRESHOLD) {
    daySwipeState.axis = absX > absY * 1.35 ? "x" : "y";
    document.body.classList.toggle("day-swipe-lock", daySwipeState.axis === "x");
  }

  if (daySwipeState.axis === "x") {
    event.preventDefault();
  }
}

function handleDaySwipeEnd() {
  if (!daySwipeState) return;

  const dx = daySwipeState.lastX - daySwipeState.startX;
  const dy = daySwipeState.lastY - daySwipeState.startY;
  const isHorizontalSwipe = daySwipeState.axis === "x"
    && Math.abs(dx) >= DAY_SWIPE_TRIGGER_DISTANCE
    && Math.abs(dy) <= DAY_SWIPE_MAX_VERTICAL_DRIFT;

  document.body.classList.remove("day-swipe-lock");
  daySwipeState = null;

  if (!isHorizontalSwipe || isDaySwipeBlocked()) return;

  suppressNextSwipeClick = true;
  window.setTimeout(() => {
    suppressNextSwipeClick = false;
  }, 0);
  shiftDietDay(dx < 0 ? 1 : -1);
}

function handleDaySwipeCancel() {
  daySwipeState = null;
  document.body.classList.remove("day-swipe-lock");
}

function handleDaySwipeClick(event) {
  if (!suppressNextSwipeClick) return;

  event.preventDefault();
  event.stopPropagation();
  suppressNextSwipeClick = false;
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
      await setupGoogleSignIn();
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

function updateAuthUI() {
  const bar = document.getElementById("authUserBar");
  const label = document.getElementById("authUserLabel");
  const avatar = document.getElementById("authUserAvatar");

  if (!bar || !label) return;

  if (!authUser) {
    bar.hidden = true;
    if (avatar) avatar.hidden = true;
    return;
  }

  bar.hidden = false;
  label.textContent = authUser.name || authUser.email;

  if (avatar && authUser.picture) {
    avatar.src = authUser.picture;
    avatar.alt = authUser.name || authUser.email;
    avatar.hidden = false;
  } else if (avatar) {
    avatar.hidden = true;
  }
}

let googleTokenClient = null;

async function setupGoogleSignIn() {
  const configRes = await fetch(`${API_BASE}/api/auth/config`, { credentials: "include" });
  const configData = await configRes.json().catch(() => ({}));

  if (!configRes.ok || !configData.googleClientId) {
    throw new Error("Google sign-in is not configured on the server");
  }

  const signInBtn = document.getElementById("googleSignInBtn");
  if (signInBtn) signInBtn.disabled = true;

  await new Promise((resolve, reject) => {
    const start = () => {
      if (!window.google?.accounts?.oauth2?.initTokenClient) {
        window.setTimeout(start, 40);
        return;
      }

      googleTokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: configData.googleClientId,
        scope: "openid email profile",
        callback: (tokenResponse) => {
          if (tokenResponse.error) {
            setStatus("Locked");
            showAccessGate(tokenResponse.error);
            return;
          }

          completeGoogleSignIn({ accessToken: tokenResponse.access_token });
        }
      });

      if (signInBtn) {
        signInBtn.disabled = false;
        signInBtn.onclick = () => {
          googleTokenClient?.requestAccessToken({ prompt: "select_account" });
        };
      }

      resolve();
    };

    start();
  });
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
  showAccessGate();
  setStatus("Locked");
  await setupGoogleSignIn().catch(() => {
    showAccessGate("Could not load Google sign-in");
  });
}

async function loadConfig() {
  const data = await fetchJson(`${API_BASE}/api/config`);
  applyConfig(data.config);
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
    const didDoubleHit = savedDeficit >= savedDeficitTarget && roundedProtein >= PROTEIN_TARGET;
    closeQuickEntry({ haptic: false });
    await loadWeekSummary();
    triggerHaptic("success");
    triggerSaveReward();
    if (didDoubleHit || shouldCelebrateTodayCommit) {
      showCelebration({ variant: didDoubleHit ? "double-hit" : "logged" });
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
        <div class="skel" style="width:48px;height:20px;border-radius:5px"></div>
        <div class="skel" style="width:58px;height:22px;border-radius:100px"></div>
      </div>
      <div class="daily-metrics">
        <div class="skel" style="height:76px;border-radius:12px"></div>
        <div class="skel" style="height:76px;border-radius:12px"></div>
      </div>
      <div class="skel-settlement">
        <div class="skel-line">
          <div class="skel-line-top">
            <div class="skel" style="width:64px;height:13px;border-radius:4px"></div>
            <div class="skel" style="width:88px;height:13px;border-radius:4px"></div>
          </div>
          <div class="skel" style="height:9px;border-radius:999px"></div>
        </div>
        <div class="skel-line">
          <div class="skel-line-top">
            <div class="skel" style="width:52px;height:13px;border-radius:4px"></div>
            <div class="skel" style="width:72px;height:13px;border-radius:4px"></div>
          </div>
          <div class="skel" style="height:9px;border-radius:999px"></div>
        </div>
      </div>
    </section>
  `;
}

function weekSkeletonHtml() {
  return `
    <section class="card week-card loading-card">
      <div class="card-header">
        <div class="skel" style="width:80px;height:20px;border-radius:5px"></div>
        <div style="display:flex;gap:8px;align-items:center">
          <div class="skel" style="width:32px;height:28px;border-radius:8px"></div>
          <div class="skel" style="width:52px;height:22px;border-radius:100px"></div>
        </div>
      </div>
      <div class="week-snapshot">
        <div class="skel" style="height:74px;border-radius:10px"></div>
        <div class="skel" style="height:74px;border-radius:10px"></div>
        <div class="skel" style="height:74px;border-radius:10px"></div>
      </div>
      <div class="week-trend-panel">
        <div class="week-trend-header">
          <div class="skel" style="width:76px;height:12px;border-radius:4px"></div>
          <div class="skel" style="width:64px;height:12px;border-radius:4px"></div>
        </div>
        <div class="skel-trend-bars">
          <div class="skel" style="height:72px;border-radius:6px 6px 3px 3px"></div>
          <div class="skel" style="height:52px;border-radius:6px 6px 3px 3px"></div>
          <div class="skel" style="height:86px;border-radius:6px 6px 3px 3px"></div>
          <div class="skel" style="height:62px;border-radius:6px 6px 3px 3px"></div>
          <div class="skel" style="height:78px;border-radius:6px 6px 3px 3px"></div>
          <div class="skel" style="height:44px;border-radius:6px 6px 3px 3px"></div>
          <div class="skel" style="height:94px;border-radius:6px 6px 3px 3px"></div>
        </div>
      </div>
    </section>
  `;
}

function renderInitialLoadingState() {
  const daily = document.getElementById("daily-result");
  const weekly = document.getElementById("weekly-summary");
  if (daily) daily.innerHTML = dailySkeletonHtml();
  if (weekly) weekly.innerHTML = weekSkeletonHtml();
}

function getCopySummaryButtonHtml(disabled = false) {
  return `
    <button
      class="copy-summary-btn"
      type="button"
      data-copy-week-summary
      aria-label="Copy weekly summary"
      title="Copy weekly summary"
      ${disabled ? "disabled" : ""}
    >
      <span class="copy-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor" focusable="false">
          <rect x="9" y="3" width="10" height="13" rx="2.5" opacity="0.5"/>
          <rect x="5" y="8" width="10" height="13" rx="2.5"/>
        </svg>
      </span>
      <span class="check-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" focusable="false">
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

  setLoading(true);
  closeDeleteConfirm({ haptic: false });

  try {
    await fetchJson(`${API_BASE}/api/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: currentDate })
    });

    todayLogged = false;
    todayEntry = null;
    forgetLoggedDate(currentDate);
    updateEntryForm();
    await loadWeekSummary();
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
  const deficitTolerance = roundedDeficitTarget * 0.1;
  const exceeded = !isSurplus && deficit >= Math.max(roundedDeficitTarget - deficitTolerance, 0);
  const isPerfect = !isSurplus && deficit === roundedDeficitTarget;

  return {
    deficit,
    surplus,
    isSurplus,
    isPerfect,
    progress: isSurplus ? 100 : exceeded ? 100 : getProgressPercent(deficit, roundedDeficitTarget),
    celebrated: exceeded,
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
    ? `Targets: TDEE/cal/protein ${uniqueTargets[0]}`
    : "Targets: vary by day";
  const lines = [
    `Calorie tracker context (${range})`,
    targetLine,
    `Week: ${summary.count || 0}/7 days, ${summary.consistency || getConsistency(entries)}`,
    `Avg: ${formatInt(summary.averageCalories || 0)} kcal, ${formatInt(summary.averageProtein || 0)}g protein`,
    `Total: ${formatInt(summary.totalDeficit || 0)} kcal deficit, est fat ${formatFatLossKg(summary.fatLossKg || 0)} kg`,
    "",
    "Daily: date | kcal | protein | deficit"
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
      ? ` | target ${formatInt(calorieTarget)} kcal/${formatInt(proteinTarget)}g`
      : "";

    lines.push(
      `${formatPlainDateLabel(entry.date)} | ${formatInt(entry.calories)} | ${formatInt(entry.protein)}g | ${deficitText}${targetsText}`
    );
  });

  return lines.join("\n");
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    const copied = document.execCommand("copy");
    if (!copied) throw new Error("Copy command failed");
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
  const { calorieResult, entryCalorieTarget, entryDeficitTarget, entryProteinTarget } = trendDay;
  const calorieText = `${formatInt(trendDay.entry.calories)} / ${formatInt(entryCalorieTarget)} kcal`;
  const deficitText = calorieResult.isSurplus
    ? `+${formatInt(calorieResult.surplus)} kcal surplus`
    : `${formatInt(calorieResult.deficit)} / ${formatInt(entryDeficitTarget)} kcal deficit`;
  return `${calorieText}, ${deficitText}, ${formatInt(trendDay.entry.protein)} / ${formatInt(entryProteinTarget)} g protein`;
}

const TREND_BAR_TRACK_HEIGHT = 96;
const TREND_BAR_MIN_HEIGHT = 10;
// Placeholder silhouette: left (calories) lower, right (protein) higher - matches typical logged days.
const TREND_BAR_MISSING_KCAL_RATIO = 0.28;
const TREND_BAR_MISSING_PROTEIN_RATIO = 0.38;

function getMissingTrendBarHeights() {
  return {
    kcalHeight: Math.max(TREND_BAR_MIN_HEIGHT, Math.round(TREND_BAR_TRACK_HEIGHT * TREND_BAR_MISSING_KCAL_RATIO)),
    proteinHeight: Math.max(TREND_BAR_MIN_HEIGHT, Math.round(TREND_BAR_TRACK_HEIGHT * TREND_BAR_MISSING_PROTEIN_RATIO))
  };
}

function progressToTrendBarHeight(progress) {
  const clamped = Math.max(0, Math.min(100, roundInt(progress)));
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
      proteinHeight,
      kcalState: "missing",
      proteinState: "missing"
    };
  }

  const { entryTdee, entryCalorieTarget, entryDeficitTarget, entryProteinTarget } = getEntryTargets(entry);
  const calorieResult = getCalorieResult(entry.calories, entryTdee, entryDeficitTarget);
  const proteinResult = getProteinResult(entry.protein, entryProteinTarget);
  const calorieProgress = getProgressPercent(entry.calories, entryCalorieTarget);

  return {
    entry,
    calorieResult,
    proteinResult,
    entryCalorieTarget,
    entryDeficitTarget,
    entryProteinTarget,
    kcalHeight: progressToTrendBarHeight(calorieProgress),
    proteinHeight: progressToTrendBarHeight(proteinResult.progress),
    kcalState: calorieResult.isSurplus ? "surplus" : entry.calories <= entryCalorieTarget ? "celebrated" : "neutral",
    proteinState: proteinResult.celebrated ? "celebrated" : "neutral"
  };
}

function renderTrendLegend() {
  return `
    <div class="trend-legend" aria-hidden="true">
      <span class="trend-legend-item"><span class="trend-legend-swatch trend-legend-swatch-kcal"></span>calories</span>
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

  return `
    <div class="trend-bars" aria-label="Weekly progress trend">
      ${days
        .map((date) => {
          const dateString = formatDate(date);
          const entry = entryByDate.get(dateString);
          const isMissing = !entry;
          const trendDay = getTrendDayMetrics(entry);
          const { kcalHeight, proteinHeight, kcalState, proteinState } = trendDay;
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
              data-date="${dateString}"
              aria-label="Select ${weekday}, ${shortDate}. ${valueLabel}"
              ${isFuture ? "disabled" : ""}
              ${isSelected ? "aria-current=\"date\"" : ""}
            >
              <span class="trend-value">${formatTrendDayValueHtml(trendDay)}</span>
              <div class="trend-bar-pair" title="${barTitle}">
                <div class="trend-bar-slot">
                  <div class="trend-bar trend-bar-kcal ${kcalState}" style="height:${kcalHeight}px"></div>
                </div>
                <div class="trend-bar-slot">
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

  try {
    button.disabled = true;
    button.classList.remove("copied");
    button.classList.add("copying");
    await copyTextToClipboard(buildWeeklyPlainTextSummary(latestWeekSummary));
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

function handleDailyMetricClick(event) {
  const metric = event.target.closest("[data-edit-field]");
  if (!metric) return;

  const field = metric.dataset.editField;
  if (field !== "calories" && field !== "protein") return;

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
  const weeklyPillText = loggedDays >= 7 ? "Full week" : `${loggedDays} ${loggedDays === 1 ? "day" : "days"}`;
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
    const deficitOverTarget = Math.max(roundInt(calorieResult.deficit - entryDeficitTarget), 0);
    const proteinOverTarget = Math.max(roundInt(roundedProtein - entryProteinTarget), 0);
    // "Perfect" = landed exactly on the target (not a surplus, not over, but deficit/protein == target)
    const caloriePerfect = !calorieResult.isSurplus && deficitOverTarget === 0 && roundInt(calorieResult.deficit) === roundInt(entryDeficitTarget);
    const proteinPerfect = proteinOverTarget === 0 && roundedProtein === entryProteinTarget;
    const doubleHit = (deficitOverTarget > 0 || caloriePerfect) && (proteinOverTarget > 0 || proteinPerfect);
    const statusPillText = doubleHit ? "Double hit" : "Logged";
    // Reward tone: calories and protein cards — deficit card is always plain
    const calorieMetricTone = calorieResult.isSurplus ? "caution" : (deficitOverTarget > 0 || caloriePerfect) ? "rewarded" : calorieResult.celebrated ? "on-track" : "";
    const proteinMetricTone = (proteinOverTarget > 0 || proteinPerfect) ? "rewarded" : proteinResult.celebrated ? "on-track" : "";
    const calorieAlmostThere = calorieResult.celebrated && !calorieResult.isSurplus && deficitOverTarget === 0 && !caloriePerfect;
    const proteinAlmostThere = proteinResult.celebrated && roundedProtein < entryProteinTarget;
    // Logged day: compact offset copy; surplus still uses TDEE surplus, not intake delta.
    const calorieMetricText = calorieResult.isSurplus
      ? formatCalorieSurplusNote(calorieResult.surplus)
      : caloriePerfect
        ? METRIC_NOTE_PERFECT
        : formatMetricOffset(roundedCalories - entryCalorieTarget, "kcal");
    const proteinMetricText = proteinPerfect
      ? METRIC_NOTE_PERFECT
      : formatMetricOffset(roundedProtein - entryProteinTarget, "g");

    dailyHtml = `
      <section class="daily-card ${calorieResult.tone} ${doubleHit ? "double-hit" : ""}">
        <div class="daily-card-top">
          <h2 class="daily-card-heading">${dailyHeadingText}</h2>
          <span class="status-pill ${doubleHit ? "double-hit" : "logged"}">${statusPillText}</span>
        </div>

        <div class="daily-metrics">
          <button class="daily-metric metric-button ${calorieMetricTone}" type="button" data-edit-field="calories" aria-label="Edit calories">
            <span class="metric-label">Calories</span>
            <strong>${formatInt(roundedCalories)} <small>kcal</small></strong>
            <span class="metric-note ${deficitOverTarget > 0 || caloriePerfect || calorieAlmostThere ? "reward" : calorieResult.isSurplus ? "negative" : ""}">${calorieMetricText}</span>
          </button>
          <button class="daily-metric metric-button ${proteinMetricTone}" type="button" data-edit-field="protein" aria-label="Edit protein">
            <span class="metric-label">Protein</span>
            <strong>${formatInt(roundedProtein)} <small>g</small></strong>
            <span class="metric-note ${proteinOverTarget > 0 || proteinPerfect || proteinAlmostThere ? "reward" : ""}">${proteinMetricText}</span>
          </button>
        </div>

        <div class="settlement-lines">
          <div class="settlement-line ${calorieResult.isSurplus ? "surplus" : calorieResult.celebrated ? "celebrated" : "neutral"}">
            <div class="settlement-line-top">
              <strong>${calorieResult.status}</strong>
              <span class="settlement-progress-value">${calorieResult.isSurplus
                ? `+${formatInt(calorieResult.surplus)} kcal`
                : `${formatInt(calorieResult.deficit)} / ${formatInt(entryDeficitTarget)} kcal`}</span>
            </div>
            <div class="settlement-track-row">
              <div class="settlement-track" aria-hidden="true">
                <span style="width:${calorieResult.progress}%"></span>
              </div>
            </div>
          </div>
          <div class="settlement-line ${proteinResult.celebrated ? "celebrated" : "neutral"}">
            <div class="settlement-line-top">
              <strong>${proteinResult.status}</strong>
              <span class="settlement-progress-value">${formatInt(roundedProtein)} / ${formatInt(entryProteinTarget)} g</span>
            </div>
            <div class="settlement-track-row">
              <div class="settlement-track" aria-hidden="true">
                <span style="width:${proteinResult.progress}%"></span>
              </div>
            </div>
          </div>
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
          <button class="daily-metric metric-button metric-add" type="button" data-edit-field="calories" aria-label="Add calories, tap to enter">
            <span class="metric-label">Calories</span>
            ${renderMetricAddPrompt()}
            <span class="metric-add-target">${isCompactLayout ? `Target ${formatInt(Math.max(0, TDEE - DEFICIT_TARGET))}` : `Target ${formatInt(Math.max(0, TDEE - DEFICIT_TARGET))} kcal`}</span>
          </button>
          <button class="daily-metric metric-button metric-add" type="button" data-edit-field="protein" aria-label="Add protein, tap to enter">
            <span class="metric-label">Protein</span>
            ${renderMetricAddPrompt()}
            <span class="metric-add-target">${isCompactLayout ? `Target ${formatInt(PROTEIN_TARGET)} g` : `Target ${formatInt(PROTEIN_TARGET)} g`}</span>
          </button>
        </div>
        <p class="empty-state">Tap Calories or Protein to log ${currentDate === getDietDate() ? "today" : "this day"}.</p>
      </section>
    `;
  }

  const cutLabel = getCutPhaseLabel(currentDate);
  const isCurrentWeek = (() => {
    const ws = getWeekStart(getDietDate());
    const wsCurrent = getWeekStart(currentDate);
    return formatDate(ws) === formatDate(wsCurrent);
  })();
  const weekHeading = isCurrentWeek ? "This Week" : weekRangeText;
  const weekHtml = `
    <section class="card week-card">
      <div class="card-header">
        <div class="card-header-left">
          <h2>${weekHeading}</h2>
          ${cutLabel ? `<p class="cut-phase-label">${cutLabel}</p>` : ""}
        </div>
        <div class="card-actions">
          ${getCopySummaryButtonHtml()}
          <span class="status-pill logged">${weeklyPillText}</span>
        </div>
      </div>
      <div class="week-snapshot">
        <div class="metric">
          <span class="metric-label">Avg calories</span>
          <span class="metric-value">${formatInt(summary.averageCalories || 0)} <small>kcal</small></span>
        </div>
        <div class="metric">
          <span class="metric-label">Avg protein</span>
          <span class="metric-value">${formatInt(summary.averageProtein || 0)} <small>g</small></span>
        </div>
        <div class="metric">
          <span class="metric-label">Fat loss</span>
          <span class="metric-value">${formatFatLossKg(summary.fatLossKg || 0)} <small>kg</small></span>
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
    } else {
      forgetLoggedDate(currentDate);
    }

    updateEntryForm();
    renderSummary(data.summary);
    setSummaryRefreshing(false);
    setStatus("");
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
  const nextDeficitTarget = Number(document.getElementById("deficitTargetInput")?.value);

  if (!Number.isFinite(nextTdee) || nextTdee <= 0) {
    setStatus("Invalid TDEE");
    return;
  }

  if (!Number.isFinite(nextProteinTarget) || nextProteinTarget <= 0) {
    setStatus("Invalid protein target");
    return;
  }

  if (!Number.isFinite(nextDeficitTarget) || nextDeficitTarget < 0) {
    setStatus("Invalid deficit target");
    return;
  }

  setLoading(true);

  fetchJson(`${API_BASE}/api/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tdee: Math.round(nextTdee),
      proteinTarget: Math.round(nextProteinTarget),
      deficitTarget: Math.round(nextDeficitTarget),
      cutStartDate,
      activeCutPhase,
      cutPhaseDeficits: cutPhaseDeficits.map((value) => Math.round(value))
    })
  })
    .then((data) => {
      applyConfig(data.config);
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

function initApp() {
  const appShell = document.querySelector(".app-shell");

  document.getElementById("signOutBtn")?.addEventListener("click", signOut);
  document.getElementById("today-form")?.addEventListener("submit", handleFormSubmit);
  document.getElementById("targets-form")?.addEventListener("submit", handleTargetsSubmit);
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
  document.getElementById("deleteBtn")?.addEventListener("click", deleteEntry);
  document.getElementById("deleteConfirmBackdrop")?.addEventListener("click", closeDeleteConfirm);
  document.getElementById("cancelDeleteBtn")?.addEventListener("click", closeDeleteConfirm);
  document.getElementById("confirmDeleteBtn")?.addEventListener("click", confirmDeleteEntry);
  document.getElementById("closeQuickEntryBtn")?.addEventListener("click", closeQuickEntry);
  document.getElementById("quickEntryBackdrop")?.addEventListener("click", closeQuickEntry);
  document.getElementById("calories")?.addEventListener("input", handleCaloriesInput);
  document.getElementById("protein")?.addEventListener("input", handleProteinInput);
  document.addEventListener("keydown", handleGlobalKeydown);
  appShell?.addEventListener("touchstart", handleDaySwipeStart, { passive: true });
  appShell?.addEventListener("touchmove", handleDaySwipeMove, { passive: false });
  appShell?.addEventListener("touchend", handleDaySwipeEnd, { passive: true });
  appShell?.addEventListener("touchcancel", handleDaySwipeCancel, { passive: true });
  appShell?.addEventListener("click", handleDaySwipeClick, true);

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
  document.getElementById("cutStartDateInput")?.addEventListener("change", handleCutStartDateChange);
  document.getElementById("cutPhasesPanel")?.addEventListener("click", handleCutPhasePanelClick);
  CUT_PHASE_NAMES.forEach((_, i) => {
    document.getElementById(`cutPhaseDeficit${i}`)?.addEventListener("blur", (e) => handlePhaseDeficitBlur(i, e.target.value));
  });

  updateDietDayDisplay();
  updateTargetForm();
  setEntryFormVisible(false);
  renderInitialLoadingState();
  showAccessGate();
  setStatus("Locked");

  restoreSession()
    .then((ok) => {
      if (ok) {
        setStatus("");
        return;
      }

      return setupGoogleSignIn();
    })
    .catch((error) => {
      setStatus("Locked");
      showAccessGate(error.message || "Could not start sign-in");
    });
}

document.addEventListener("DOMContentLoaded", initApp);
