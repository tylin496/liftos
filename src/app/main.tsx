import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/jetbrains-mono";
import "@shared/styles/global.css";
import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { installLayoutStabilityGuard } from "@shared/lib/layoutStabilityGuard";
import { ThemeProvider } from "@shared/lib/theme";

installLayoutStabilityGuard();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
