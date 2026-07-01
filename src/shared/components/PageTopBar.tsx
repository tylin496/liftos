import { useSessionUser } from "@app/layout/SessionContext";
import { useSettingsSheet } from "@app/layout/SettingsSheetContext";
import { useCopyButton } from "@shared/hooks/useCopyButton";
import "./pageTopBar.css";

export function PageTopBar({
  eyebrow,
  title,
  onCopy,
}: {
  eyebrow: string;
  title: string;
  onCopy?: () => string | Promise<string>;
}) {
  const user = useSessionUser();
  const { openSettings } = useSettingsSheet();
  const avatar = user?.user_metadata?.avatar_url as string | undefined;
  const initial = (user?.email ?? "?")[0]?.toUpperCase();
  const { copied, copy } = useCopyButton(onCopy ?? (() => ""));

  return (
    <div className="page-topbar">
      <div>
        <p className="page-topbar-eyebrow">{eyebrow}</p>
        <h1 className="page-topbar-title">{title}</h1>
      </div>
      <div className="page-topbar-actions">
        {onCopy && (
          <button
            type="button"
            className={`copy-phase-header-btn copy-all-data-btn${copied ? " copied" : ""}`}
            onClick={copy}
            aria-label="Copy all data"
          >
            <span className="copy-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" focusable="false">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </span>
            <span className="check-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" focusable="false">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
          </button>
        )}
        <button type="button" className="page-topbar-avatar" onClick={openSettings} aria-label="Settings">
          {avatar ? (
            <img src={avatar} alt="" className="page-topbar-avatar-img" />
          ) : (
            <span className="page-topbar-avatar-fallback">{initial}</span>
          )}
        </button>
      </div>
    </div>
  );
}
