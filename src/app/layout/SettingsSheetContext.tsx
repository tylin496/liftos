import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/** The sheet's editable rows. Lives here rather than in SettingsSheet so a caller
 *  can name the row it wants opened without importing the sheet itself. */
export type SettingsRow = "protein" | "intake" | "targettdee" | "height" | "start" | "bf";

interface Ctx {
  open: boolean;
  /** `focusRow` opens the sheet with that row already in edit mode — for callers
   *  that ARE the reason you're opening settings (Overview's System banner asking
   *  you to move the intake goal), so the lever is under your thumb on arrival.
   *  Omitted = the plain sheet, every row collapsed. */
  openSettings: (focusRow?: SettingsRow) => void;
  closeSettings: () => void;
  /** Which row the current open asked for; read by the sheet, not by callers. */
  focusRow: SettingsRow | null;
}
const C = createContext<Ctx>({
  open: false,
  openSettings: () => {},
  closeSettings: () => {},
  focusRow: null,
});

export function SettingsSheetProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [focusRow, setFocusRow] = useState<SettingsRow | null>(null);
  const openSettings = useCallback((row?: SettingsRow) => {
    setFocusRow(row ?? null);
    setOpen(true);
  }, []);
  // focusRow is deliberately NOT cleared on close: the sheet unmounts on the way
  // out, so clearing it here would only re-render the exiting sheet without it.
  // The next openSettings() sets it (or clears it) anyway.
  const closeSettings = useCallback(() => setOpen(false), []);
  // Memoize so the value identity only changes when `open` flips, not on every
  // parent render (the callbacks were previously re-created each render).
  const value = useMemo(
    () => ({ open, openSettings, closeSettings, focusRow }),
    [open, openSettings, closeSettings, focusRow],
  );
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useSettingsSheet() {
  return useContext(C);
}
