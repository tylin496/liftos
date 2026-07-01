// Dev-only watchdog for docs/LAYOUT-STABILITY.md rule 1: a `.page-card` must
// hold the same height across loading / empty / loaded. Warns in the console
// when a card's height changes right as it drops `loading-card` — the
// signature of a skeleton that doesn't match its loaded layout. No-ops (and
// is stripped by Vite) outside dev builds.
export function installLayoutStabilityGuard(): void {
  if (!import.meta.env.DEV) return;
  if (typeof ResizeObserver === "undefined") return;

  const lastHeight = new WeakMap<Element, number>();
  const wasLoading = new WeakMap<Element, boolean>();

  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const el = entry.target;
      const height = Math.round(entry.contentRect.height);
      const loading = el.classList.contains("loading-card");
      const prevHeight = lastHeight.get(el);
      const prevLoading = wasLoading.get(el);

      if (prevHeight != null && prevLoading === true && loading === false && prevHeight !== height) {
        console.warn(
          "[layout-stability] .page-card height changed leaving loading state:",
          `${prevHeight}px → ${height}px`,
          el,
        );
      }

      lastHeight.set(el, height);
      wasLoading.set(el, loading);
    }
  });

  const mo = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "childList") {
        m.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          node.querySelectorAll?.(".page-card").forEach((card) => ro.observe(card));
          if (node.classList?.contains("page-card")) ro.observe(node);
        });
      }
    }
  });

  document.querySelectorAll(".page-card").forEach((card) => ro.observe(card));
  mo.observe(document.body, { childList: true, subtree: true });
}
