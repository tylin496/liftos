import { createContext, useContext, useState, type ReactNode } from "react";

interface Ctx {
  open: boolean;
  openSettings: () => void;
  closeSettings: () => void;
}
const C = createContext<Ctx>({ open: false, openSettings: () => {}, closeSettings: () => {} });

export function SettingsSheetProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <C.Provider value={{ open, openSettings: () => setOpen(true), closeSettings: () => setOpen(false) }}>
      {children}
    </C.Provider>
  );
}

export function useSettingsSheet() {
  return useContext(C);
}
