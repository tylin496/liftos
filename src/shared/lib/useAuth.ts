import { useEffect, useState } from "react";
import { getSession, onAuthChange, type Session } from "./auth";

export interface AuthState {
  session: Session | null;
  loading: boolean;
  error: Error | null;
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;
    getSession()
      .then((s) => {
        if (!active) return;
        setSession(s);
        setError(null);
        setLoading(false);
      })
      .catch((e) => {
        // Without this, a failed getSession() (network down, bad config,
        // corrupted local storage) leaves loading=true forever → the app is
        // stuck on the boot splash with no way out. Surface it instead so the
        // user can retry or sign in.
        if (!active) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setLoading(false);
      });
    const unsub = onAuthChange((s) => {
      setSession(s);
      setError(null);
      setLoading(false);
    });
    return () => {
      active = false;
      unsub();
    };
  }, []);

  return { session, loading, error };
}
