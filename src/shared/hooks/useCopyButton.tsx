import { useRef, useState } from "react";

export function useCopyButton(getText: () => string | Promise<string>) {
  const [copied, setCopied] = useState(false);
  const getTextRef = useRef(getText);
  getTextRef.current = getText;

  async function copy() {
    try {
      await navigator.clipboard.writeText(await getTextRef.current());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // silently fail
    }
  }

  return { copied, copy };
}
