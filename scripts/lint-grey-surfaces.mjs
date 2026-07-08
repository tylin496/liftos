// Grey-surface rule, machine-enforced (see CLAUDE.md → 灰色面規則).
//
// PASSIVE grey surfaces (chip / tag / toggle / segmented / collapse control /
// block) fill with --bg-soft (or --rule) and carry NO border — a border is the
// "you can type here" signal reserved for editable inputs (--bg-input + 1px
// solid --rule + focus ring). A bordered passive surface reads as an input box;
// that drift is exactly what this check exists to stop.
//
// This can't live in stylelint config: declaration-strict-value polices VALUES,
// but this rule is about a COMBINATION (grey fill + border in one block), so we
// walk the CSS ourselves. Runs as part of `npm run lint:css`.
//
// If a new selector legitimately needs grey fill + border (an input, or a
// stepper glued to one), add it to ALLOWLIST below — the diff makes the
// decision visible in review instead of silent.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";

// Selectors allowed to combine a grey fill with a border. Each entry is a
// substring match against the rule's selector, with the reason on the line.
const ALLOWLIST = [
  ".reps-input", // editable number input — border IS the affordance
  ".log-adj-btn", // +/− stepper glued to that input; border keeps the pair one unit
  ".btn-log-secondary", // action button — button system, not a passive surface
  ".archived-actions", // action buttons in the archived list — same as above
];

// Passive grey fills. --bg-input is deliberately NOT here: inputs are supposed
// to have borders. (?!-) keeps --rule from also matching --rule-strong.
const GREY_FILL = /var\(--bg-soft\)|var\(--rule\)(?!-)/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".css")) out.push(p);
  }
  return out;
}

const violations = [];

for (const file of walk("src")) {
  const root = postcss.parse(readFileSync(file, "utf8"), { from: file });
  root.walkRules((rule) => {
    let greyFill = false;
    let borderDecl = null;
    rule.walkDecls((decl) => {
      if (/^background(-color)?$/.test(decl.prop) && GREY_FILL.test(decl.value)) greyFill = true;
      if (decl.prop === "border" && /solid/.test(decl.value)) borderDecl = decl;
    });
    if (greyFill && borderDecl && !ALLOWLIST.some((s) => rule.selector.includes(s))) {
      violations.push(
        `${file}:${borderDecl.source.start.line}  ${rule.selector}\n` +
          `    grey passive fill + "border: ${borderDecl.value}" — passive surfaces are borderless ` +
          `(border = editable-input signal). Drop the border, or add to ALLOWLIST with a reason.`,
      );
    }
  });
}

if (violations.length) {
  console.error(`grey-surface rule: ${violations.length} violation(s)\n`);
  for (const v of violations) console.error(v + "\n");
  process.exit(1);
}
console.log("grey-surface rule: OK");
