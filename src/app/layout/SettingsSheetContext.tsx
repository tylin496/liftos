import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface Ctx {
  open: boolean;
  openSettings: () => void;
  closeSettings: () => void;
}
const C = createContext<Ctx>({ open: false, openSettings: () => {}, closeSettings: () => {} });

export function SettingsSheetProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openSettings = useCallback(() => setOpen(true), []);
  const closeSettings = useCallback(() => setOpen(false), []);
  // Memoize so the value identity only changes when `open` flips, not on every
  // parent render (the callbacks were previously re-created each render).
  const value = useMemo(
    () => ({ open, openSettings, closeSettings }),
    [open, openSettings, closeSettings],
  );
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useSettingsSheet() {
  return useContext(C);
}
