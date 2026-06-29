import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

// Thin wrapper over Supabase Auth. Google is the only provider; RLS does the
// per-user data isolation so there is no custom token/session code to maintain.

export type { Session, User };

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthChange(cb: (session: Session | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

export async function signInWithGoogle(): Promise<void> {
  // Return to wherever the app currently lives (GitHub Pages /LiftOS/ or local).
  const redirectTo = window.location.origin + import.meta.env.BASE_URL;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
