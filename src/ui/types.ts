/** The three primary destinations of the shell. */
export type Dest = "explore" | "compare" | "results";

export const DESTINATIONS: { id: Dest; label: string }[] = [
  { id: "explore", label: "Explore" },
  { id: "compare", label: "Compare" },
  { id: "results", label: "Results" },
];
