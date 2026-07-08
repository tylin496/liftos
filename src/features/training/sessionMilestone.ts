// Session-count milestones — every 100th distinct calendar day the account has
// trained, counted across ALL exercises (a day with 4 exercises logged is
// still one session). One tier below a PR/round-weight milestone — see the
// training-milestones-deferred memory for the priority rationale.

const SESSION_STEP = 100;

/** The session-count milestone newly reached by logging on `date`, given every
 *  distinct log date already on record (any exercise) before this save — or
 *  null if `date` isn't a new day or doesn't land on a rung. A single log can
 *  only ever add one new date, so the count rises by at most 1 per call. */
export function sessionMilestoneReached(priorDates: ReadonlySet<string>, date: string): number | null {
  if (priorDates.has(date)) return null;
  const count = priorDates.size + 1;
  return count % SESSION_STEP === 0 ? count : null;
}
