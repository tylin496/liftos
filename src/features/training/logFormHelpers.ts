import { useEffect } from "react";
import type { CSSProperties, RefObject } from "react";
import type { Exercise } from "./api";

export const MIN_SET_COUNT = 1;
export const MAX_SET_COUNT = 5;
export const DEFAULT_SET_COUNT = 3;
export const LAST_BW_KEY = "liftos/lastBodyweight";

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function heroInputStyle(value: string): CSSProperties | undefined {
  const len = String(value ?? "").trim().length;
  if (len <= 7) return undefined;
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

export function composeRepsMulti(values: string[], defaultRep: string): string {
  const resolved: string[] = [];
  for (let i = 0; i < values.length; i++) {
    const t = (values[i] ?? "").trim();
    resolved.push(t || (i === 0 ? defaultRep : resolved[i - 1] ?? defaultRep));
  }
  const first = resolved[0];
  if (!first) return "";
  if (resolved.every((x) => x === first)) return resolved.join("/");
  return resolved.join("/");
}

export function useScrollAboveKeyboard(formRef: RefObject<HTMLFormElement | null>) {
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
        window.scrollBy({ top: btnBottom - viewBottom + 16, behavior: "smooth" });
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
