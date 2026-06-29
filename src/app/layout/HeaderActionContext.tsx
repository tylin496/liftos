import { createContext, useContext, useState, type ReactNode } from "react";

interface HeaderActionCtx {
  action: ReactNode;
  setAction: (el: ReactNode) => void;
}

const Ctx = createContext<HeaderActionCtx>({ action: null, setAction: () => {} });

export function HeaderActionProvider({ children }: { children: ReactNode }) {
  const [action, setAction] = useState<ReactNode>(null);
  return <Ctx.Provider value={{ action, setAction }}>{children}</Ctx.Provider>;
}

export function useHeaderAction() {
  return useContext(Ctx);
}
