import { createContext, useContext, type ReactNode } from "react";
import type { User } from "@shared/lib/auth";

// The one account with full read/write. Everyone else who signs in (and is on
// the Supabase `shared_viewers` allowlist) gets a read-only view of this
// account's data — RLS enforces it in the database; `isReadOnly` hides the
// write UI so viewers never tap a button that would just fail. Keep this in
// sync with `owner_id()` / `is_owner()` in supabase/migrations/0002.
const OWNER_EMAIL = "tylin496@gmail.com";

const C = createContext<User | null>(null);

export function SessionUserProvider({ user, children }: { user: User; children: ReactNode }) {
  return <C.Provider value={user}>{children}</C.Provider>;
}

export function useSessionUser(): User | null {
  return useContext(C);
}

// True when the signed-in account is NOT the owner — i.e. a shared viewer.
// Drives read-only UI across every feature. The dev-bypass session
// (email "dev@local") is treated as the owner so local dev stays writable.
export function useIsReadOnly(): boolean {
  const user = useContext(C);
  const email = (user?.email ?? "").toLowerCase();
  if (!email || email === "dev@local") return false;
  return email !== OWNER_EMAIL.toLowerCase();
}
