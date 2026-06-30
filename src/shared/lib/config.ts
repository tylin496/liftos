// LiftOS runtime config.
//
// Supabase is the single source of truth (Postgres + Auth + RLS). The URL and
// anon key are public by design — the anon key only grants access through Row
// Level Security policies, so it is safe to ship in the client bundle.
const FALLBACK_SUPABASE_URL = "https://gcznowwjbeqihhllllpz.supabase.co";

export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ?? FALLBACK_SUPABASE_URL;

export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

// Startup env validation — surfaced loudly so a misconfigured env is obvious
// immediately rather than failing opaquely on the first query.
if (!SUPABASE_ANON_KEY) {
  console.warn(
    "[LiftOS] VITE_SUPABASE_ANON_KEY is not set — copy .env.example to .env.local and fill it in.",
  );
}
if (!import.meta.env.VITE_SUPABASE_URL) {
  // A fork that forgets to set its own URL would silently talk to the original
  // project's Supabase — warn so that footgun is visible.
  console.warn(
    `[LiftOS] VITE_SUPABASE_URL is not set — falling back to ${FALLBACK_SUPABASE_URL}. Set it in .env.local to point at your own project.`,
  );
}
