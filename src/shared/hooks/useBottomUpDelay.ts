import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

// Longest stagger (ms): a number at the very top of the viewport waits this long
// before rolling; one at the bottom of the visible area rolls almost at once.
const BOTTOM_UP_SPAN_MS = 300;

// The stagger unit is the CARD, not the individual number: we measure the
// nearest card ancestor so every number inside one card shares the same delay
// and rolls together. Cards stagger relative to each other, bottom-up.
const CARD_SELECTOR = ".page-card, .ex-card";

/**
 * Bottom-up reveal delay from where the element's *card* sits on screen at
 * mount: cards lower in the visible viewport roll first and the wave climbs
 * upward, one card at a time. Anything below the fold (or scrolled above the
 * viewport) gets 0 — we never stagger what the phone can't show, so the cards
 * you can see don't sit waiting on off-screen ones.
 *
 * Returns `null` until measured — one synchronous layout pass before paint — so
 * the caller renders blank first, then rolls (never a parked value or 0).
 */
export function useBottomUpDelay<T extends HTMLElement = HTMLSpanElement>(): {
  ref: RefObject<T>;
  delayMs: number | null;
} {
  const ref = useRef<T>(null);
  const [delayMs, setDelayMs] = useState<number | null>(null);

  useLayoutEffect(() => {
    const H = typeof window !== "undefined" ? window.innerHeight || 1 : 1;
    const el = ref.current;
    // Measure the whole card so sibling numbers share one delay; fall back to
    // the element itself if it isn't inside a card.
    const card = el?.closest(CARD_SELECTOR) ?? el;
    const top = card ? card.getBoundingClientRect().top : H;
    // Fraction of the viewport ABOVE the card: 1 at the very top, 0 at the
    // bottom edge. Off-screen (top ≥ H, or scrolled above at top < 0) → 0.
    const frac = top >= 0 && top < H ? (H - top) / H : 0;
    setDelayMs(Math.round(frac * BOTTOM_UP_SPAN_MS));
  }, []);

  return { ref, delayMs };
}
