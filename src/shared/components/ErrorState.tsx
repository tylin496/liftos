import "./errorState.css";

// One full-card error surface for feature data-load failures, so Training,
// Nutrition, Health, and Overview all fail the same way. (Auth/inline form
// errors keep the smaller `.auth-error` treatment.) Defaults to a reload,
// which is a safe universal recovery for a fetch that failed.
export function ErrorState({
  message,
  onRetry,
  id,
}: {
  message: string;
  onRetry?: () => void;
  /** Preserve a deep-link anchor when this replaces a card another tab jumps to. */
  id?: string;
}) {
  return (
    <section id={id} className="page-card error-state" role="alert">
      <p className="error-state-msg">{message}</p>
      <button
        type="button"
        className="error-state-retry"
        onClick={onRetry ?? (() => window.location.reload())}
      >
        Retry
      </button>
    </section>
  );
}
