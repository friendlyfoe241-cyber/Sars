export type StepId = "locate" | "scenes" | "pairs" | "change" | "explain";

export interface Step {
  id: StepId;
  label: string;
  /** id of the sidebar element the step scrolls to */
  anchor: string;
  /** shown when the step has nothing to show yet */
  locked: string;
}

export const STEPS: Step[] = [
  { id: "locate", label: "Locate", anchor: "step-locate", locked: "" },
  {
    id: "scenes",
    label: "Scenes",
    anchor: "step-scenes",
    locked: "Search the catalogue for an area first to list NISAR scenes.",
  },
  {
    id: "pairs",
    label: "Pairs",
    anchor: "step-pairs",
    locked: "Pairs appear once a catalogue search returns compatible scenes.",
  },
  {
    id: "change",
    label: "Change",
    anchor: "step-change",
    locked: "Load a before/after pair to open the change viewer.",
  },
  {
    id: "explain",
    label: "Explain",
    anchor: "step-explain",
    locked: "Load a pair first; the AI explainer reads its change statistics.",
  },
];
