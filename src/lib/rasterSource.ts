// Raster acquisition and processing: turns discovered NISAR scenes into the
// same raster model the viewer has always used (greyscale grids + encoding +
// bounds), so rendering, change detection and statistics are unchanged.
//
// Two sources are supported:
//   * public ASF browse quicklooks (no authentication) resampled to the AOI;
//   * a locally prepared dataset (public/data, see scripts/) — used when the
//     selected pair was already prepared, e.g. calibrated dB rasters.
//
// Calibrated GCOV rasters for new areas are prepared offline with
// scripts/prepare_nisar_gcov.py (Earthdata login, Harmony subsetting or
// lazy HDF5 reads); the browser never downloads large products.

import { abortError, isAbortError, throwIfAborted } from "./abort";
import type { Aoi } from "./aoi";
import { computeSaturation } from "./changeDetection";
import type {
  PreparedDataset,
  RasterAvailability,
  RasterEncoding,
  ViewerDataset,
} from "./data";
import { layerLabel, rasterUrl } from "./data";
import type { NisarScene } from "./discovery";
import { loadRaster, type Raster } from "./raster";
import { METHOD_VERSION, aoiKey, pairKey } from "./selection";

export const QUICKLOOK_ENCODING: RasterEncoding = {
  type: "quicklook_dn",
  unit: "display DN",
  nodata: 0,
  description:
    "8-bit ASF browse quicklook rendering of the GCOV polarimetric layers; monotonic with calibrated backscatter under the shared quicklook rendering. 0 marks nodata / outside the observation footprint.",
};

export const DEFAULT_OUTPUT_WIDTH = 768;

// ---------------------------------------------------------------------------
// Georeferencing: quicklook KML ground-overlay quads
// ---------------------------------------------------------------------------

export interface Quad {
  sw: [number, number];
  se: [number, number];
  ne: [number, number];
  nw: [number, number];
}

export function parseKmlQuad(kmlText: string): Quad {
  const m = /<coordinates>([\s\S]*?)<\/coordinates>/.exec(kmlText);
  if (!m) throw new Error("No coordinates found in KML.");
  const pts = m[1]
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [lon, lat] = pair.split(",").map(Number);
      return [lon, lat] as [number, number];
    })
    .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
  if (pts.length !== 4) throw new Error(`Expected 4 KML corners, got ${pts.length}.`);
  // Assign corners by position so KML ordering conventions do not matter.
  const byLat = [...pts].sort((a, b) => a[1] - b[1]);
  const [s1, s2, n1, n2] = byLat;
  const [sw, se] = s1[0] <= s2[0] ? [s1, s2] : [s2, s1];
  const [nw, ne] = n1[0] <= n2[0] ? [n1, n2] : [n2, n1];
  return { sw, se, ne, nw };
}

const CORNERS = ["sw", "se", "ne", "nw"] as const;

export function quadsAgree(a: Quad, b: Quad, toleranceDeg = 1e-4): boolean {
  return CORNERS.every(
    (k) =>
      Math.abs(a[k][0] - b[k][0]) <= toleranceDeg &&
      Math.abs(a[k][1] - b[k][1]) <= toleranceDeg,
  );
}

export function quadFromBounds(bounds: { west: number; south: number; east: number; north: number }): Quad {
  return {
    sw: [bounds.west, bounds.south],
    se: [bounds.east, bounds.south],
    ne: [bounds.east, bounds.north],
    nw: [bounds.west, bounds.north],
  };
}

// ---------------------------------------------------------------------------
// Resampling onto the AOI grid (inverse bilinear mapping)
// ---------------------------------------------------------------------------

/**
 * Nearest-neighbour lookup table from AOI grid pixels to source pixels:
 * index[i] is the offset into the source raster, or -1 outside it.  Built
 * once per pair and shared by every raster on the same source grid.
 */
export interface SampleIndex {
  width: number;
  height: number;
  index: Int32Array;
}

export function outputHeightFor(aoi: Aoi, outWidth: number): number {
  const midLat = ((aoi.south + aoi.north) / 2) * (Math.PI / 180);
  const lonSpanKm = (aoi.east - aoi.west) * 111.32 * Math.max(0.2, Math.cos(midLat));
  const latSpanKm = (aoi.north - aoi.south) * 111.32;
  return Math.max(1, Math.round((outWidth * latSpanKm) / lonSpanKm));
}

