import { useState } from "react";
import type { User } from "@shared/lib/auth";
import { signOut } from "@shared/lib/auth";
import logoUrl from "@shared/assets/logo.png";
import type { TabId } from "./TabBar";
import { useHeaderAction } from "./HeaderActionContext";
import { useHeaderTitle } from "./HeaderTitleContext";
import { SettingsSheet } from "./SettingsSheet";

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
  const [settingsOpen, setSettingsOpen] = useState(false);

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
        <button
          className="shell-gear"
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
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
      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </header>
  );
}
