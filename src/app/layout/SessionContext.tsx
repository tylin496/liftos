import { createContext, useContext, type ReactNode } from "react";
import type { User } from "@shared/lib/auth";
import { emailIsViewer } from "@shared/lib/owner";

const C = createContext<User | null>(null);

export function SessionUserProvider({ user, children }: { user: User; children: ReactNode }) {
  return <C.Provider value={user}>{children}</C.Provider>;
}

export function useSessionUser(): User | null {
  return useContext(C);
}

// True when the signed-in account is a shared viewer (not the owner). Drives the
// read-only UI across every feature. The owner/viewer rule lives in one place —
// see @shared/lib/owner. RLS is what actually protects the data; this only hides
// write affordances so a viewer never taps a button that would just fail.
export function useIsReadOnly(): boolean {
  return emailIsViewer(useContext(C)?.email);
}
