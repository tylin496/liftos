import { useCallback, useContext, useRef, useState, createContext } from "react";
import type { ReactNode } from "react";
import { useExitTransition } from "../../shared/hooks/useExitTransition";

interface ConfirmOptions {
  confirmLabel?: string;
  danger?: boolean;
}

interface DialogState {
  msg: string;
  resolve: (ok: boolean) => void;
  confirmLabel: string;
  danger: boolean;
}

type ConfirmFn = (msg: string, opts?: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const confirm = useCallback<ConfirmFn>((msg, opts = {}) => {
    return new Promise<boolean>((resolve) => {
      setDialog({
        msg,
        resolve,
        confirmLabel: opts.confirmLabel ?? "Confirm",
        danger: opts.danger !== false,
      });
    });
  }, []);

  function handle(ok: boolean) {
    dialog?.resolve(ok);
    setDialog(null);
  }

  const { mounted, closing } = useExitTransition(dialog !== null);
  // Keep the last dialog's content on screen while it animates out.
  const shownRef = useRef<DialogState | null>(null);
  if (dialog) shownRef.current = dialog;
  const shown = shownRef.current;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {mounted && shown && (
        <div
          className={`confirm-overlay${closing ? " is-closing" : ""}`}
          onClick={() => handle(false)}
        >
          <div
            className={`confirm-dialog${closing ? " is-closing" : ""}`}
            role="alertdialog"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="confirm-msg">{shown.msg}</p>
            <div className="confirm-actions">
              <button className="btn-ghost" onClick={() => handle(false)}>
                Cancel
              </button>
              <button
                className={`btn-primary${shown.danger ? " danger" : ""}`}
                onClick={() => handle(true)}
              >
                {shown.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext)!;
}
