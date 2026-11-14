// Viewer rendering for the loaded pair: change statistics for one channel and
// overlay images for any number of display layers at once.
//
// Callers pass the pair that is valid for the current selection (or null);
// this hook never invents or retains results of its own.  Everything it
// returns is derived from (pair, channel, layers), so a changed pair or
// channel can never expose the previous pair's or channel's overlay, not even
// for one frame.  The one deliberate exception: while a newly requested layer
// of the SAME pair build and channel is still rendering, the previously shown
// layer is offered as `fallbackUrl` so the map does not blank.
//
// Only the requested layers are rendered, and each rendered layer is kept (as
// a blob URL) for the lifetime of the pair build, per channel, so switching
// between Before / After / Change or between channels is instant after the
// first view.  The cache lives in a ref keyed by the pair's build identity
// (`PairDataset.instance`, constant while channels arrive); all its URLs are
// revoked when the identity changes and on unmount.

import { useEffect, useMemo, useRef, useState } from "react";
import { renderChange, renderObservation } from "./raster";
import type { PairDataset } from "./rasterSource";

export type DisplayLayer = "before" | "after" | "change";

/** How the layers are presented on the map. */
export type DisplayMode =
  | { mode: "single"; layer: DisplayLayer }
  /** draggable divider: `left` shows left of it, `right` shows right of it */
  | { mode: "swipe"; left: DisplayLayer; right: DisplayLayer };

/** What the Display layer switch offers: the divider comparison or one layer. */
export type DisplayChoice = "compare" | DisplayLayer;

/** The layers a display mode needs rendered. */
export function layersForDisplay(display: DisplayMode): DisplayLayer[] {
  return display.mode === "single" ? [display.layer] : [display.left, display.right];
}

export type LayerUrls = Partial<Record<DisplayLayer, string>>;

interface OverlayCache {
  /** PairDataset.instance this cache belongs to */
  instance: number;
  /** `${channel}:${layer}` -> blob URL */
  urls: Map<string, string>;
  pending: Set<string>;
  failed: Set<string>;
  disposed: boolean;
  /** the overlay last shown for this pair build, and its channel */
  shown: { channel: string; url: string } | null;
  /** last returned urls object, reused while its contents are unchanged */
  lastUrls: LayerUrls | null;
}

function newCache(instance: number): OverlayCache {
  return {
    instance,
    urls: new Map(),
    pending: new Set(),
    failed: new Set(),
    disposed: false,
    shown: null,
    lastUrls: null,
  };
}

export interface ChangeLayers {
  /** blob URL per requested layer that is rendered; absent while rendering */
  urls: LayerUrls;
  /**
   * While a requested layer of the same pair and channel is rendering: the
   * URL of the layer shown before it.  Null otherwise (never across pairs
   * or channels).
   */
  fallbackUrl: string | null;
  /** true while any requested layer is still being rendered */
  rendering: boolean;
  /** change colour-scale saturation of `channel` (what the change layer uses), or null */
  saturation: number | null;
}

const EMPTY_URLS: LayerUrls = {};

function sameUrls(a: LayerUrls, b: LayerUrls): boolean {
  const keys = Object.keys(b) as DisplayLayer[];
  return Object.keys(a).length === keys.length && keys.every((k) => a[k] === b[k]);
}

export function useChangeLayers(
  pair: PairDataset | null,
  channel: string,
  layers: readonly DisplayLayer[],
): ChangeLayers {
  const rasters =
    pair && Object.prototype.hasOwnProperty.call(pair.perPol, channel)
      ? pair.perPol[channel]
      : null;
  const viewer = pair ? pair.viewer : null;
  const layerKey = layers.join(",");

  // One cache per pair build, held in a ref and replaced when the build
  // identity changes.  Creating it here is idempotent (StrictMode renders
  // twice); the URLs it holds are created and revoked only in effects.
  const instance = pair ? pair.instance : null;
  const cacheRef = useRef<OverlayCache | null>(null);
  if (instance === null) cacheRef.current = null;
  else if (cacheRef.current?.instance !== instance) cacheRef.current = newCache(instance);
  const cache = cacheRef.current;

  // Bumped when a render finishes, so the derivation below re-runs.
  const [version, setVersion] = useState(0);

  // Ownership: runs again (cleanup first) when the build changes, and on
  // unmount.  StrictMode's mount -> cleanup -> mount leaves the cache usable.
  useEffect(() => {
    if (!cache) return;
    cache.disposed = false;
    return () => {
      cache.disposed = true;
      for (const url of cache.urls.values()) URL.revokeObjectURL(url);
      cache.urls.clear();
      cache.pending.clear();
      cache.failed.clear();
      cache.shown = null;
      cache.lastUrls = null;
    };
  }, [cache]);

  useEffect(() => {
    if (!cache || !viewer || !rasters) return;
    const { encoding } = viewer;
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
  }, [cache, viewer, rasters, channel, layerKey]);

  // Rendered layers of the current pair build and channel; the object is
  // reused until its contents change.
  const urls = useMemo<LayerUrls>(() => {
    if (!cache || !rasters) return EMPTY_URLS;
    const built: LayerUrls = {};
    for (const layer of layerKey ? (layerKey.split(",") as DisplayLayer[]) : []) {
      const url = cache.urls.get(`${channel}:${layer}`);
      if (url) built[layer] = url;
    }
    if (Object.keys(built).length === 0) return EMPTY_URLS;
    if (cache.lastUrls && sameUrls(cache.lastUrls, built)) return cache.lastUrls;
    cache.lastUrls = built;
    return built;
    // `version` signals changes inside the cache
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, rasters, channel, layerKey, version]);

  // Remember what is on screen, to bridge the next layer switch.
  useEffect(() => {
    if (!cache) return;
    for (const layer of layerKey ? (layerKey.split(",") as DisplayLayer[]) : []) {
      const url = urls[layer];
      if (url) {
        cache.shown = { channel, url };
        return;
      }
    }
  }, [cache, channel, layerKey, urls]);

  let rendering = false;
  if (cache && rasters) {
    for (const layer of layerKey ? (layerKey.split(",") as DisplayLayer[]) : []) {
      const key = `${channel}:${layer}`;
      if (!cache.urls.has(key) && !cache.failed.has(key)) rendering = true;
    }
  }
  const fallbackUrl =
    rendering && urls === EMPTY_URLS && cache?.shown?.channel === channel
      ? cache.shown.url
      : null;

  return {
    urls,
    fallbackUrl,
    rendering,
    saturation: rasters ? rasters.saturation : null,
  };
}
