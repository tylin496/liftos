import logoUrl from "@shared/assets/logo.png";
import { useHeaderAction } from "./HeaderActionContext";

// Slim persistent utility bar: brand mark + whatever per-page action a
// feature registers (e.g. "copy summary"). Identity, settings, and the
// per-tab title all live in PageTopBar now — this bar no longer duplicates
// them (previously both rendered, stacked, showing two avatars).
export function Header() {
  const { action } = useHeaderAction();

  return (
    <header className="shell-header">
      <span className="shell-brand">
        <img className="shell-logo" src={logoUrl} alt="" width={24} height={24} />
        <span className="shell-title">Lift<span className="shell-title-os">OS</span></span>
      </span>

      <div className="shell-header-right">{action}</div>
    </header>
  );
}
