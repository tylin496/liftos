import { useEffect, useState } from "react";
import { getSession, onAuthChange, type Session } from "./auth";

export interface AuthState {
  session: Session | null;
  loading: boolean;
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getSession().then((s) => {
      if (!active) return;
      setSession(s);
      setLoading(false);
    });
    const unsub = onAuthChange((s) => {
      setSession(s);
      setLoading(false);
    });
    return () => {
      active = false;
      unsub();
    };
  }, []);

  return { session, loading };
}
