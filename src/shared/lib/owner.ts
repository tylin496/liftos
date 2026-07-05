import { supabase } from "./supabase";

// The one account with full read/write. Everyone else on the Supabase
// `shared_viewers` allowlist gets a read-only view of this account's data.
// Keep in sync with `owner_id()` / `is_owner()` in
// supabase/migrations/0002_shared_read_access.sql and with OWNER_EMAIL in
// src/app/layout/SessionContext.tsx.
const OWNER_EMAIL = "tylin496@gmail.com";

/** True when the signed-in account is a shared viewer (not the owner, not the
 *  local dev-bypass session). Viewers read the owner's data (via RLS) and never
 *  write — this guards the handful of auto-writes that otherwise fire on load. */
export async function isViewer(): Promise<boolean> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return false;
  const email = (data.user.email ?? "").toLowerCase();
  if (!email || email === "dev@local") return false;
  return email !== OWNER_EMAIL.toLowerCase();
}
