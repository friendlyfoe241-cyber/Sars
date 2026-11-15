import { useMemo, useRef } from "react";
import {
  deltaHistogram,
  perDateStats,
  summarizeFromHistogram,
  type ChangeSummary,
  type DeltaHistogram,
  type PerDateStats,
} from "./changeDetection";
import type { PairDataset } from "./rasterSource";

export interface ChannelStats {
  change: ChangeSummary;
  dates: PerDateStats;
  delta: DeltaHistogram;
  saturation: number;
}

export interface AcquisitionRef {
  role: "before" | "after";
  productId: string;
  startTime: string;
}

export interface PairStats {
  instance: number;
  acquisitions: AcquisitionRef[];
  channels: string[];
  unit: string;
  displayDn: boolean;
  byChannel: Record<string, ChannelStats>;
}

interface Cache {
  instance: number;
  byChannel: Map<string, ChannelStats>;
}

export function usePairStats(
  pair: PairDataset | null,
  channel: string,
  allChannels = false,
): PairStats | null {
  const cacheRef = useRef<Cache | null>(null);
  return useMemo(() => {
    if (!pair) return null;
    if (cacheRef.current?.instance !== pair.instance) {
      cacheRef.current = { instance: pair.instance, byChannel: new Map() };
    }
    const cache = cacheRef.current;
    const { viewer } = pair;
    const channels = viewer.polarisations.filter(
      (p) => pair.channelStatus[p] === "ready" && pair.perPol[p],
    );
    const wanted = allChannels ? channels : channels.filter((c) => c === channel);
    const byChannel: Record<string, ChannelStats> = {};
    for (const ch of wanted) {
      let stats = cache.byChannel.get(ch);
      if (!stats) {
        const r = pair.perPol[ch];
        try {
          const delta = deltaHistogram(r.before.red, r.after.red, viewer.encoding.nodata);
          stats = {
            change: summarizeFromHistogram(delta, viewer.encoding, viewer.changeScale.unit),
            dates: perDateStats([r.before.red, r.after.red], viewer.encoding.nodata),
            delta,
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
      channels,
      unit: viewer.changeScale.unit,
      displayDn: viewer.encoding.type === "quicklook_dn",
      byChannel,
    };
  }, [pair, channel, allChannels]);
}
