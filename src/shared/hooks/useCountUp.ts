import { useEffect, useRef, useState } from "react";

export function useCountUp(target: number, duration = 650): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef(0);
  const startRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    startRef.current = undefined;
    setValue(0);

    const tick = (now: number) => {
      startRef.current ??= now;
      const t = Math.min((now - startRef.current) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(eased * target));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return value;
}
