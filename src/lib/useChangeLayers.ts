// Viewer rendering for the loaded pair: change statistics for the selected
// polarisation and the overlay image for the selected display layer.
//
// Only the layer actually on screen is rendered, and each rendered layer is
// kept (as a blob URL) for the lifetime of the pair, so switching between
// Before / After / Change or between polarisations is instant after the
// first view.  All URLs are revoked when the pair is replaced.

import { useEffect, useMemo, useState } from "react";
import { summarizeChange, type ChangeSummary } from "./changeDetection";
import { renderChange, renderObservation } from "./raster";
import type { PairDataset } from "./rasterSource";

export type DisplayLayer = "before" | "after" | "change";

interface OverlayCache {
  urls: Map<string, string>;
  disposed: boolean;
}

export interface ChangeLayers {
  summary: ChangeSummary | null;
  overlayUrl: string | null;
  rendering: boolean;
}

export function useChangeLayers(
  pair: PairDataset | null,
  pol: string,
  layer: DisplayLayer,
): ChangeLayers {
  const rasters = pair?.perPol[pol] ?? null;

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
  }, [pair, rasters]);

  // One cache per loaded pair.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cache = useMemo<OverlayCache>(() => ({ urls: new Map(), disposed: false }), [pair]);
  useEffect(() => {
    cache.disposed = false;
    return () => {
      cache.disposed = true;
      for (const url of cache.urls.values()) URL.revokeObjectURL(url);
      cache.urls.clear();
    };
  }, [cache]);

  const [shown, setShown] = useState<{ cache: OverlayCache; url: string } | null>(null);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    if (!pair || !rasters) {
      setRendering(false);
      return;
    }
    const key = `${pol}:${layer}`;
    const hit = cache.urls.get(key);
    if (hit) {
      setShown({ cache, url: hit });
      setRendering(false);
      return;
    }

    let cancelled = false;
    setRendering(true);
    const { encoding, changeScale } = pair.viewer;
    const job =
      layer === "change"
        ? renderChange(rasters.before, rasters.after, encoding, changeScale.saturation)
        : renderObservation(layer === "before" ? rasters.before : rasters.after, encoding);
    job.then(
      (url) => {
        if (cache.disposed || cache.urls.has(key)) {
          URL.revokeObjectURL(url);
        } else {
          cache.urls.set(key, url);
        }
        const ready = cache.urls.get(key);
        if (cancelled || !ready) return;
        setShown({ cache, url: ready });
        setRendering(false);
      },
      () => {
        if (!cancelled) setRendering(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [pair, rasters, pol, layer, cache]);

  return {
    summary,
    // Never expose an overlay that belongs to a previous pair.
    overlayUrl: shown && shown.cache === cache ? shown.url : null,
    rendering,
  };
}
