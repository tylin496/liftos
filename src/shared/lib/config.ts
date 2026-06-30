// LiftOS runtime config.
//
// Supabase is the single source of truth (Postgres + Auth + RLS). The URL and
// anon key are public by design — the anon key only grants access through Row
// Level Security policies, so it is safe to ship in the client bundle.
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ?? "https://gcznowwjbeqihhllllpz.supabase.co";

export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

if (!SUPABASE_ANON_KEY) {
  // Surfaced loudly in dev so a missing .env.local is obvious immediately.
  console.warn(
    "[LiftOS] VITE_SUPABASE_ANON_KEY is not set — copy .env.example to .env.local and fill it in.",
  );
}
