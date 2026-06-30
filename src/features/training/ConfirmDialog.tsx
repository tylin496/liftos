import { useCallback, useContext, useState, createContext } from "react";
import type { ReactNode } from "react";

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

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {dialog && (
        <div className="confirm-overlay" onClick={() => handle(false)}>
          <div
            className="confirm-dialog"
            role="alertdialog"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="confirm-msg">{dialog.msg}</p>
            <div className="confirm-actions">
              <button className="btn-ghost" onClick={() => handle(false)}>
                Cancel
              </button>
              <button
                className={`btn-primary${dialog.danger ? " danger" : ""}`}
                onClick={() => handle(true)}
              >
                {dialog.confirmLabel}
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
