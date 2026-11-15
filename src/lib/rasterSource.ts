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
    "8-bit ASF browse quicklook rendering of the GCOV polarimetric layers; the scaling of the browse rendering is not documented, so DN differences are display-brightness differences only. 0 marks nodata / outside the observation footprint.",
};

export const DEFAULT_OUTPUT_WIDTH = 768;

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

function solve3(m: number[][], v: number[]): [number, number, number] {
  const a = m.map((row, i) => [...row, v[i]]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
    }
    [a[col], a[piv]] = [a[piv], a[col]];
    if (Math.abs(a[col][col]) < 1e-12) throw new Error("degenerate geometry");
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = a[r][col] / a[col][col];
      for (let c = col; c < 4; c++) a[r][c] -= f * a[col][c];
    }
  }
  return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
}

function fitAffine(
  pairs: { px: [number, number]; geo: [number, number] }[],
): (col: number, row: number) => [number, number] {
  let cc = 0, cr = 0, rr = 0, cs = 0, rs = 0;
  let clon = 0, rlon = 0, lon = 0, clat = 0, rlat = 0, lat = 0;
  for (const { px: [c, r], geo: [lo, la] } of pairs) {
    cc += c * c; cr += c * r; rr += r * r; cs += c; rs += r;
    clon += c * lo; rlon += r * lo; lon += lo;
    clat += c * la; rlat += r * la; lat += la;
  }
  const n = pairs.length;
  const m = [[cc, cr, cs], [cr, rr, rs], [cs, rs, n]];
  const [a, b, c0] = solve3(m, [clon, rlon, lon]);
  const [d, e, f0] = solve3(m, [clat, rlat, lat]);
  return (col, row) => [a * col + b * row + c0, d * col + e * row + f0];
}

export function deriveQuadFromImage(src: Raster, footprint: [number, number][]): Quad {
  const { width, height, red } = src;
  let valid = 0;
  let west: [number, number] | null = null;
  let east: [number, number] | null = null;
  let north: [number, number] | null = null;
  let south: [number, number] | null = null;
  let westC = Infinity, eastC = -Infinity, northR = Infinity, southR = -Infinity;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (red[row * width + col] === 0) continue;
      valid++;
      if (col < westC) { westC = col; west = [col, row]; }
      if (col > eastC) { eastC = col; east = [col, row]; }
      if (row < northR) { northR = row; north = [col, row]; }
      if (row > southR) { southR = row; south = [col, row]; }
    }
  }
  const fraction = valid / (width * height);
  if (fraction < 0.1 || fraction > 0.9) {
    throw new Error("quicklook mask is not a swath inside nodata; cannot derive georeferencing");
  }
  const imageCorners = [west, east, north, south];
  if (
    imageCorners.some((p) => p === null) ||
    new Set(imageCorners.map((p) => `${p![0]},${p![1]}`)).size !== 4
  ) {
    throw new Error("quicklook swath corners are not distinct; cannot derive georeferencing");
  }

  const same = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];
  const ring =
    footprint.length > 4 && same(footprint[0], footprint[footprint.length - 1])
      ? footprint.slice(0, -1)
      : footprint;
  if (ring.length < 4) throw new Error("scene footprint has too few corners");
  const extreme = (fn: (p: [number, number]) => number): [number, number] =>
    ring.reduce((best, p) => (fn(p) < fn(best) ? p : best), ring[0]);
  const fWest = extreme((p) => p[0]);
  const fEast = extreme((p) => -p[0]);
  const fNorth = extreme((p) => -p[1]);
  const fSouth = extreme((p) => p[1]);
  const fpCorners = [fWest, fEast, fNorth, fSouth];
  if (new Set(fpCorners.map(([lo, la]) => `${lo},${la}`)).size !== 4) {
    throw new Error("scene footprint corners are not distinct");
  }

  const at = fitAffine([
    { px: west!, geo: fWest },
    { px: east!, geo: fEast },
    { px: north!, geo: fNorth },
    { px: south!, geo: fSouth },
  ]);
  const quad: Quad = {
    nw: at(0, 0),
    ne: at(width - 1, 0),
    se: at(width - 1, height - 1),
    sw: at(0, height - 1),
  };

  const lons = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  const [minLon, maxLon] = [Math.min(...lons), Math.max(...lons)];
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
  const spanLon = maxLon - minLon || 1;
  const spanLat = maxLat - minLat || 1;
  for (const k of CORNERS) {
    const [lo, la] = quad[k];
    if (
      lo < minLon - 0.75 * spanLon || lo > maxLon + 0.75 * spanLon ||
      la < minLat - 0.75 * spanLat || la > maxLat + 0.75 * spanLat
    ) {
      throw new Error("derived georeferencing is implausible");
    }
  }
  return quad;
}

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
      let u = (dx * fy - dy * fx) / det;
      let v = (ex * dy - ey * dx) / det;
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

