import type { Session } from "@supabase/supabase-js";
import { useAuth } from "@shared/lib/useAuth";
import { isSupabaseConfigured } from "@shared/lib/supabase";
import { AuthGate } from "./AuthGate";
import { Shell } from "./layout/Shell";

const DEV_SESSION: Session = {
  access_token: "dev",
  token_type: "bearer",
  expires_in: 9999,
  expires_at: 9999999999,
  refresh_token: "dev",
  user: {
    id: "00000000-0000-0000-0000-000000000001",
    aud: "authenticated",
    role: "authenticated",
    email: "dev@local",
    email_confirmed_at: new Date().toISOString(),
    app_metadata: {},
    user_metadata: { full_name: "Dev User", avatar_url: "" },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    identities: [],
    factors: [],
  },
};

const IS_MOCK = import.meta.env.VITE_DEV_BYPASS_AUTH === "true";

// Dev-only marker so it's unmistakable when the app is running against the
// in-memory mock instead of real Supabase — prevents debugging "bugs" that
// only exist (or don't) in mock data.
function MockBadge() {
  if (!IS_MOCK || !import.meta.env.DEV) return null;
  return <div className="mock-badge">MOCK DATA</div>;
}

export function App() {
  const { session, loading, error } = useAuth();

  if (IS_MOCK) {
    return (
      <>
        <Shell session={DEV_SESSION} />
        <MockBadge />
      </>
    );
  }

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

  if (error) {
    return (
      <div className="auth-gate">
        <div className="auth-card">
          <div className="auth-brand">LiftOS</div>
          <p className="auth-tagline">Couldn't reach your account</p>
          <p className="page-note">{error.message}</p>
          <button
            type="button"
            className="app-error-retry"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
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
