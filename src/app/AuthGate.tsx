import { useState } from "react";
import { signInWithGoogle } from "@shared/lib/auth";
import logoUrl from "@shared/assets/logo.png";
import "./auth-gate.css";

export function AuthGate() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
      setBusy(false);
    }
  }

  return (
    <div className="auth-gate">
      <div className="auth-card">
        <img className="auth-logo" src={logoUrl} alt="" width={76} height={76} />
        <div className="auth-brand">LiftOS</div>
        <p className="auth-tagline">Training Nutrition Health</p>
        <button className="auth-google" onClick={handleSignIn} disabled={busy}>
          {busy ? "Connecting…" : "Continue with Google"}
        </button>
        {error && <p className="auth-error">{error}</p>}
      </div>
    </div>
  );
}
