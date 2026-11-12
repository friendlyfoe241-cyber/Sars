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
import type {
  Manifest,
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

export function quadsAgree(a: Quad, b: Quad, toleranceDeg = 1e-4): boolean {
  const pairs = [a.sw, a.se, a.ne, a.nw].map((p, i) => {
    const q = [b.sw, b.se, b.ne, b.nw][i];
    return Math.abs(p[0] - q[0]) <= toleranceDeg && Math.abs(p[1] - q[1]) <= toleranceDeg;
  });
  return pairs.every(Boolean);
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

interface SampleMap {
  u: Float32Array;
  v: Float32Array;
  width: number;
  height: number;
}

export function outputHeightFor(aoi: Aoi, outWidth: number): number {
  const midLat = ((aoi.south + aoi.north) / 2) * (Math.PI / 180);
  const lonSpanKm = (aoi.east - aoi.west) * 111.32 * Math.max(0.2, Math.cos(midLat));
  const latSpanKm = (aoi.north - aoi.south) * 111.32;
  return Math.max(1, Math.round((outWidth * latSpanKm) / lonSpanKm));
}

/** Mapping from AOI grid pixels to source-image (u, v) fractions. */
export function buildSampleMap(quad: Quad, aoi: Aoi, outWidth: number): SampleMap {
  const width = outWidth;
  const height = outputHeightFor(aoi, outWidth);
  const u = new Float32Array(width * height);
  const v = new Float32Array(width * height);
  const [sw, se, ne, nw] = [quad.sw, quad.se, quad.ne, quad.nw];

  // Affine initialisation (the quads are near-parallelograms).
  const a00 = se[0] - sw[0];
  const a01 = nw[0] - sw[0];
  const a10 = se[1] - sw[1];
  const a11 = nw[1] - sw[1];
  const det = a00 * a11 - a01 * a10;

  for (let r = 0; r < height; r++) {
    const lat = aoi.north - ((aoi.north - aoi.south) * r) / (height - 1 || 1);
    for (let c = 0; c < width; c++) {
      const lon = aoi.west + ((aoi.east - aoi.west) * c) / (width - 1 || 1);
      const dx = lon - sw[0];
      const dy = lat - sw[1];
      let uu = (dx * a11 - dy * a01) / det;
      let vv = (a00 * dy - a10 * dx) / det;
      // Newton refinement against the bilinear mapping.
      for (let it = 0; it < 6; it++) {
        const mu = 1 - uu;
        const mv = 1 - vv;
        const px = mu * mv * sw[0] + uu * mv * se[0] + uu * vv * ne[0] + mu * vv * nw[0];
        const py = mu * mv * sw[1] + uu * mv * se[1] + uu * vv * ne[1] + mu * vv * nw[1];
        const dPdu0 = mv * (se[0] - sw[0]) + vv * (ne[0] - nw[0]);
        const dPdu1 = mv * (se[1] - sw[1]) + vv * (ne[1] - nw[1]);
        const dPdv0 = mu * (nw[0] - sw[0]) + uu * (ne[0] - se[0]);
        const dPdv1 = mu * (nw[1] - sw[1]) + uu * (ne[1] - se[1]);
        const detJ = dPdu0 * dPdv1 - dPdu1 * dPdv0;
        if (detJ === 0) break;
        const ex = lon - px;
        const ey = lat - py;
        uu += (ex * dPdv1 - ey * dPdv0) / detJ;
        vv += (dPdu0 * ey - dPdu1 * ex) / detJ;
      }
      const idx = r * width + c;
      u[idx] = uu;
      v[idx] = vv;
    }
  }
  return { u, v, width, height };
}

/** Resample a source raster onto the AOI grid using a shared sample map. */
export function sampleToGrid(src: Raster, map: SampleMap): Raster {
  const out = new Uint8ClampedArray(map.width * map.height);
  const w = src.width;
  const h = src.height;
  for (let i = 0; i < out.length; i++) {
    const px = map.u[i] * (w - 1);
    const py = (1 - map.v[i]) * (h - 1);
    if (px < 0 || px > w - 1 || py < 0 || py > h - 1) continue;
    const val = src.red[Math.round(py) * w + Math.round(px)];
    out[i] = val; // 0 (nodata) is preserved
  }
  return { width: map.width, height: map.height, red: out };
}

// ---------------------------------------------------------------------------
// Quicklook acquisition (public ASF browse artefacts, no authentication)
// ---------------------------------------------------------------------------

const fetchCache = new Map<string, Promise<unknown>>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = fetchCache.get(key) as Promise<T> | undefined;
  if (hit) return hit;
  const p = load();
  fetchCache.set(key, p);
  return p;
}

export class RasterUnavailableError extends Error {
  constructor(
    message: string,
    public readonly sceneStatus: { sceneId: string; status: RasterAvailability }[],
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

async function fetchQuicklookRaster(url: string): Promise<Raster> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable.");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const red = new Uint8ClampedArray(canvas.width * canvas.height);
  for (let i = 0; i < red.length; i++) red[i] = data.data[i * 4];
  return { width: canvas.width, height: canvas.height, red };
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
      fetchQuicklookRaster(pngUrl),
      cached(`kml:${scene.id}:${pol}`, () => fetchText(kmlUrl)).catch(() =>
        // any channel's KML has the same geometry; try the others
        firstKml(scene, pol),
      ),
    ]);
    return { raster, quad: parseKmlQuad(kmlText) };
  });
}

