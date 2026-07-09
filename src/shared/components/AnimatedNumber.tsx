import { useCountUp, COUNT_UP_MS } from "@shared/hooks/useCountUp";
import { useBottomUpDelay } from "@shared/hooks/useBottomUpDelay";

/**
 * Renders a formatted number — statically. This is the DEFAULT for numbers that
 * should NOT roll: user-entered values (logged sets/weights), small parts,
 * trailing context numbers, deltas, and static targets. A same-visit value
 * change updates in place (no reveal). Kept as a component (not inlined) so
 * `format` stays the single home for display formatting. `decimals` is retained
 * on the props for callers but unused here.
 *
 * For lg/md card-HEADLINE numbers that are "arriving data" (Overview weight
 * hero · Nutrition Today Cal/Protein · Health trend + Active hero), use
 * {@link HeadlineCountUp} instead — see the countup+copy handoff §1 scope.
 */
export function AnimatedNumber({
  value,
  format,
}: {
  value: number;
  decimals?: number;
  format: (n: number) => string;
}) {
  return <>{format(value)}</>;
}

function HeadlineRoll({
  value,
  decimals,
  format,
  delayMs,
}: {
  value: number;
  decimals: number;
  format: (n: number) => string;
  delayMs: number;
}) {
  const shown = useCountUp(value, COUNT_UP_MS, decimals, delayMs);
  // Blank (not a parked 0 / stale) until the roll actually begins — the digits
  // only appear once they start climbing. A same-instance settle keeps showing.
  return <>{shown == null ? "" : format(shown)}</>;
}

/**
 * A headline metric number that counts up from 0 on first reveal, then settles
 * in place on later changes (a re-sync tweens, never re-rolls). Runs ONCE per
 * screen visit — pages remount on tab entry, and that IS the intended replay.
 * All headline count-ups share the one entrance beat (`--enter-wait`) via
 * useBottomUpDelay, so they roll together with their cards rather than
 * staggering by position (the app's "one clock" reveal). Honors reduced-motion
 * (snaps to the final value).
 *
 * Scope is deliberate — use ONLY on lg/md card-headline numbers that are
 * arriving data. User-entered values, small parts, deltas and static targets
 * stay on {@link AnimatedNumber}. See the countup+copy handoff §1.
 */
export function HeadlineCountUp({
  value,
  decimals = 0,
  format,
}: {
  value: number;
  decimals?: number;
  format: (n: number) => string;
}) {
  const { ref, delayMs } = useBottomUpDelay<HTMLSpanElement>();
  return (
    <span ref={ref} className="headline-countup">
      {delayMs == null ? (
        ""
      ) : (
        <HeadlineRoll value={value} decimals={decimals} format={format} delayMs={delayMs} />
      )}
    </span>
  );
}
