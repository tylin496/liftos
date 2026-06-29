import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import type { Database } from "./database.types";

export const isSupabaseConfigured = Boolean(SUPABASE_ANON_KEY);

// Single shared browser client. Auth session is persisted to localStorage and
// auto-refreshed; every query runs as the signed-in user under RLS.
// Fall back to a placeholder key when unconfigured so createClient doesn't throw
// at import time — the UI shows a setup notice instead of a blank screen.
export const supabase = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_ANON_KEY || "anon-key-not-configured",
  {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// Dev-only console handle for debugging / preview verification.
if (import.meta.env.DEV) {
  (window as unknown as { supabase: typeof supabase }).supabase = supabase;
}