export function sampleToGrid(src: Raster, map: SampleIndex): Raster {
  const { index } = map;
  const red = new Uint8ClampedArray(index.length);
  const srcRed = src.red;
  for (let i = 0; i < index.length; i++) {
    const s = index[i];
    if (s >= 0) red[i] = srcRed[s];
  }
  return { width: map.width, height: map.height, red };
}

interface CacheEntry<T> {
  promise: Promise<T>;
  controller: AbortController;
  refs: number;
  settled: boolean;
}

interface FetchCache {
  readonly limit: number;
  readonly entries: Map<string, CacheEntry<unknown>>;
}

function makeCache(limit: number): FetchCache {
  return { limit, entries: new Map() };
}

const rasterCache = makeCache(8);
const gridCache = makeCache(32);
const textCache = makeCache(64);

function trim(cache: FetchCache): void {
  for (const [key, entry] of cache.entries) {
    if (cache.entries.size <= cache.limit) return;
    if (!entry.settled && entry.refs > 0) continue;
    if (!entry.settled) entry.controller.abort();
    cache.entries.delete(key);
  }
}

function cached<T>(
  cache: FetchCache,
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) return Promise.reject(abortError());
  const map = cache.entries;
  let entry = map.get(key) as CacheEntry<T> | undefined;
  if (entry) {
    map.delete(key);
    map.set(key, entry);
  } else {
    const controller = new AbortController();
    const created: CacheEntry<T> = {
      promise: load(controller.signal),
      controller,
      refs: 0,
      settled: false,
    };
    entry = created;
    map.set(key, created);
    created.promise.then(
      () => {
        created.settled = true;
        trim(cache);
      },
      () => {
        created.settled = true;
        if (map.get(key) === created) map.delete(key);
      },
    );
  }

  const e = entry;
  e.refs++;
  trim(cache);
  if (!signal) return e.promise;
  return new Promise<T>((resolve, reject) => {
    const detach = () => {
      e.refs--;
      if (e.refs <= 0 && !e.settled) {
        queueMicrotask(() => {
          if (e.refs <= 0 && !e.settled) {
            e.controller.abort();
            if (map.get(key) === e) map.delete(key);
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

function loadSceneKml(scene: NisarScene, preferPol: string, signal?: AbortSignal): Promise<string> {
  return cached(
    textCache,
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
        }
      }
      throw new Error(`No georeferencing KML for ${scene.id}.`);
    },
    signal,
  );
}

function loadSourceRaster(scene: NisarScene, pol: string, signal?: AbortSignal): Promise<Raster> {
  return cached(
    rasterCache,
    `ql:${scene.id}:${pol}`,
    async (sig) => {
      const pngUrl = scene.quicklooks.png[pol];
      if (!pngUrl) throw new Error(`No quicklook for ${pol}.`);
      return loadRaster(pngUrl, sig);
    },
    signal,
  );
}

const SAMPLE_INDEX_LIMIT = 8;
const sampleIndexCache = new Map<string, SampleIndex>();

function quadKey(quad: Quad): string {
  return CORNERS.map((k) => `${quad[k][0]},${quad[k][1]}`).join(";");
}

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
  quad: Quad;
  georef: "published" | "derived";
}

const sceneGeoref = new Map<string, "published" | "derived">();

function loadSceneGridEntry(
  scene: NisarScene,
  pol: string,
  aoi: Aoi,
  outWidth: number,
  signal?: AbortSignal,
): Promise<SceneGrid> {
  return cached(
    gridCache,
    `grid:${scene.id}|${pol}|${aoiKey(aoi)}|${outWidth}|${METHOD_VERSION}`,
    async (sig) => {
      const src = await loadSourceRaster(scene, pol, sig);
      let quad: Quad;
      let georef: "published" | "derived";
      try {
        const kmlText = await loadSceneKml(scene, pol, sig);
        quad = parseKmlQuad(kmlText);
        georef = "published";
      } catch (err) {
        if (isAbortError(err) || sig.aborted) throw err;
        quad = deriveQuadFromImage(src, scene.footprint);
        georef = "derived";
      }
      sceneGeoref.set(scene.id, georef);
      const index = sampleIndexFor(quad, aoi, outWidth, src.width, src.height);
      return { raster: sampleToGrid(src, index), quad, georef };
    },
    signal,
  );
}

export function loadSceneGrid(
  scene: NisarScene,
  pol: string,
  aoi: Aoi,
  outWidth: number,
  signal?: AbortSignal,
): Promise<Raster> {
  return loadSceneGridEntry(scene, pol, aoi, outWidth, signal).then((g) => g.raster);
}

export function sceneHasQuicklook(scene: NisarScene): boolean {
  return scene.polarisations.some((pol) => Boolean(scene.quicklooks.png[pol]));
}

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

export type ChannelStatus = "ready" | "loading" | "unavailable";

export interface ChannelRasters {
  before: Raster;
  after: Raster;
  saturation: number;
}

export interface PairDataset {
  viewer: ViewerDataset;
  bounds: Aoi;
  beforeId: string;
  afterId: string;
  key: string;
  instance: number;
  perPol: Record<string, ChannelRasters>;
  channelStatus: Record<string, ChannelStatus>;
}

const QUICKLOOK_LIMITATIONS = (gridPixelM: number) => [
  "Displayed values are 8-bit quicklook renderings (display DN), not calibrated backscatter in dB.",
  "The change layer is a difference of those display values; it preserves the sign of change under the shared quicklook rendering but its magnitude is not calibrated backscatter.",
  `Source quicklooks are about 180 m per pixel and are resampled to the AOI grid (${gridPixelM} m per pixel).`,
  "Calibrated gamma-0 backscatter (dB) is produced by the Python analysis pipeline — see the Calibrated analysis panel.",
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
  prepared?: PreparedDataset | null;
  areaLabel: string;
  outputWidth?: number;
  channel?: string;
  onChannelUpdate?: (dataset: PairDataset) => void;
  signal?: AbortSignal;
}

let nextInstance = 0;

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

  let channels: string[];
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
          return cached(rasterCache, `prepared:${url}`, (sig) => loadRaster(url, sig), signal);
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
      const tolerance =
        b.georef === "derived" || a.georef === "derived" ? 0.05 : 1e-4;
      if (!quadsAgree(b.quad, a.quad, tolerance)) {
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
  if (
    !preparedMatches &&
    (sceneGeoref.get(before.id) === "derived" || sceneGeoref.get(after.id) === "derived")
  ) {
    limitations = [
      ...limitations,
      "These quicklooks publish no KML ground overlay, so their georeferencing is derived from the scene footprints; placement is accurate to about 1 km.",
    ];
  }
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
  for (const pol of order) {
    if (channelStatus[pol] !== "loading") continue;
    attempt(pol).then(
      () => {
        if (!signal?.aborted) opts.onChannelUpdate?.(snapshot());
      },
      () => {
      },
    );
  }
  return result;
}
