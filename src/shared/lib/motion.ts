// JS mirror of the CSS motion duration tokens (src/shared/styles/tokens.css
// §Motion). Kept in sync BY HAND — the same discipline that ties --dur-countup
// to useCountUp's COUNT_UP_MS. Reach for these whenever JS timing must line up
// with a CSS animation driven by the same role token: a setTimeout that clears
// the state flag driving an animation, or a JS-built transition string. Before
// this existed, every such site invented its own raw literal (1100 / 1200 / 300
// for the same 1000ms / 200ms / 280ms tokens), so the two silently drifted.
export const DUR_EXIT = 200; // --dur-exit
const DUR_MOVE = 280; // --dur-move
const DUR_SHEEN = 1000; // --dur-sheen

// One uniform guard, added when a timer must OUTLAST its animation so timer/rAF
// jitter never clears the driving state a frame before the final keyframe. Not a
// per-site guess — every "clear after animation" window below uses this one value.
const CLEAR_GUARD = 100;

// Hold-then-clear windows: keep a state flag applied for its animation's full run,
// then release it. Named by the role token the paired animation uses.
export const CLEAR_AFTER_EXIT = DUR_EXIT + CLEAR_GUARD; // toast-out → remove node
export const CLEAR_AFTER_MOVE = DUR_MOVE + CLEAR_GUARD; // slide-from-* → reset nav direction
export const CLEAR_AFTER_SHEEN = DUR_SHEEN + CLEAR_GUARD; // pr-sheen / row-saved → drop flash flag
