import { useSyncExternalStore } from "react";

/** wide >=1280, mid 1024-1279, tablet 768-1023, phone <768 (see styles/shell.css). */
export type LayoutMode = "wide" | "mid" | "tablet" | "phone";

const QUERIES = [
  ["wide", "(min-width: 1280px)"],
  ["mid", "(min-width: 1024px)"],
  ["tablet", "(min-width: 768px)"],
] as const;

function read(): LayoutMode {
  for (const [mode, q] of QUERIES) if (window.matchMedia(q).matches) return mode;
  return "phone";
}

function subscribe(cb: () => void): () => void {
  const lists = QUERIES.map(([, q]) => window.matchMedia(q));
  lists.forEach((l) => l.addEventListener("change", cb));
  return () => lists.forEach((l) => l.removeEventListener("change", cb));
}

export function useLayoutMode(): LayoutMode {
  return useSyncExternalStore(subscribe, read, () => "wide" as LayoutMode);
}
