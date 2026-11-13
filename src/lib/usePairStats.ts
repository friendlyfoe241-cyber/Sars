// Statistics for the instrument row (results table and graph), computed once
// per pair build (`PairDataset.instance`) and channel.  The caller passes the
// pair that is valid for the current selection (or null), so a new area,
// date pair or method can never expose numbers of a previous selection.

import { useMemo, useRef } from "react";
import {
  deltaHistogram,
  perDateStats,
  summarizeChange,
  type ChangeSummary,
  type DeltaHistogram,
  type PerDateStats,
} from "./changeDetection";
import type { PairDataset } from "./rasterSource";

export interface ChannelStats {
  change: ChangeSummary;
  dates: PerDateStats;
  /** DN-delta histogram (after − before), the same one the change summary uses */
  delta: DeltaHistogram;
  /** colour-scale saturation of the change layer (display DN) */
  saturation: number;
}

export interface AcquisitionRef {
  role: "before" | "after";
  productId: string;
  startTime: string;
}

export interface PairStats {
  instance: number;
  /** in the order the per-date statistics were computed (before, after); the graph orders by time */
  acquisitions: AcquisitionRef[];
  /** channels that are ready, in dataset order */
  channels: string[];
  unit: string;
  /** true when stored DN is the display value ("quicklook_dn") */
  displayDn: boolean;
  byChannel: Record<string, ChannelStats>;
}

interface Cache {
  instance: number;
  byChannel: Map<string, ChannelStats>;
}

export function usePairStats(pair: PairDataset | null): PairStats | null {
  const cacheRef = useRef<Cache | null>(null);
  return useMemo(() => {
    if (!pair) return null;
    if (cacheRef.current?.instance !== pair.instance) {
      cacheRef.current = { instance: pair.instance, byChannel: new Map() };
    }
    const cache = cacheRef.current;
    const { viewer } = pair;
    const channels = viewer.polarisations.filter((p) => pair.channelStatus[p] === "ready");
    const byChannel: Record<string, ChannelStats> = {};
    for (const ch of channels) {
      let stats = cache.byChannel.get(ch);
      if (!stats) {
        const r = pair.perPol[ch];
        if (!r) continue;
        try {
          stats = {
            change: summarizeChange(r.before.red, r.after.red, viewer.encoding, viewer.changeScale.unit),
            dates: perDateStats([r.before.red, r.after.red], viewer.encoding.nodata),
            delta: deltaHistogram(r.before.red, r.after.red, viewer.encoding.nodata),
            saturation: r.saturation,
          };
        } catch {
          continue;
        }
        cache.byChannel.set(ch, stats);
      }
      byChannel[ch] = stats;
    }
    const acquisitions: AcquisitionRef[] = [
      { role: "before", productId: viewer.earlier.productId, startTime: viewer.earlier.startTime },
      { role: "after", productId: viewer.later.productId, startTime: viewer.later.startTime },
    ];
    return {
      instance: pair.instance,
      acquisitions,
      channels: Object.keys(byChannel),
      unit: viewer.changeScale.unit,
      displayDn: viewer.encoding.type === "quicklook_dn",
      byChannel,
    };
  }, [pair]);
}
