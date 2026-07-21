import { useEffect, useRef } from "react";
import type { CSSProperties, Dispatch, RefObject, SetStateAction } from "react";
import type { Exercise } from "./api";
import { localDateStr } from "@shared/lib/date";
import { getActiveScroller } from "@app/layout/activeScroller";

export const MIN_SET_COUNT = 1;
export const MAX_SET_COUNT = 5;
const DEFAULT_SET_COUNT = 3;
export const LAST_BW_KEY = "liftos/lastBodyweight";

export function todayStr() {
  return localDateStr();
}

export function heroInputStyle(value: string): CSSProperties | undefined {
  const len = String(value ?? "").trim().length;
  if (len <= 7) return undefined;
  // Shrink-to-fit for long weight expressions — a continuous function of length,
  // so it can't be a --text token. 46 = hero max, 22 = readable min (both ends of
  // the --text scale); 400 is the char-width fit constant (≈ len × fontSize).
  return { fontSize: Math.min(46, Math.max(22, Math.round(400 / len))) + "px" };
}

function clampSetCount(n: number) {
  if (n >= MIN_SET_COUNT && n <= MAX_SET_COUNT) return n;
  return DEFAULT_SET_COUNT;
}

function targetSetCount(target: string | null | undefined): number {
  const m = String(target ?? "").match(/(?:×|x)\s*(\d+)\s*$/i);
  return m ? clampSetCount(parseInt(m[1], 10)) : 0;
}

export function defaultSetCount(exercise: Exercise) {
  return targetSetCount(exercise.target) || DEFAULT_SET_COUNT;
}

/** Canonicalize a target string to the "reps × sets" convention on save —
 *  "6-8x3" / "6–8 X 3" → "6-8 × 3", "12*2" → "12 × 2". Only reshapes input that
 *  IS a plain reps[-reps][× sets] expression; anything else (free-text cues,
 *  extra words) passes through trimmed, so the field stays free-form. */
export function normalizeTarget(raw: string): string {
  const trimmed = raw.trim();
  const m = trimmed.match(/^(\d+)(?:\s*[-–—~]\s*(\d+))?(?:\s*(?:×|x|\*)\s*(\d+))?$/i);
  if (!m) return trimmed;
  const [, lo, hi, sets] = m;
  return lo + (hi ? `-${hi}` : "") + (sets ? ` × ${sets}` : "");
}

/** Assisted mode is derived from the exercise NAME, not a stored toggle: a lift
 *  is assisted iff its name says so ("Assisted Pull-up", "輔助引體"). Both the
 *  add and edit forms persist this into `assisted_mode` on save, so renaming an
 *  exercise is the one way to flip its score axis (%BW vs kg — see scoreWeight). */
export function inferAssisted(name: string): boolean {
  return /assist|輔助/i.test(name);
}

export function emptyRepValues(n: number) {
  return Array.from({ length: n }, () => "");
}

export function repsStringToValues(reps: string, n: number): string[] {
  const count = Math.max(MIN_SET_COUNT, n);
  if (!reps) return emptyRepValues(count);
  const segs = String(reps).split(/[/\-]/);
  if (segs.length === 1) {
    return Array.from({ length: count }, () => segs[0]);
  }
  return Array.from({ length: count }, (_, i) => segs[i] ?? segs[segs.length - 1] ?? "");
}

/** Drop trailing EMPTY inputs beyond `base` (the exercise's configured set
 *  count) before composing. Extra inputs come from the "+1 set" button and are
 *  opt-in per log: left blank they must vanish, not inherit the previous set's
 *  reps the way a blank input inside the base count does. */
export function trimExtraEmptyReps(values: string[], base: number): string[] {
  const out = values.slice();
  while (out.length > Math.max(MIN_SET_COUNT, base) && !(out[out.length - 1] ?? "").trim()) {
    out.pop();
  }
  return out;
}

export function composeRepsMulti(values: string[], defaultRep: string): string {
  const resolved: string[] = [];
  for (let i = 0; i < values.length; i++) {
    const t = (values[i] ?? "").trim();
    resolved.push(t || (i === 0 ? defaultRep : resolved[i - 1] ?? defaultRep));
  }
  const first = resolved[0];
  if (!first) return "";
  return resolved.join("/");
}

/** Shared +/− stepper + free-text token append for weight-expression inputs. */
export function useWeightAdjuster(
  weightExpr: string,
  setWeightExpr: Dispatch<SetStateAction<string>>,
  previewWeight: number | null | undefined,
) {
  const weightRef = useRef<HTMLInputElement | null>(null);

  function adjustWeight(delta: number) {
    const base = previewWeight ?? (parseFloat(weightExpr) || 0);
    const next = Math.max(0, base + delta);
    setWeightExpr(String(+next.toFixed(4)));
    weightRef.current?.focus();
  }

  function appendToken(tok: string) {
    setWeightExpr((s) => s + tok);
    weightRef.current?.focus();
  }

  return { weightRef, adjustWeight, appendToken };
}

/** Shared +/− stepper for assistance-kg inputs. */
export function useAssistAdjuster(
  setAssistance: Dispatch<SetStateAction<string>>,
  parsedAssist: number,
) {
  const assistRef = useRef<HTMLInputElement | null>(null);

  function adjustAssist(delta: number) {
    const next = Math.max(0, parsedAssist + delta);
    setAssistance(String(+next.toFixed(2)));
    assistRef.current?.focus();
  }

  return { assistRef, adjustAssist };
}

export function useScrollAboveKeyboard<T extends HTMLElement>(formRef: RefObject<T | null>) {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    function adjust() {
      const form = formRef.current;
      if (!form) return;
      const btn = form.querySelector<HTMLElement>(".btn-log-primary");
      if (!btn) return;
      const btnBottom = btn.getBoundingClientRect().bottom;
      const viewBottom = vv!.offsetTop + vv!.height;
      if (btnBottom > viewBottom - 8) {
        // The active tab panel scrolls, not the window.
        getActiveScroller()?.scrollBy({ top: btnBottom - viewBottom + 16, behavior: "smooth" });
      }
    }
    vv.addEventListener("resize", adjust);
    const t = setTimeout(adjust, 120);
    return () => {
      vv.removeEventListener("resize", adjust);
      clearTimeout(t);
    };
  }, [formRef]);
}
