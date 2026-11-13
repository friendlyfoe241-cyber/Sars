// The single identity of "what the user is looking at".  Everything shown
// next to the map (overlay, statistics, observation info, AI explanation) is
// produced for exactly one Selection, and is displayed only while its key
// equals the key of the current selection.  Pure: no DOM, no state.

import type { Aoi } from "./aoi";

/**
 * Identifies the change method that produced a result.  Bump it whenever the
 * maths or rendering changes meaning, so cached/derived results from an older
 * method can never be matched to a new selection.
 *   quicklook-dn-diff-v1: after − before of the 8-bit ASF browse quicklook
 *   display DN, resampled to the AOI grid; nodata (0) excluded.
 */
export const METHOD_VERSION = "quicklook-dn-diff-v1";

export interface Selection {
  /** area of interest (WGS84 bounds) the result was computed for */
  aoi: Aoi;
  /** product id of the earlier scene */
  beforeId: string;
  /** product id of the later scene */
  afterId: string;
  /** polarisation channel, e.g. "HH" */
  channel: string;
  methodVersion: string;
}

/** Decimal places kept for bounds in keys (1e-5 deg is roughly 1 m). */
export const KEY_BOUNDS_DECIMALS = 5;

function coord(v: number): string {
  // integer micro-units: no "-0", no float formatting differences
  return String(Math.round(v * 10 ** KEY_BOUNDS_DECIMALS) || 0);
}

/** Stable key for an AOI, rounded to KEY_BOUNDS_DECIMALS. */
export function aoiKey(aoi: Aoi): string {
  return `${coord(aoi.west)},${coord(aoi.south)},${coord(aoi.east)},${coord(aoi.north)}`;
}

/**
 * Key of everything except the channel.  A PairDataset holds every shared
 * channel, so it is stamped with this key; the channel is resolved
 * afterwards (useChangeLayers only returns data for a channel the dataset
 * actually holds).
 */
export function pairKey(s: Omit<Selection, "channel">): string {
  return `${aoiKey(s.aoi)}|${s.beforeId}|${s.afterId}|${s.methodVersion}`;
}

/** Full selection key: pair identity plus channel. */
export function selectionKey(s: Selection): string {
  return `${pairKey(s)}|${s.channel}`;
}

/** Key of an ordered scene pair irrespective of AOI (for lists of pairs). */
export function scenePairId(beforeId: string, afterId: string): string {
  return `${beforeId}|${afterId}`;
}
