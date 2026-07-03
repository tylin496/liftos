import { useBottomUpDelay } from "@shared/hooks/useBottomUpDelay";
import { useCountUp, COUNT_UP_MS } from "@shared/hooks/useCountUp";

function Roll({
  value,
  decimals,
  delayMs,
  format,
}: {
  value: number;
  decimals: number;
  delayMs: number;
  format: (n: number) => string;
}) {
  const n = useCountUp(value, COUNT_UP_MS, decimals, delayMs);
  return <>{n == null ? "" : format(n)}</>;
}

function Measured({
  value,
  decimals,
  format,
}: {
  value: number;
  decimals: number;
  format: (n: number) => string;
}) {
  // The blank span carries the ref and holds the number's layout slot, so its
  // on-screen position is measured before the roll mounts — no value flashes,
  // and the count-up only starts once its stagger delay is known.
  const { ref, delayMs } = useBottomUpDelay<HTMLSpanElement>();
  return (
    <span ref={ref}>
      {delayMs == null ? "" : <Roll value={value} decimals={decimals} delayMs={delayMs} format={format} />}
    </span>
  );
}

/**
 * A number that counts up, staggered into a bottom-up wave (by card) from where
 * it sits on screen. It rolls ONCE — the first time it mounts with data — and
 * stays settled across tab switches; a later value change tweens in place.
 * Blank until it starts rolling — never a stale value or a parked 0. `format`
 * turns the tweened number into display text.
 */
export function AnimatedNumber({
  value,
  decimals = 0,
  format,
}: {
  value: number;
  decimals?: number;
  format: (n: number) => string;
}) {
  return <Measured value={value} decimals={decimals} format={format} />;
}
