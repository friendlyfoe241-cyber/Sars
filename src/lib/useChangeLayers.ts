import { useEffect, useMemo, useRef, useState } from "react";
import { renderChange, renderObservation } from "./raster";
import type { PairDataset } from "./rasterSource";

export type DisplayLayer = "before" | "after" | "change";

export type DisplayMode =
  | { mode: "single"; layer: DisplayLayer }
  | { mode: "swipe"; left: DisplayLayer; right: DisplayLayer };

export type DisplayChoice = "compare" | DisplayLayer;

export function layersForDisplay(display: DisplayMode): DisplayLayer[] {
  return display.mode === "single" ? [display.layer] : [display.left, display.right];
}

export type LayerUrls = Partial<Record<DisplayLayer, string>>;

interface OverlayCache {
  instance: number;
  urls: Map<string, string>;
  pending: Set<string>;
  failed: Set<string>;
  disposed: boolean;
  shown: { channel: string; url: string } | null;
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
  urls: LayerUrls;
  fallbackUrl: string | null;
  rendering: boolean;
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

  const instance = pair ? pair.instance : null;
  const cacheRef = useRef<OverlayCache | null>(null);
  if (instance === null) cacheRef.current = null;
  else if (cacheRef.current?.instance !== instance) cacheRef.current = newCache(instance);
  const cache = cacheRef.current;

  const [version, setVersion] = useState(0);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, rasters, channel, layerKey, version]);

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
