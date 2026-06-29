import { useEffect, useRef, useState } from "react";
import { useHeaderAction } from "@app/layout/HeaderActionContext";
import { CopyIcon, CheckIcon } from "@shared/components/CopyIcon";
import "./copyButton.css";

export function useCopyButton(getText: () => string | Promise<string>) {
  const { setAction } = useHeaderAction();
  const [copied, setCopied] = useState(false);
  const getTextRef = useRef(getText);
  getTextRef.current = getText;

  useEffect(() => {
    async function handleCopy() {
      try {
        await navigator.clipboard.writeText(await getTextRef.current());
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // silently fail
      }
    }

    setAction(
      <button type="button" className="hdr-copy-btn" onClick={handleCopy} title="Copy summary">
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>,
    );
    return () => setAction(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copied]);
}
