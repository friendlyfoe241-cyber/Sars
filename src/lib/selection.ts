import type { Aoi } from "./aoi";

export const METHOD_VERSION = "quicklook-dn-diff-v1";

export interface Selection {
  aoi: Aoi;
  beforeId: string;
  afterId: string;
  channel: string;
  methodVersion: string;
}

export const KEY_BOUNDS_DECIMALS = 5;

function coord(v: number): string {
  return String(Math.round(v * 10 ** KEY_BOUNDS_DECIMALS) || 0);
}

export function aoiKey(aoi: Aoi): string {
  return `${coord(aoi.west)},${coord(aoi.south)},${coord(aoi.east)},${coord(aoi.north)}`;
}

export function pairKey(s: Omit<Selection, "channel">): string {
  return `${aoiKey(s.aoi)}|${s.beforeId}|${s.afterId}|${s.methodVersion}`;
}

export function selectionKey(s: Selection): string {
  return `${pairKey(s)}|${s.channel}`;
}

export function scenePairId(beforeId: string, afterId: string): string {
  return `${beforeId}|${afterId}`;
}
