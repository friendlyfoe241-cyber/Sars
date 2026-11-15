import type { Aoi } from "./aoi";
import type { ChangeSummary } from "./changeDetection";
import type { PairDataset } from "./rasterSource";

export type PairState =
  | { status: "idle" }
  | { status: "loading"; key: string }
  | { status: "ready"; key: string; dataset: PairDataset }
  | {
      status: "error";
      key: string;
      message: string;
      metadataOnly: boolean;
    };

export const IDLE_PAIR: PairState = { status: "idle" };

export function selectCurrentPair(
  state: PairState,
  currentPairKey: string | null,
): PairDataset | null {
  return state.status === "ready" && currentPairKey !== null && state.dataset.key === currentPairKey
    ? state.dataset
    : null;
}

export type ViewState =
  | { kind: "choose-location"; hasAoi: boolean }
  | { kind: "searching" }
  | { kind: "no-observations" }
  | { kind: "no-compatible-pair" }
  | { kind: "choose-pair" }
  | { kind: "metadata-only"; message: string }
  | { kind: "loading-raster" }
  | { kind: "no-valid-pixels"; dataset: PairDataset; summary: ChangeSummary }
  | { kind: "ready"; dataset: PairDataset; summary: ChangeSummary }
  | { kind: "error"; source: "search" | "pair"; message: string };

export interface ViewStateInput {
  aoi: Aoi | null;
  searching: boolean;
  searched: boolean;
  searchError: string | null;
  sceneCount: number;
  suggestedPairCount: number;
  pairState: PairState;
  currentPairKey: string | null;
  activePair: PairDataset | null;
  summary: ChangeSummary | null;
}

export function deriveViewState(i: ViewStateInput): ViewState {
  if (!i.aoi) return { kind: "choose-location", hasAoi: false };
  if (i.searching) return { kind: "searching" };
  if (i.searchError) return { kind: "error", source: "search", message: i.searchError };

  const ps = i.pairState;
  if (ps.status !== "idle" && ps.key === i.currentPairKey) {
    if (ps.status === "loading") return { kind: "loading-raster" };
    if (ps.status === "error") {
      return ps.metadataOnly
        ? { kind: "metadata-only", message: ps.message }
        : { kind: "error", source: "pair", message: ps.message };
    }
    if (i.activePair) {
      if (!i.summary) {
        return {
          kind: "error",
          source: "pair",
          message: "Statistics could not be computed for this pair.",
        };
      }
      return i.summary.validPixels > 0
        ? { kind: "ready", dataset: i.activePair, summary: i.summary }
        : { kind: "no-valid-pixels", dataset: i.activePair, summary: i.summary };
    }
  }

  if (!i.searched) return { kind: "choose-location", hasAoi: true };
  if (i.sceneCount === 0) return { kind: "no-observations" };
  if (i.suggestedPairCount === 0) return { kind: "no-compatible-pair" };
  return { kind: "choose-pair" };
}
