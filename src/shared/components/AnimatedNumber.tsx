/**
 * Renders a formatted number — statically. Count-up animation was intentionally
 * dropped app-wide (design decision): a number only animates when it fills in
 * step with a progress bar or activity ring, and those cards drive the roll
 * themselves via useCountUp. Everywhere else the value just shows, and a re-sync
 * updates it in place. Kept as a component (not inlined) so `format` stays the
 * single home for display formatting and re-enabling the roll is a one-file
 * change. `decimals` is retained on the props for callers but unused here.
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
