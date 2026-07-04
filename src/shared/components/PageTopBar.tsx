import type { ReactNode } from "react";
import { useSessionUser } from "@app/layout/SessionContext";
import { useSettingsSheet } from "@app/layout/SettingsSheetContext";
import { useCopyButton } from "@shared/hooks/useCopyButton";
import { useCrossfade } from "@shared/hooks/useCrossfade";
import { useActiveTargetRing } from "@shared/hooks/useActiveTargetRing";
import { ActivityRing } from "@shared/components/ActivityRing";
import { progressColor } from "@shared/lib/progressColor";
import "./pageTopBar.css";
import "@shared/components/activityRing.css";

const RING_SIZE = 44;
const RING_STROKE = 5;

export function PageTopBar({
  eyebrow,
  title,
  onCopy,
  note,
}: {
  eyebrow: string;
  title: string;
  onCopy?: () => string | Promise<string>;
  note?: ReactNode;
}) {
  const user = useSessionUser();
  const { openSettings } = useSettingsSheet();
  const avatar = user?.user_metadata?.avatar_url as string | undefined;
  const initial = (user?.email ?? "?")[0]?.toUpperCase();
  const { copied, copy } = useCopyButton(onCopy ?? (() => ""));
  const eyebrowFade = useCrossfade(eyebrow);
  const titleFade = useCrossfade(title);
  // The note (e.g. Health's "Synced …") sits on the title row and changes in the
  // same setHeader as the title on a tab swap — cross-fade it on the same 90ms
  // clock so the two never desync (title sliding while the note pops in).
  const noteFade = useCrossfade(note);
  const ring = useActiveTargetRing();
  const ringPct = ring ? ring.today.accrued / Math.max(1, ring.today.target) : null;
  // Follows the shared Apple-spectrum progress ramp by fill (progressColor),
  // matching the Active Target card; grey when there's no data, gold at/over 100%.
  const ringColor =
    ringPct == null ? "var(--rule-strong)"
    : ringPct >= 1 ? "var(--progress-complete)"
    : progressColor(ringPct);

  return (
    <div className="page-topbar">
      <div>
        <p className={`page-topbar-eyebrow${eyebrowFade.fading ? " is-fading" : ""}`}>
          {eyebrowFade.displayed}
        </p>
        <div className="page-topbar-title-row">
          <h1 className={`page-topbar-title${titleFade.fading ? " is-fading" : ""}`}>
            {titleFade.displayed}
          </h1>
          {noteFade.displayed != null && (
            <span className={`page-topbar-note${noteFade.fading ? " is-fading" : ""}`}>
              {noteFade.displayed}
            </span>
          )}
        </div>
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
        <button
          type="button"
          className="page-topbar-avatar-btn"
          onClick={openSettings}
          aria-label={
            ring
              ? `Settings — today's active target ${ring.today.accrued}/${ring.today.target} kcal`
              : "Settings"
          }
        >
          <ActivityRing pct={ringPct ?? 0} size={RING_SIZE} strokeWidth={RING_STROKE} color={ringColor}>
            <span className="page-topbar-avatar">
              {avatar ? (
                <img src={avatar} alt="" className="page-topbar-avatar-img" />
              ) : (
                <span className="page-topbar-avatar-fallback">{initial}</span>
              )}
            </span>
          </ActivityRing>
        </button>
      </div>
    </div>
  );
}
