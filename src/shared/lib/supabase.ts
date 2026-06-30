import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import type { Database } from "./database.types";
import { mockSupabase } from "./mock-supabase";

export const isSupabaseConfigured = Boolean(SUPABASE_ANON_KEY);

const realClient = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_ANON_KEY || "anon-key-not-configured",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);

// In bypass mode, swap in the in-memory mock so all API calls work without a
// real auth session. The mock implements the same query-builder interface.
const isMock = import.meta.env.VITE_DEV_BYPASS_AUTH === "true";

if (isMock && import.meta.env.DEV) {
  console.warn(
    "[LiftOS] VITE_DEV_BYPASS_AUTH=true — using in-memory MOCK data. No reads/writes hit real Supabase.",
  );
}

export const supabase = (
  isMock ? mockSupabase : realClient
) as unknown as typeof realClient;

// Dev-only console handle for debugging / preview verification.
if (import.meta.env.DEV) {
  (window as unknown as { supabase: typeof supabase }).supabase = supabase;
}
