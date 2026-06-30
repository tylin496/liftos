import { Component, type ErrorInfo, type ReactNode } from "react";
import "./auth-gate.css";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// App-wide safety net. React unmounts the whole tree when a render throws, so
// without this any uncaught error (a bad data shape, a null deref in a feature)
// blanks the entire app. This catches it and offers a reload instead.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[LiftOS] Uncaught render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="auth-gate">
          <div className="auth-card">
            <div className="auth-brand">LiftOS</div>
            <p className="auth-tagline">Something went wrong</p>
            <p className="page-note">{this.state.error.message}</p>
            <button
              type="button"
              className="app-error-retry"
              onClick={() => window.location.reload()}
            >
              Reload app
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
