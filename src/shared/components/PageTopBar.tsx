import { useSessionUser } from "@app/layout/SessionContext";
import { useSettingsSheet } from "@app/layout/SettingsSheetContext";
import "./pageTopBar.css";

export function PageTopBar({ eyebrow, title }: { eyebrow: string; title: string }) {
  const user = useSessionUser();
  const { openSettings } = useSettingsSheet();
  const avatar = user?.user_metadata?.avatar_url as string | undefined;
  const initial = (user?.email ?? "?")[0]?.toUpperCase();

  return (
    <div className="page-topbar">
      <div>
        <p className="page-topbar-eyebrow">{eyebrow}</p>
        <h1 className="page-topbar-title">{title}</h1>
      </div>
      <button type="button" className="page-topbar-avatar" onClick={openSettings} aria-label="Settings">
        {avatar ? (
          <img src={avatar} alt="" className="page-topbar-avatar-img" />
        ) : (
          <span className="page-topbar-avatar-fallback">{initial}</span>
        )}
      </button>
    </div>
  );
}
