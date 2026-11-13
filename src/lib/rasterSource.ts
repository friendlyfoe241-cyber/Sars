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
const FETCH_CACHE_LIMIT = 32;
const fetchCache = new Map<string, Promise<unknown>>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = fetchCache.get(key) as Promise<T> | undefined;
  if (hit) {
    fetchCache.delete(key);
    fetchCache.set(key, hit); // mark as most recently used
    return hit;
  }
  const p = load();
  fetchCache.set(key, p);
  p.catch(() => {
    if (fetchCache.get(key) === p) fetchCache.delete(key);
  });
  if (fetchCache.size > FETCH_CACHE_LIMIT) {
    const oldest = fetchCache.keys().next().value;
    if (oldest !== undefined) fetchCache.delete(oldest);
  }
  return p;
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

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function fetchKml(scene: NisarScene, pol: string, url: string): Promise<string> {
  return cached(`kml:${scene.id}:${pol}`, () => fetchText(url));
}

export interface QuicklookSource {
  raster: Raster;
  quad: Quad;
}

export function fetchSceneQuicklook(scene: NisarScene, pol: string): Promise<QuicklookSource> {
  return cached(`ql:${scene.id}:${pol}`, async () => {
    const pngUrl = scene.quicklooks.png[pol];
    const kmlUrl = scene.quicklooks.kml[pol];
    if (!pngUrl) throw new Error(`No quicklook for ${pol}.`);
    const [raster, kmlText] = await Promise.all([
      loadRaster(pngUrl),
      // any channel's KML has the same geometry; fall back to the others
      fetchKml(scene, pol, kmlUrl).catch(() => firstKml(scene, pol)),
    ]);
    return { raster, quad: parseKmlQuad(kmlText) };
  });
}

async function firstKml(scene: NisarScene, skipPol: string): Promise<string> {
  for (const [pol, url] of Object.entries(scene.quicklooks.kml)) {
    if (pol === skipPol) continue;
    try {
      return await fetchKml(scene, pol, url);
    } catch {
      /* try next */
    }
  }
  throw new Error(`No georeferencing KML for ${scene.id}.`);
}

// ---------------------------------------------------------------------------
// Pair assembly
// ---------------------------------------------------------------------------

export interface PairDataset {
  viewer: ViewerDataset;
  /** grid bounds (equal to the requested AOI) */
  bounds: Aoi;
  perPol: Record<string, { before: Raster; after: Raster }>;
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
}

/**
 * Build the viewer dataset for a selected observation pair over an AOI.
 * Prefers locally prepared (possibly calibrated) rasters; otherwise fetches
 * the public quicklooks.  Throws RasterUnavailableError when no raster can be
 * prepared, so callers can show metadata and a processing status instead.
 */
export async function buildPairDataset(opts: BuildPairOptions): Promise<PairDataset> {
  const { before, after, aoi, areaLabel } = opts;
  const outWidth = opts.outputWidth ?? DEFAULT_OUTPUT_WIDTH;
  const metadataOnly = (): SceneStatus[] => [
    { sceneId: before.id, status: "metadata-only" },
    { sceneId: after.id, status: "metadata-only" },
  ];

  const pols = commonPolarisations(before, after);
  if (pols.length === 0) {
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

  // Source rasters per shared channel, in channel order.  All channels (and
  // both sides of each) are fetched and decoded concurrently.
  let sources: { pol: string; before: Raster; after: Raster }[];
  let quad: Quad;
  let encoding: RasterEncoding = QUICKLOOK_ENCODING;
  let limitations: string[];
  let source: string;

  if (preparedMatches) {
    const { manifest } = prepared;
    quad = quadFromBounds(manifest.studyArea.bounds);
    encoding = manifest.encoding;
    sources = await Promise.all(
      pols
        .filter((pol) => manifest.rasters[pol])
        .map(async (pol) => {
          const entry = manifest.rasters[pol];
          const [b, a] = await Promise.all(
            [entry.before, entry.after].map((path) => {
              const url = rasterUrl(path);
              return cached(`prepared:${url}`, () => loadRaster(url));
            }),
          );
          return { pol, before: b, after: a };
        }),
    );
    if (sources.length === 0) {
      throw new RasterUnavailableError(
        "The prepared dataset has no rasters for the shared polarisation channels.",
        metadataOnly(),
      );
    }
    limitations = manifest.dataset.limitations;
    source = manifest.dataset.source;
  } else {
    const loaded = await Promise.all(
      pols.map(async (pol) => {
        try {
          const [b, a] = await Promise.all([
            fetchSceneQuicklook(before, pol),
            fetchSceneQuicklook(after, pol),
          ]);
          if (b.raster.width !== a.raster.width || b.raster.height !== a.raster.height) {
            throw new Error("The two quicklooks are not on the same grid.");
          }
          if (!quadsAgree(b.quad, a.quad)) {
            throw new Error("The two quicklooks have different georeferencing.");
          }
          return { pol, before: b.raster, after: a.raster, quad: b.quad };
        } catch {
          return null;
        }
      }),
    );
    const usable = loaded.filter((entry) => entry !== null);
    if (usable.length === 0) {
      throw new RasterUnavailableError(
        "Quicklook rasters for this pair are not available. Scene metadata is shown instead of a comparison.",
        loaded.flatMap(() => metadataOnly()),
      );
    }
    sources = usable;
    quad = usable[0].quad;
    source =
      "NASA/ISRO NISAR L2 GCOV (geocoded observables), archived by NASA ASF DAAC — ASF browse quicklooks";
    const gridPixelM =
      ((aoi.east - aoi.west) * 111320 * Math.cos(((aoi.south + aoi.north) / 2) * (Math.PI / 180))) /
      outWidth;
    limitations = QUICKLOOK_LIMITATIONS(Math.round(gridPixelM));
  }

  const calibrated = encoding.type === "db_linear";

  // One sample index per distinct source grid (normally exactly one).
  const indexes = new Map<string, SampleIndex>();
  const resample = (src: Raster): Raster => {
    const key = `${src.width}x${src.height}`;
    let map = indexes.get(key);
    if (!map) {
      map = buildSampleIndex(quad, aoi, outWidth, src.width, src.height);
      indexes.set(key, map);
    }
    return sampleToGrid(src, map);
  };

  const perPol: PairDataset["perPol"] = {};
  const layers: Record<string, string> = {};
  for (const src of sources) {
    perPol[src.pol] = { before: resample(src.before), after: resample(src.after) };
    layers[src.pol] = layerLabel(src.pol);
  }

  const first = perPol[sources[0].pol];
  const saturation = computeSaturation(first.before.red, first.after.red, encoding);

  const viewer: ViewerDataset = {
    status: calibrated ? "nisar_calibrated" : "nisar_quicklook",
    availability: calibrated ? "calibrated" : "quicklook",
    areaLabel,
    source,
    productLine: `${before.band === after.band ? before.band : `${before.band}/${after.band}`} · ${before.productType} · NISAR`,
    band: before.band,
    productType: before.productType,
    polarisations: sources.map((src) => src.pol),
    layers,
    encoding,
    changeScale: { saturation, unit: encoding.unit },
    earlier: acquisitionFromScene(before),
    later: acquisitionFromScene(after),
    temporalBaselineDays: baselineDays(before.startTime, after.startTime),
    limitations,
  };

  return { viewer, bounds: aoi, perPol };
}
