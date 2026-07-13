import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { CLEAR_AFTER_EXIT } from "@shared/lib/motion";

interface ToastAction {
  label: string;
  onClick: () => void;
}

type ToastType = "success" | "info" | "error";

const ICON: Record<ToastType, string> = { success: "✓", info: "•", error: "!" };

interface ToastItem {
  id: number;
  msg: string;
  type: ToastType;
  action: ToastAction | null;
  exiting: boolean;
}

type AddToastFn = (
  msg: string,
  type?: ToastType,
  duration?: number,
  action?: ToastAction | null,
) => number;

const ToastContext = createContext<AddToastFn | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback<AddToastFn>(
    (msg, type = "success", duration = 3000, action = null) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, msg, type: type as ToastType, action: action ?? null, exiting: false }]);
      setTimeout(() => {
        setToasts((t) => t.map((x) => (x.id === id ? { ...x, exiting: true } : x)));
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), CLEAR_AFTER_EXIT);
      }, duration);
      return id;
    },
    [],
  );

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.map((x) => (x.id === id ? { ...x, exiting: true } : x)));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), CLEAR_AFTER_EXIT);
  }, []);

  // Escape dismisses all visible toasts — the tray is aria-live and click-to-
  // dismiss is mouse-only, so this is the keyboard path. No focus is taken; a
  // toast added after Escape (not marked exiting) survives the sweep.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setToasts((prev) => prev.map((x) => ({ ...x, exiting: true })));
      setTimeout(() => setToasts((prev) => prev.filter((x) => !x.exiting)), CLEAR_AFTER_EXIT);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <ToastContext.Provider value={addToast}>
      {children}
      <div className="toast-tray" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast toast-${t.type}${t.exiting ? " toast-exit" : ""}`}
            onClick={() => dismiss(t.id)}
          >
            <span className="toast-icon" aria-hidden>{ICON[t.type]}</span>
            <span className="toast-msg">{t.msg}</span>
            {t.action && (
              <button
                type="button"
                className="toast-action"
                onClick={(e) => {
                  e.stopPropagation();
                  t.action!.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext)!;
}
