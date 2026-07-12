import { useRef, useState } from "react";
import { useToast } from "@shared/components/Toast";

export function useCopyButton(getText: () => string | Promise<string>) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const getTextRef = useRef(getText);
  getTextRef.current = getText;

  async function copy() {
    try {
      await navigator.clipboard.writeText(await getTextRef.current());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // A denied/failed clipboard write must not read as success — the green
      // check + "Copied" pill only fire on the resolved path above.
      toast("Couldn’t copy to clipboard", "error");
    }
  }

  return { copied, copy };
}
