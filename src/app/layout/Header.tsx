import type { User } from "@shared/lib/auth";
import { signOut } from "@shared/lib/auth";
import logoUrl from "@shared/assets/logo.png";
import type { TabId } from "./TabBar";
import { useHeaderAction } from "./HeaderActionContext";
import { useHeaderTitle } from "./HeaderTitleContext";

const TITLES: Record<TabId, string> = {
  overview: "LiftOS",
  training: "Training",
  nutrition: "Nutrition",
  health: "Health",
};

export function Header({ user, tab }: { user: User; tab: TabId }) {
  const avatar = user.user_metadata?.avatar_url as string | undefined;
  const { action } = useHeaderAction();
  const { title } = useHeaderTitle();

  // 3-column grid: [left: brand] [center: tab title] [right: actions]
  // Guarantees the tab title is visually centered regardless of action widths.
  return (
    <header className="shell-header">
      <div className="shell-header-left">
        <span className="shell-brand">
          <img className="shell-logo" src={logoUrl} alt="" width={24} height={24} />
          <span className="shell-title">Lift<span className="shell-title-os">OS</span></span>
        </span>
      </div>

      <span className="shell-tab-title" aria-live="polite">
        {tab === "training" && title ? title : tab !== "overview" ? TITLES[tab] : ""}
      </span>

      <div className="shell-header-right">
        {action}
        <button className="shell-user" onClick={() => void signOut()} title="Sign out">
          {avatar ? (
            <img src={avatar} alt="" className="shell-avatar" />
          ) : (
            <span className="shell-avatar shell-avatar--fallback">
              {(user.email ?? "?")[0]?.toUpperCase()}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}
