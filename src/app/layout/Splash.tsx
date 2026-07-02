import logoUrl from "@shared/assets/logo.png";

export function Splash({
  leaving = false,
  variant = "overlay",
}: {
  leaving?: boolean;
  variant?: "overlay" | "static";
}) {
  return (
    <div className={`splash splash--${variant}${leaving ? " is-leaving" : ""}`} aria-hidden>
      <div className="splash-mark"><img src={logoUrl} alt="" /></div>
      <div className="splash-word">Lift<b>OS</b></div>
      <div className="splash-tag">Train · Fuel · Recover</div>
    </div>
  );
}
