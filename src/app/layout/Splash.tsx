import { useLayoutEffect, useRef } from "react";

// One animation clock across remounts. Cold start mounts TWO splashes back to
// back (App's static splash while auth loads → Shell's overlay splash), and the
// DOM swap restarts every keyframe — trace redraws, wordmark rises again. The
// module-level clock survives the swap: each mount sets a negative
// animation-delay (--splash-sync) so the new node picks up mid-animation where
// the old one left off. A gap longer than a hand-off frame means a genuinely
// fresh splash (e.g. after the sign-in screen) → clock resets.
let clockStart: number | null = null;
let lastUnmount = -Infinity;

export function Splash({
  leaving = false,
  variant = "overlay",
}: {
  leaving?: boolean;
  variant?: "overlay" | "static";
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const now = performance.now();
    if (clockStart === null || now - lastUnmount > 250) clockStart = now;
    ref.current?.style.setProperty("--splash-sync", `${clockStart - now}ms`);
    return () => {
      lastUnmount = performance.now();
    };
  }, []);
  return (
    <div ref={ref} className={`splash splash--${variant}${leaving ? " is-leaving" : ""}`} aria-hidden>
      <div className="splash-trace">
        <svg viewBox="0 0 220 70" width="176" height="56">
          <path
            className="splash-trace-path"
            d="M6,42 L54,42 L66,14 L82,58 L96,26 L112,42 L166,42 L178,24 L190,42 L214,42"
          />
        </svg>
      </div>
      <div className="splash-word">Lift<b>OS</b></div>
      <div className="splash-tag">Train Fuel Recover</div>
      <div className="splash-dots" aria-hidden>
        <span></span><span></span><span></span>
      </div>
    </div>
  );
}
