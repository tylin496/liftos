import { createContext, useContext, useState, type ReactNode } from "react";

interface Ctx { title: string; setTitle: (t: string) => void; }
const C = createContext<Ctx>({ title: "", setTitle: () => {} });

export function HeaderTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState("");
  return <C.Provider value={{ title, setTitle }}>{children}</C.Provider>;
}

export function useHeaderTitle() { return useContext(C); }
