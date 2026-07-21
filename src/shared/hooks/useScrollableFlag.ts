import { useLayoutEffect, type RefObject } from "react";

/**
 * Flags an overlay's scroll container with `.is-scrollable` only while its
 * content actually overflows. The CSS keys `touch-action` off that flag:
 * `none` when it can't scroll, `pan-y` when it can.
 *
 * Why measure rather than trust `overscroll-behavior: contain`: WebKit only
 * honours contain on a container that can really scroll. On a scroller whose
 * content fits — a short trend sheet, a two-row settings list, a calendar with
 * one month of history — a drag falls out of the overlay and pans the tab panel
 * behind the scrim, so the page moves under an open sheet. A blanket
 * `touch-action: none` would stop that but permanently kill scrolling on the
 * sheets that DO overflow, and it can't be re-enabled on a descendant (the
 * browser intersects touch-action down the ancestor chain). So the two states
 * have to be told apart at runtime.
 *
 * Call it only while the overlay is open — i.e. from a component that unmounts
 * on close, like every sheet here already does via useExitTransition.
 */
export function useScrollableFlag(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const sync = () => {
      // 1px slack: sub-pixel layout rounding otherwise reports a 0.5px
      // "overflow" on a body that visibly fits.
      el.classList.toggle("is-scrollable", el.scrollHeight - el.clientHeight > 1);
    };
    sync();

    // Content can arrive or grow after mount (async data, an expanding row, a
    // conditional block), and the scroller's own height is capped by the sheet
    // — so watch both the box and the subtree.
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    const mo = new MutationObserver(sync);
    mo.observe(el, { childList: true, subtree: true });

    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [ref]);
}
