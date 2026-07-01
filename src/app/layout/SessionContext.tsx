import { createContext, useContext, type ReactNode } from "react";
import type { User } from "@shared/lib/auth";

const C = createContext<User | null>(null);

export function SessionUserProvider({ user, children }: { user: User; children: ReactNode }) {
  return <C.Provider value={user}>{children}</C.Provider>;
}

export function useSessionUser(): User | null {
  return useContext(C);
}
