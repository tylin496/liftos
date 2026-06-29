import { useAuth } from "@shared/lib/useAuth";
import { isSupabaseConfigured } from "@shared/lib/supabase";
import { AuthGate } from "./AuthGate";
import { Shell } from "./layout/Shell";

export function App() {
  const { session, loading } = useAuth();

  if (!isSupabaseConfigured) {
    return (
      <div className="auth-gate">
        <div className="auth-card">
          <div className="auth-brand">LiftOS</div>
          <p className="auth-tagline">Setup needed</p>
          <p className="page-note">
            Add <code>VITE_SUPABASE_ANON_KEY</code> to <code>.env.local</code> and
            restart the dev server.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="boot-splash">LiftOS</div>;
  }

  if (!session) {
    return <AuthGate />;
  }

  return <Shell session={session} />;
}
