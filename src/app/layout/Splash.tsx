export function Splash({
  leaving = false,
  variant = "overlay",
}: {
  leaving?: boolean;
  variant?: "overlay" | "static";
}) {
  return (
    <div className={`splash splash--${variant}${leaving ? " is-leaving" : ""}`} aria-hidden>
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