const NEWTON_MAX_ITERATIONS = 6;
/** stop refining once the (u, v) correction is far below one source pixel */
const NEWTON_TOLERANCE = 1e-10;

export function buildSampleIndex(
  quad: Quad,
  aoi: Aoi,
  outWidth: number,
  srcWidth: number,
  srcHeight: number,
): SampleIndex {
  const width = outWidth;
  const height = outputHeightFor(aoi, outWidth);
  const index = new Int32Array(width * height);
  const { sw, se, ne, nw } = quad;

  // Bilinear map P(u, v) = sw + u*E + v*F + u*v*G.  G is zero for a
  // parallelogram, where the affine start below is already exact.
  const ex = se[0] - sw[0];
  const ey = se[1] - sw[1];
  const fx = nw[0] - sw[0];
  const fy = nw[1] - sw[1];
  const gx = ne[0] - nw[0] - ex;
  const gy = ne[1] - nw[1] - ey;
  const det = ex * fy - fx * ey;

  const lonStep = (aoi.east - aoi.west) / (width - 1 || 1);
  const latStep = (aoi.north - aoi.south) / (height - 1 || 1);
  const maxX = srcWidth - 1;
  const maxY = srcHeight - 1;

  let i = 0;
  for (let r = 0; r < height; r++) {
    const dy = aoi.north - latStep * r - sw[1];
    for (let c = 0; c < width; c++, i++) {
      const dx = aoi.west + lonStep * c - sw[0];
      // Affine initialisation (the quads are near-parallelograms).
      let u = (dx * fy - dy * fx) / det;
      let v = (ex * dy - ey * dx) / det;
      // Newton refinement against the bilinear mapping.
      for (let it = 0; it < NEWTON_MAX_ITERATIONS; it++) {
        const dPdu0 = ex + v * gx;
        const dPdu1 = ey + v * gy;
        const dPdv0 = fx + u * gx;
        const dPdv1 = fy + u * gy;
        const detJ = dPdu0 * dPdv1 - dPdu1 * dPdv0;
        if (detJ === 0) break;
        const rx = dx - (u * ex + v * fx + u * v * gx);
        const ry = dy - (u * ey + v * fy + u * v * gy);
        const du = (rx * dPdv1 - ry * dPdv0) / detJ;
        const dv = (dPdu0 * ry - dPdu1 * rx) / detJ;
        u += du;
        v += dv;
        if (Math.abs(du) + Math.abs(dv) < NEWTON_TOLERANCE) break;
      }
      const px = u * maxX;
      const py = (1 - v) * maxY;
      index[i] =
        px >= 0 && px <= maxX && py >= 0 && py <= maxY
          ? Math.round(py) * srcWidth + Math.round(px)
          : -1;
    }
  }
  return { width, height, index };
}

/** Resample a source raster onto the AOI grid using a shared sample index. */
export function sampleToGrid(src: Raster, map: SampleIndex): Raster {
  const { index } = map;
  const red = new Uint8ClampedArray(index.length); // 0 = nodata
  const srcRed = src.red;
  for (let i = 0; i < index.length; i++) {
    const s = index[i];
    if (s >= 0) red[i] = srcRed[s]; // 0 (nodata) is preserved
  }
  return { width: map.width, height: map.height, red };
}

// ---------------------------------------------------------------------------
// Quicklook acquisition (public ASF browse artefacts, no authentication)
// ---------------------------------------------------------------------------

// Small LRU of in-flight / completed loads.  Decoded rasters are large, so
// the cache is bounded; failed loads are evicted so a transient network
// error can be retried instead of being remembered for the whole session.
//
// Loads are shared between callers, so cancelling is reference counted: a
// caller's AbortSignal detaches that caller immediately, and the underlying
// fetch is aborted (and evicted) only when no caller is still waiting for it.
// The abort decision is deferred by a microtask, so a caller that aborts its
// old load and immediately starts a new one for the same resource (pair
// A,B -> B,C, or re-selecting the same pair) re-attaches in time and the
// shared fetch survives.  Callers that pass no signal pin the entry (it is
// never aborted).
const FETCH_CACHE_LIMIT = 32;

interface CacheEntry<T> {
  promise: Promise<T>;
  controller: AbortController;
  refs: number;
  settled: boolean;
}
const fetchCache = new Map<string, CacheEntry<unknown>>();

