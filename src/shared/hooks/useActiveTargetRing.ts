import { useEffect, useState } from "react";
import { fetchHealthData } from "@features/health/api";
import type { ActiveTargetView } from "@features/health/activeTarget";

const RING_WINDOW_DAYS = 35;

/** Global, always-on read of today's Active Target ring — the topbar avatar
 *  wears this on every tab, so it fetches its own (small) slice of health
 *  data independently of whatever the Health/Overview tabs are doing.
 *  Refreshes on mount and whenever the tab regains focus, since the
 *  underlying data only actually changes once a day via the nightly sync. */
export function useActiveTargetRing(): ActiveTargetView | null {
  const [view, setView] = useState<ActiveTargetView | null>(null);

  useEffect(() => {
    let cancelled = false;
    function load() {
      fetchHealthData(RING_WINDOW_DAYS)
        .then((d) => {
          if (!cancelled) setView(d.activeTarget);
        })
        .catch(() => {});
    }
    load();
    function onVisible() {
      if (document.visibilityState === "visible") load();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return view;
}
