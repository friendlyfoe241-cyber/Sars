import { useEffect, useState } from "react";

export const MOTION_MS = 280;

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function usePresence(open: boolean): { mounted: boolean; leaving: boolean } {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  useEffect(() => {
    if (open || !mounted) return;
    const t = window.setTimeout(() => setMounted(false), prefersReducedMotion() ? 0 : MOTION_MS);
    return () => window.clearTimeout(t);
  }, [open, mounted]);
  return { mounted: open || mounted, leaving: mounted && !open };
}
