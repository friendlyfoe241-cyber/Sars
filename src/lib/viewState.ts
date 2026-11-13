// What the viewer is showing, as one discriminated union, plus the single
// place where a loaded result is matched against the current selection.
// Pure: no DOM, no state.

import type { Aoi } from "./aoi";
import type { ChangeSummary } from "./changeDetection";
import type { PairDataset } from "./rasterSource";

/**
 * Loader state of the before/after pair.  Every non-idle variant carries the
 * pairKey() of the selection it belongs to.
 */
export type PairState =
  | { status: "idle" }
  | { status: "loading"; key: string }
  | { status: "ready"; key: string; dataset: PairDataset }
  | {
      status: "error";
      key: string;
      message: string;
      /** the pair was selected but its rasters cannot be provided */
      metadataOnly: boolean;
    };

export const IDLE_PAIR: PairState = { status: "idle" };

/**
 * The one consumer gate: a loaded dataset is returned only when it was built
 * for the current selection (same AOI, before/after ids and method version).
 */
export function selectCurrentPair(
  state: PairState,
  currentPairKey: string | null,
): PairDataset | null {
  return state.status === "ready" && currentPairKey !== null && state.dataset.key === currentPairKey
    ? state.dataset
    : null;
}

export type ViewState =
  /** no AOI yet, or an AOI that has not been searched */
  | { kind: "choose-location"; hasAoi: boolean }
  | { kind: "searching" }
  /** search finished (or failed) without usable scenes */
  | { kind: "no-observations" }
  /** scenes exist but nothing can be suggested as a comparison */
  | { kind: "no-compatible-pair" }
  /** scenes exist, pairs are suggested, none is loaded yet */
  | { kind: "choose-pair" }
  /** pair selected, rasters unavailable: scene metadata only */
  | { kind: "metadata-only"; message: string }
  | { kind: "loading-raster" }
  /** pair loaded but no pixel is valid in both observations */
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
  /** pairKey() of the current selection, null until a before and after are chosen */
  currentPairKey: string | null;
  /** result of selectCurrentPair() */
  activePair: PairDataset | null;
  /** statistics for the active pair and channel */
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
