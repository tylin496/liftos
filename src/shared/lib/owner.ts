import { supabase } from "./supabase";

// ─────────────────────────────────────────────────────────────────────────────
// Single client-side source of truth for "who owns the data".
//
// The one account with full read/write is the OWNER. Who can sign in at all is
// gated at Google (OAuth consent screen in Testing mode → only listed test
// users), so every authenticated non-owner is an approved viewer. Correctness
// lives in the database — the RLS policy in supabase/migrations/0002 is the sole
// authority on visibility (owner sees own rows, everyone else sees the owner's).
// This module only mirrors the owner identity for two client concerns: hiding
// write UI (useIsReadOnly) and skipping the couple of auto-writes that fire on
// load.
//
// Changing the owner means editing this constant AND the SQL helpers (owner_id /
// is_owner) in 0002 — those are separate systems and can't share a constant.
// ─────────────────────────────────────────────────────────────────────────────

export const OWNER_EMAIL = "tylin496@gmail.com";

/** The viewer/owner rule in one place. `dev@local` (dev-bypass) counts as the
 *  owner so local dev stays fully writable. */
export function emailIsViewer(email: string | null | undefined): boolean {
  const e = (email ?? "").toLowerCase();
  if (!e || e === "dev@local") return false;
  return e !== OWNER_EMAIL.toLowerCase();
}

/** Per-account display-name overrides, keyed by lowercased email. When a signed-in
 *  account is listed here, the UI greets them with this name instead of their
 *  Google `full_name`. Everyone else falls back to their Google account name. */
const DISPLAY_NAME_OVERRIDES: Record<string, string> = {
  [OWNER_EMAIL.toLowerCase()]: "Thomas",
};

/** Preferred first-name for an account, or `undefined` to fall back to the
 *  Google `full_name` / email. */
export function displayNameFor(email: string | null | undefined): string | undefined {
  return DISPLAY_NAME_OVERRIDES[(email ?? "").toLowerCase()];
}

/** Async form for the data layer (no React context). Guards the auto-writes
 *  that would otherwise fire on load for a viewer. */
export async function isViewer(): Promise<boolean> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return false;
  return emailIsViewer(data.user.email);
}
