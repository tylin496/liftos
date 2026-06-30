// Lifting-notation parser — ported from lift-log/parser.js to TS.
// Format: <weight-expression>*<reps> [optional notes]
//   "75*12"          -> { weight: 75, reps: "12" }
//   "27×2 *10"       -> { weight: 54, reps: "10" }
//   "97.19-(26) *8"  -> { weight: 71.19, reps: "8", assisted: { bw, assist } }
//   "100*10/10/9"    -> drop sets
//   "30lbs *8"       -> unit lbs

const LB_TO_KG = 0.453592;

export interface Parsed {
  raw: string;
  weightExpr: string;
  weight: number;
  reps: string;
  notes: string;
  unit: "kg" | "lbs" | "lb" | null;
  assisted: { bw: number; assist: number } | null;
}

export function normalize(s: string): string {
  return String(s || "")
    .replace(/[xX]/g, "×")
    .replace(/\s+/g, " ")
    .trim();
}

// Safe arithmetic evaluator for + - * / ( ) and decimals (× already normalized).
// Recursive descent — no Function()/eval, so it's CSP-safe.
export function evalArith(expr: string | null): number {
  if (expr == null) return NaN;
  const src = String(expr).replace(/×/g, "*").replace(/\s+/g, "");
  if (!/^[\d+\-*/().]+$/.test(src)) return NaN;

  let i = 0;
  const peek = () => src[i];
  const fail = () => {
    throw new Error("parse");
  };

  function parseExpr(): number {
    let v = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = src[i++];
      const r = parseTerm();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  function parseTerm(): number {
    let v = parseFactor();
    while (peek() === "*" || peek() === "/") {
      const op = src[i++];
      const r = parseFactor();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }
  function parseFactor(): number {
    if (peek() === "(") {
      i++;
      const v = parseExpr();
      if (peek() !== ")") fail();
      i++;
      return v;
    }
    if (peek() === "-") {
      i++;
      return -parseFactor();
    }
    const start = i;
    while (i < src.length && /[\d.]/.test(src[i])) i++;
    if (i === start) fail();
    return Number(src.slice(start, i));
  }

  try {
    const v = parseExpr();
    return i === src.length && Number.isFinite(v) ? v : NaN;
  } catch {
    return NaN;
  }
}

export function parse(raw: string): Parsed | null {
  if (!raw) return null;
  const s = normalize(raw);
  const m = s.match(/^(.+?)(?:\s*(lbs?|kg))?\s*\*\s*([\d]+(?:[/\-][\d]+)*)\s*(.*)$/i);
  if (!m) return null;
  const weightExpr = m[1].trim();
  const unit = (m[2]?.toLowerCase() as Parsed["unit"]) || null;
  const reps = m[3];
  const notes = (m[4] || "").trim();

  let assisted: Parsed["assisted"] = null;
  const am = weightExpr.match(/^([\d.]+)\s*-\s*\(([^)]+)\)\s*$/);
  if (am) {
    const bw = Number(am[1]);
    const assist = evalArith(am[2]);
    if (Number.isFinite(bw) && Number.isFinite(assist)) assisted = { bw, assist };
  }

  return { raw, weightExpr, weight: evalArith(weightExpr), reps, notes, unit, assisted };
}

/** Settlement weight in kg (for PR comparison). */
export function score(parsed: Parsed | null): number {
  if (!parsed || !Number.isFinite(parsed.weight)) return -Infinity;
  if (parsed.unit === "lbs" || parsed.unit === "lb") return parsed.weight * LB_TO_KG;
  return parsed.weight;
}

export function formatRepsDisplay(reps: string): string {
  if (!reps) return "";
  const segs = String(reps).split(/[/\-]/);
  if (segs.length === 1) return segs[0];
  if (segs.every((x) => x === segs[0])) return segs[0];
  return reps;
}
