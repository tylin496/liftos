import { useEffect, useState } from "react";

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/**
 * Keeps a component mounted through its exit animation.
 *
 * Drive it with the same boolean that gates `{open && <X/>}`. It returns:
 *   - `mounted`: render the component while true (stays true during the exit)
 *   - `closing`: true while the exit animation plays — add a class (e.g.
 *     `is-closing`) whose CSS runs the *-out keyframe
 *
 * Unmounts `durationMs` after `open` flips to false. Set `durationMs` to the
 * longest exit animation in that component. Respects prefers-reduced-motion
 * (unmounts immediately), matching the global motion guard.
 */
export function useExitTransition(open: boolean, durationMs = 220) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const d = prefersReducedMotion() ? 0 : durationMs;
    const t = setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, d);
    return () => clearTimeout(t);
  }, [open, mounted, durationMs]);

  return { mounted, closing };
}
