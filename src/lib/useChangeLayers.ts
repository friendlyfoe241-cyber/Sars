// Viewer rendering for the loaded pair: change statistics for one channel and
// overlay images for any number of display layers at once.
//
// Callers pass the pair that is valid for the current selection (or null);
// this hook never invents or retains results of its own.  Everything it
// returns is derived synchronously from (pair, channel, layers), so a changed
// pair or channel can never expose the previous pair's or channel's overlay,
// not even for one frame.
//
// Only the requested layers are rendered, and each rendered layer is kept (as
// a blob URL) for the lifetime of the pair, per channel, so switching between
// Before / After / Change or between channels is instant after the first view.
// All URLs are revoked when the pair is replaced.

import { useEffect, useMemo, useState } from "react";
import { summarizeChange, type ChangeSummary } from "./changeDetection";
import { renderChange, renderObservation } from "./raster";
import type { PairDataset } from "./rasterSource";

export type DisplayLayer = "before" | "after" | "change";

interface OverlayCache {
  /** `${channel}:${layer}` -> blob URL */
  urls: Map<string, string>;
  pending: Set<string>;
  failed: Set<string>;
  disposed: boolean;
}

export type LayerUrls = Partial<Record<DisplayLayer, string>>;

export interface ChangeLayers {
  /** statistics for `channel`, or null (no pair, unknown channel, failure) */
  summary: ChangeSummary | null;
  /** blob URL per requested layer that is rendered; absent while rendering */
  urls: LayerUrls;
  /** true while any requested layer is still being rendered */
  rendering: boolean;
  /** change colour-scale saturation of `channel` (what the change layer uses), or null */
  saturation: number | null;
}

const EMPTY_URLS: LayerUrls = {};

export function useChangeLayers(
  pair: PairDataset | null,
  channel: string,
  layers: readonly DisplayLayer[],
): ChangeLayers {
  const rasters =
    pair && Object.prototype.hasOwnProperty.call(pair.perPol, channel)
      ? pair.perPol[channel]
      : null;
  const layerKey = layers.join(",");

  const summary = useMemo(() => {
    if (!pair || !rasters) return null;
    try {
      return summarizeChange(
        rasters.before.red,
        rasters.after.red,
        pair.viewer.encoding,
        pair.viewer.changeScale.unit,
      );
    } catch {
      return null;
    }
  }, [pair?.viewer, rasters]);

  // One cache per pair build.  Snapshots of the same build (channels
  // arriving) share it; a new build gets a fresh one.
  const cache = useMemo<OverlayCache>(
    () => ({ urls: new Map(), pending: new Set(), failed: new Set(), disposed: false }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pair?.instance],
  );
  // Bumped when a render finishes, so the derivation below re-runs.
  const [, setVersion] = useState(0);

  useEffect(() => {
    cache.disposed = false;
    return () => {
      cache.disposed = true;
      for (const url of cache.urls.values()) URL.revokeObjectURL(url);
      cache.urls.clear();
      cache.pending.clear();
      cache.failed.clear();
    };
  }, [cache]);

  useEffect(() => {
    if (!pair || !rasters) return;
    const { encoding } = pair.viewer;
    for (const layer of layerKey ? (layerKey.split(",") as DisplayLayer[]) : []) {
      const key = `${channel}:${layer}`;
      if (cache.urls.has(key) || cache.pending.has(key) || cache.failed.has(key)) continue;
      cache.pending.add(key);
      const job =
        layer === "change"
          ? renderChange(rasters.before, rasters.after, encoding, rasters.saturation)
          : renderObservation(layer === "before" ? rasters.before : rasters.after, encoding);
      job.then(
        (url) => {
          if (cache.disposed || cache.urls.has(key)) {
            URL.revokeObjectURL(url);
            return;
          }
          cache.pending.delete(key);
          cache.urls.set(key, url);
          setVersion((v) => v + 1);
        },
        () => {
          if (cache.disposed) return;
          cache.pending.delete(key);
          cache.failed.add(key);
          setVersion((v) => v + 1);
        },
      );
    }
  }, [pair, rasters, channel, layerKey, cache]);

  // Derived synchronously from the cache of the *current* pair.
  const urls: LayerUrls = {};
  let rendering = false;
  if (pair && rasters) {
    for (const layer of layerKey ? (layerKey.split(",") as DisplayLayer[]) : []) {
      const key = `${channel}:${layer}`;
      const url = cache.urls.get(key);
      if (url) urls[layer] = url;
      else if (!cache.failed.has(key)) rendering = true;
    }
  }
  return {
    summary,
    urls: Object.keys(urls).length > 0 ? urls : EMPTY_URLS,
    rendering,
    saturation: rasters ? rasters.saturation : null,
  };
}