function cached<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  // Never start (or join) work on behalf of a caller that is already gone.
  if (signal?.aborted) return Promise.reject(abortError());
  let entry = fetchCache.get(key) as CacheEntry<T> | undefined;
  if (entry) {
    fetchCache.delete(key);
    fetchCache.set(key, entry); // mark as most recently used
  } else {
    const controller = new AbortController();
    const created: CacheEntry<T> = {
      promise: load(controller.signal),
      controller,
      refs: 0,
      settled: false,
    };
    entry = created;
    fetchCache.set(key, created);
    created.promise.then(
      () => {
        created.settled = true;
      },
      () => {
        created.settled = true;
        if (fetchCache.get(key) === created) fetchCache.delete(key);
      },
    );
    if (fetchCache.size > FETCH_CACHE_LIMIT) {
      const oldest = fetchCache.keys().next().value;
      if (oldest !== undefined) fetchCache.delete(oldest);
    }
  }

  const e = entry;
  if (!signal) {
    e.refs++; // pinned: never aborted on behalf of another caller
    return e.promise;
  }
  e.refs++;
  return new Promise<T>((resolve, reject) => {
    const detach = () => {
      e.refs--;
      if (e.refs <= 0 && !e.settled) {
        // Decide after the current synchronous run: a replacement caller
        // that attaches meanwhile keeps the fetch alive.
        queueMicrotask(() => {
          if (e.refs <= 0 && !e.settled) {
            e.controller.abort();
            if (fetchCache.get(key) === e) fetchCache.delete(key);
          }
        });
      }
    };
    const onAbort = () => {
      detach();
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    e.promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

type SceneStatus = { sceneId: string; status: RasterAvailability };

export class RasterUnavailableError extends Error {
  constructor(
    message: string,
    public readonly sceneStatus: SceneStatus[],
  ) {
    super(message);
    this.name = "RasterUnavailableError";
  }
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

/**
 * Georeferencing KML of a scene, fetched once per scene (every channel's KML
 * describes the same geometry).  `preferPol`'s file is tried first, then the
 * scene's other channels.
 */
function loadSceneKml(scene: NisarScene, preferPol: string, signal?: AbortSignal): Promise<string> {
  return cached(
    `kml:${scene.id}`,
    async (sig) => {
      const ordered = Object.entries(scene.quicklooks.kml).sort(
        ([a], [b]) => Number(b === preferPol) - Number(a === preferPol),
      );
      for (const [, url] of ordered) {
        try {
          return await fetchText(url, sig);
        } catch (err) {
          if (isAbortError(err) || sig.aborted) throw err;
          /* try the next channel's KML */
        }
      }
      throw new Error(`No georeferencing KML for ${scene.id}.`);
    },
    signal,
  );
}

/** Decoded source quicklook PNG of one scene and channel (native grid). */
function loadSourceRaster(scene: NisarScene, pol: string, signal?: AbortSignal): Promise<Raster> {
  return cached(
    `ql:${scene.id}:${pol}`,
    async (sig) => {
      const pngUrl = scene.quicklooks.png[pol];
      if (!pngUrl) throw new Error(`No quicklook for ${pol}.`);
      return loadRaster(pngUrl, sig);
    },
    signal,
  );
}

// ---------------------------------------------------------------------------
// Scene grids: one scene + channel resampled onto an AOI grid
// ---------------------------------------------------------------------------

const SAMPLE_INDEX_LIMIT = 8;
const sampleIndexCache = new Map<string, SampleIndex>();

function quadKey(quad: Quad): string {
  return CORNERS.map((k) => `${quad[k][0]},${quad[k][1]}`).join(";");
}

/**
 * Sample index for a quad, source size and AOI grid.  Every channel of a
 * scene (same KML, same source size) shares one index.
 */
export function sampleIndexFor(
  quad: Quad,
  aoi: Aoi,
  outWidth: number,
  srcWidth: number,
  srcHeight: number,
): SampleIndex {
  const key = `${quadKey(quad)}|${srcWidth}x${srcHeight}|${aoiKey(aoi)}|${outWidth}`;
  let map = sampleIndexCache.get(key);
  if (map) {
    sampleIndexCache.delete(key);
  } else {
    map = buildSampleIndex(quad, aoi, outWidth, srcWidth, srcHeight);
    if (sampleIndexCache.size >= SAMPLE_INDEX_LIMIT) {
      const oldest = sampleIndexCache.keys().next().value;
      if (oldest !== undefined) sampleIndexCache.delete(oldest);
    }
  }
  sampleIndexCache.set(key, map);
  return map;
}

interface SceneGrid {
  raster: Raster;
  /** georeferencing the grid was resampled with */
  quad: Quad;
}

function loadSceneGridEntry(
  scene: NisarScene,
  pol: string,
  aoi: Aoi,
  outWidth: number,
  signal?: AbortSignal,
): Promise<SceneGrid> {
  return cached(
    `grid:${scene.id}|${pol}|${aoiKey(aoi)}|${outWidth}|${METHOD_VERSION}`,
    async (sig) => {
      const [src, kmlText] = await Promise.all([
        loadSourceRaster(scene, pol, sig),
        loadSceneKml(scene, pol, sig),
      ]);
      const quad = parseKmlQuad(kmlText);
      const index = sampleIndexFor(quad, aoi, outWidth, src.width, src.height);
      return { raster: sampleToGrid(src, index), quad };
    },
    signal,
  );
}

/**
 * One scene's quicklook for one channel, resampled onto the AOI grid
 * (outWidth x outputHeightFor(aoi, outWidth); 0 = nodata).  Independent of
 * any pair: results are cached per scene, channel, AOI, width and method
 * version, and are shared with every caller that asks for the same grid.
 */
export function loadSceneGrid(
  scene: NisarScene,
  pol: string,
  aoi: Aoi,
  outWidth: number,
  signal?: AbortSignal,
): Promise<Raster> {
  return loadSceneGridEntry(scene, pol, aoi, outWidth, signal).then((g) => g.raster);
}

/**
 * Can the scene metadata alone tell that no quicklook can be fetched?  True
 * when none of the scene's own channels has a quicklook URL (discovery fills
 * the deterministic browse URL for HH/HV/VV/VH, so this only catches other
 * channel sets).  This is a static check; it never touches the network.
 */
export function sceneHasQuicklook(scene: NisarScene): boolean {
  return scene.polarisations.some((pol) => Boolean(scene.quicklooks.png[pol]));
}

/**
 * Static raster availability of a pair, decided from scene metadata and the
 * prepared dataset only (no network): "metadata-only" when the two scenes
 * share no channel with a quicklook on both sides and no prepared dataset
 * covers the pair.
 */
export function pairQuicklookStatus(
  before: NisarScene,
  after: NisarScene,
  prepared?: PreparedDataset | null,
): "available" | "metadata-only" {
  if (prepared && prepared.beforeId === before.id && prepared.afterId === after.id) {
    return "available";
  }
  const usable = commonPolarisations(before, after).some(
    (pol) => before.quicklooks.png[pol] && after.quicklooks.png[pol],
  );
  return usable ? "available" : "metadata-only";
}

// ---------------------------------------------------------------------------
// Pair assembly
// ---------------------------------------------------------------------------

export type ChannelStatus = "ready" | "loading" | "unavailable";

/** One channel's rasters on the AOI grid. */
export interface ChannelRasters {
  before: Raster;
  after: Raster;
  /** change colour-scale saturation (in the encoding's unit) for this channel */
  saturation: number;
}

export interface PairDataset {
  viewer: ViewerDataset;
  /** grid bounds (equal to the AOI this dataset was built for) */
  bounds: Aoi;
  /** product ids of the scenes this dataset was built from */
  beforeId: string;
  afterId: string;
  /**
   * pairKey() of the selection this dataset was built for: AOI bounds,
   * before/after ids and METHOD_VERSION, but not the channel.  It is
   * displayed only while it equals the key of the current selection.
   */
  key: string;
  /**
   * Identity of one build.  Constant across the snapshots of a build (which
   * differ only in `perPol` / `channelStatus` as channels arrive), different
   * for every new build, even of the same selection.
   */
  instance: number;
  /** rasters of the channels that are ready; a channel absent here has none */
  perPol: Record<string, ChannelRasters>;
  /** state of every candidate channel (`viewer.polarisations`) */
  channelStatus: Record<string, ChannelStatus>;
}

const QUICKLOOK_LIMITATIONS = (gridPixelM: number) => [
  "Displayed values are 8-bit quicklook renderings (display DN), not calibrated backscatter in dB.",
  "The change layer is a difference of those display values; it preserves the sign of change under the shared quicklook rendering but its magnitude is not sigma0.",
  `Source quicklooks are about 180 m per pixel and are resampled to the AOI grid (${gridPixelM} m per pixel).`,
  "Calibrated sigma0/dB rasters require the GCOV products (Earthdata login); see scripts/prepare_nisar_gcov.py.",
];

function baselineDays(a: string, b: string): number {
  return Math.round(Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000);
}

function commonPolarisations(before: NisarScene, after: NisarScene): string[] {
  return before.polarisations.filter((p) => after.polarisations.includes(p));
}

function acquisitionFromScene(scene: NisarScene) {
  return {
    productId: scene.id,
    startTime: scene.startTime,
    stopTime: scene.stopTime,
    orbit: scene.orbit,
    pathNumber: scene.track,
    frameNumber: scene.frame,
    flightDirection: scene.orbitDirection,
    polarisations: scene.polarisations,
    collectionName: scene.collection,
    processingLevel: scene.processingLevel,
    processingSoftwareVersion: scene.pgeVersion,
    crid: scene.crid,
  };
}

export interface BuildPairOptions {
  before: NisarScene;
  after: NisarScene;
  aoi: Aoi;
  /** locally prepared dataset (example / calibrated), if it covers this pair */
  prepared?: PreparedDataset | null;
  areaLabel: string;
  outputWidth?: number;
  /** channel to load first; the first available channel is used otherwise */
  channel?: string;
  /**
   * Called with a new snapshot of the dataset (same `key` and `instance`)
   * whenever a channel that was still loading becomes ready or unavailable.
   * Never called after `signal` aborts.
   */
  onChannelUpdate?: (dataset: PairDataset) => void;
  /** abort to drop the load; rejects with an AbortError */
  signal?: AbortSignal;
}

let nextInstance = 0;

/**
 * Assemble the viewer dataset for a selected observation pair over an AOI.
 * Prefers locally prepared (possibly calibrated) rasters; otherwise the
 * public quicklooks, via loadSceneGrid.  Resolves as soon as one channel (the
 * requested one, else the first that loads) is ready; the other shared
 * channels keep loading and are delivered through `onChannelUpdate`.  Throws
 * RasterUnavailableError when no raster can be prepared, so callers can show
 * metadata and a processing status instead.
 */
export async function buildPairDataset(opts: BuildPairOptions): Promise<PairDataset> {
  const { before, after, aoi, areaLabel, signal } = opts;
  throwIfAborted(signal);
  const outWidth = opts.outputWidth ?? DEFAULT_OUTPUT_WIDTH;
  const metadataOnly = (): SceneStatus[] => [
    { sceneId: before.id, status: "metadata-only" },
    { sceneId: after.id, status: "metadata-only" },
  ];

  const shared = commonPolarisations(before, after);
  if (shared.length === 0) {
    throw new RasterUnavailableError(
      "The two scenes share no polarisation channel, so they cannot be compared.",
      metadataOnly(),
    );
  }

  const prepared = opts.prepared ?? null;
  const preparedMatches =
    prepared !== null &&
    prepared.beforeId === before.id &&
    prepared.afterId === after.id;

  let channels: string[]; // candidate channels, in scene order
  let loadChannel: (pol: string) => Promise<Omit<ChannelRasters, "saturation">>;
  let encoding: RasterEncoding = QUICKLOOK_ENCODING;
  let limitations: string[];
  let source: string;

  if (preparedMatches) {
    const { manifest } = prepared;
    const quad = quadFromBounds(manifest.studyArea.bounds);
    encoding = manifest.encoding;
    channels = shared.filter((pol) => manifest.rasters[pol]);
    if (channels.length === 0) {
      throw new RasterUnavailableError(
        "The prepared dataset has no rasters for the shared polarisation channels.",
        metadataOnly(),
      );
    }
    const resample = (src: Raster): Raster =>
      sampleToGrid(src, sampleIndexFor(quad, aoi, outWidth, src.width, src.height));
    loadChannel = async (pol) => {
      const entry = manifest.rasters[pol];
      const [b, a] = await Promise.all(
        [entry.before, entry.after].map((path) => {
          const url = rasterUrl(path);
          return cached(`prepared:${url}`, (sig) => loadRaster(url, sig), signal);
        }),
      );
      return { before: resample(b), after: resample(a) };
    };
    limitations = manifest.dataset.limitations;
    source = manifest.dataset.source;
  } else {
    channels = shared.filter((pol) => before.quicklooks.png[pol] && after.quicklooks.png[pol]);
    if (channels.length === 0) {
      throw new RasterUnavailableError(
        "Quicklook rasters for this pair are not available. Scene metadata is shown instead of a comparison.",
        metadataOnly(),
      );
    }
    loadChannel = async (pol) => {
      const [b, a] = await Promise.all([
        loadSceneGridEntry(before, pol, aoi, outWidth, signal),
        loadSceneGridEntry(after, pol, aoi, outWidth, signal),
      ]);
      if (!quadsAgree(b.quad, a.quad)) {
        throw new Error("The two quicklooks have different georeferencing.");
      }
      return { before: b.raster, after: a.raster };
    };
    source =
      "NASA/ISRO NISAR L2 GCOV (geocoded observables), archived by NASA ASF DAAC — ASF browse quicklooks";
    const gridPixelM =
      ((aoi.east - aoi.west) * 111320 * Math.cos(((aoi.south + aoi.north) / 2) * (Math.PI / 180))) /
      outWidth;
    limitations = QUICKLOOK_LIMITATIONS(Math.round(gridPixelM));
  }

  const perPol: PairDataset["perPol"] = {};
  const channelStatus: Record<string, ChannelStatus> = {};
  for (const pol of channels) channelStatus[pol] = "loading";
  let lastError: unknown;

  /** Load one channel into the shared state; throws only on abort. */
  const attempt = async (pol: string): Promise<boolean> => {
    try {
      const loaded = await loadChannel(pol);
      throwIfAborted(signal);
      perPol[pol] = {
        ...loaded,
        saturation: computeSaturation(loaded.before.red, loaded.after.red, encoding),
      };
      channelStatus[pol] = "ready";
      return true;
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) throw err;
      channelStatus[pol] = "unavailable";
      lastError = err;
      return false;
    }
  };

  // The requested channel first; if it cannot be loaded, the next ones in
  // order until one works.  Channels not needed for that stay untouched.
  const preferred = opts.channel && channels.includes(opts.channel) ? opts.channel : undefined;
  const order = preferred ? [preferred, ...channels.filter((p) => p !== preferred)] : channels;
  let first: string | null = null;
  for (const pol of order) {
    if (await attempt(pol)) {
      first = pol;
      break;
    }
  }
  throwIfAborted(signal);
  if (first === null) {
    if (preparedMatches) throw lastError;
    throw new RasterUnavailableError(
      "Quicklook rasters for this pair are not available. Scene metadata is shown instead of a comparison.",
      metadataOnly(),
    );
  }

  const calibrated = encoding.type === "db_linear";
  const layers: Record<string, string> = {};
  for (const pol of channels) layers[pol] = layerLabel(pol);

  const viewer: ViewerDataset = {
    status: calibrated ? "nisar_calibrated" : "nisar_quicklook",
    availability: calibrated ? "calibrated" : "quicklook",
    areaLabel,
    source,
    productLine: `${before.band === after.band ? before.band : `${before.band}/${after.band}`} · ${before.productType} · NISAR`,
    band: before.band,
    productType: before.productType,
    polarisations: channels,
    layers,
    encoding,
    changeScale: { unit: encoding.unit },
    earlier: acquisitionFromScene(before),
    later: acquisitionFromScene(after),
    temporalBaselineDays: baselineDays(before.startTime, after.startTime),
    limitations,
  };

  const instance = ++nextInstance;
  const key = pairKey({ aoi, beforeId: before.id, afterId: after.id, methodVersion: METHOD_VERSION });
  const snapshot = (): PairDataset => ({
    viewer,
    bounds: aoi,
    beforeId: before.id,
    afterId: after.id,
    key,
    instance,
    perPol: { ...perPol },
    channelStatus: { ...channelStatus },
  });

  const result = snapshot();
  // Remaining channels load in the background into the same dataset.
  for (const pol of order) {
    if (channelStatus[pol] !== "loading") continue;
    attempt(pol).then(
      () => {
        if (!signal?.aborted) opts.onChannelUpdate?.(snapshot());
      },
      () => {
        /* aborted: the pair was replaced or cleared */
      },
    );
  }
  return result;
}