async function firstKml(scene: NisarScene, skipPol: string): Promise<string> {
  for (const [pol, url] of Object.entries(scene.quicklooks.kml)) {
    if (pol === skipPol) continue;
    try {
      return await cached(`kml:${scene.id}:${pol}`, () => fetchText(url));
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

export function computeSaturation(before: Raster, after: Raster, encoding: RasterEncoding): number {
  const diffs: number[] = [];
  const step = 3; // sample every 3rd pixel; deterministic
  for (let i = 0; i < before.red.length; i += step) {
    const b = before.red[i];
    const a = after.red[i];
    if (b === encoding.nodata || a === encoding.nodata) continue;
    diffs.push(
      encoding.type === "quicklook_dn"
        ? a - b
        : ((a - b) / 254) * ((encoding.dbMax ?? 5) - (encoding.dbMin ?? -30)),
    );
  }
  if (diffs.length === 0) return encoding.type === "quicklook_dn" ? 10 : 1;
  diffs.sort((x, y) => x - y);
  const p98 = Math.abs(diffs[Math.floor((diffs.length - 1) * 0.98)]);
  if (encoding.type === "quicklook_dn") return Math.max(10, Math.round(p98 / 5) * 5);
  return Math.max(1, Math.round(p98 * 2) / 2);
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
  const pols = commonPolarisations(before, after);
  if (pols.length === 0) {
    throw new RasterUnavailableError(
      "The two scenes share no polarisation channel, so they cannot be compared.",
      [
        { sceneId: before.id, status: "metadata-only" },
        { sceneId: after.id, status: "metadata-only" },
      ],
    );
  }

  const prepared = opts.prepared ?? null;
  const preparedMatches =
    prepared !== null &&
    prepared.beforeId === before.id &&
    prepared.afterId === after.id;

  let quad: Quad | null = null;
  let beforeSrc: Record<string, Raster> = {};
  let afterSrc: Record<string, Raster> = {};
  let encoding: RasterEncoding = QUICKLOOK_ENCODING;
  let availability: RasterAvailability = "quicklook";
  let limitations: string[];
  let source: string;
  let status: ViewerDataset["status"] = "nisar_quicklook";

  if (preparedMatches) {
    const manifest: Manifest = prepared.manifest;
    const bounds = manifest.studyArea.bounds;
    quad = quadFromBounds(bounds);
    encoding = manifest.encoding;
    availability = encoding.type === "db_linear" ? "calibrated" : "quicklook";
    status = encoding.type === "db_linear" ? "nisar_calibrated" : "nisar_quicklook";
    for (const pol of pols) {
      const entry = manifest.rasters[pol];
      if (!entry) continue;
      beforeSrc[pol] = await loadRaster(rasterUrl(entry.before));
      afterSrc[pol] = await loadRaster(rasterUrl(entry.after));
    }
    if (Object.keys(beforeSrc).length === 0) {
      throw new RasterUnavailableError(
        "The prepared dataset has no rasters for the shared polarisation channels.",
        [
          { sceneId: before.id, status: "metadata-only" },
          { sceneId: after.id, status: "metadata-only" },
        ],
      );
    }
    limitations = manifest.dataset.limitations;
    source = manifest.dataset.source;
  } else {
    const statusList: { sceneId: string; status: RasterAvailability }[] = [];
    for (const pol of pols) {
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
        if (quad === null) quad = b.quad;
        beforeSrc[pol] = b.raster;
        afterSrc[pol] = a.raster;
      } catch {
        statusList.push({ sceneId: before.id, status: "metadata-only" });
        statusList.push({ sceneId: after.id, status: "metadata-only" });
      }
    }
    if (Object.keys(beforeSrc).length === 0) {
      throw new RasterUnavailableError(
        "Quicklook rasters for this pair are not available. Scene metadata is shown instead of a comparison.",
        statusList,
      );
    }
    source =
      "NASA/ISRO NISAR L2 GCOV (geocoded observables), archived by NASA ASF DAAC — ASF browse quicklooks";
    const gridPixelM =
      ((aoi.east - aoi.west) * 111320 * Math.cos(((aoi.south + aoi.north) / 2) * (Math.PI / 180))) /
      outWidth;
    limitations = QUICKLOOK_LIMITATIONS(Math.round(gridPixelM));
  }

  if (quad === null) {
    throw new RasterUnavailableError(
      "No raster could be prepared for this pair.",
      [
        { sceneId: before.id, status: "metadata-only" },
        { sceneId: after.id, status: "metadata-only" },
      ],
    );
  }

  const map = buildSampleMap(quad, aoi, outWidth);
  const perPol: PairDataset["perPol"] = {};
  for (const pol of Object.keys(beforeSrc)) {
    perPol[pol] = {
      before: sampleToGrid(beforeSrc[pol], map),
      after: sampleToGrid(afterSrc[pol], map),
    };
  }

  const firstPol = Object.keys(perPol)[0];
  const saturation = computeSaturation(
    perPol[firstPol].before,
    perPol[firstPol].after,
    encoding,
  );

  const layers: Record<string, string> = {};
  for (const pol of Object.keys(perPol)) layers[pol] = layerLabel(pol);

  const viewer: ViewerDataset = {
    status,
    availability,
    areaLabel,
    source,
    productLine: `${before.band === after.band ? before.band : `${before.band}/${after.band}`} · ${before.productType} · NISAR`,
    band: before.band,
    productType: before.productType,
    polarisations: Object.keys(perPol),
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
