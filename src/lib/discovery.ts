import { abortable } from "./abort";
import { aoiPolygon, type Aoi } from "./aoi";

const SEARCH_API = "https://api.daac.asf.alaska.edu/services/search/param";

export function layerToPolarisation(layerCode: string): string | null {
  const c = layerCode.toUpperCase();
  if (c.length === 4 && c[0] === c[2] && c[1] === c[3]) return c[0] + c[1];
  return null;
}

export type Maturity = "VALIDATED" | "PROVISIONAL" | "BETA" | "UNKNOWN";

export interface SceneQuicklooks {
  png: Record<string, string>;
  kml: Record<string, string>;
}

export interface NisarScene {
  id: string;
  startTime: string;
  stopTime: string;
  band: string;
  polarisations: string[];
  productType: string;
  processingLevel: string;
  collection: string;
  maturity: Maturity;
  orbitDirection: string;
  orbit: number | null;
  track: number | null;
  frame: number | null;
  crid: string | null;
  pgeVersion: string | null;
  productionCode: string | null;
  footprint: [number, number][];
  quicklooks: SceneQuicklooks;
  downloadUrl: string | null;
  fileName: string | null;
}

interface AsfGranule {
  granuleName?: string;
  productName?: string;
  startTime?: string;
  stopTime?: string;
  platform?: string;
  sensor?: string;
  processingLevel?: string;
  processingType?: string;
  flightDirection?: string;
  absoluteOrbit?: number;
  relativeOrbit?: number;
  track?: number;
  frameNumber?: number;
  pgeVersion?: string;
  downloadUrl?: string;
  fileName?: string;
  stringFootprint?: string;
  browse?: string[];
  nisar?: {
    mainBandPolarization?: string[];
    additionalUrls?: string[];
    s3Urls?: string[];
    frameCoverage?: string;
    pgeVersion?: string;
    rangeBandwidth?: string[];
  };
}

function parseFootprint(wkt: string | undefined): [number, number][] {
  if (!wkt) return [];
  const m = /POLYGON\s*\(\(([^)]+)\)\)/i.exec(wkt);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((pair) => {
      const [lon, lat] = pair.trim().split(/\s+/).map(Number);
      return [lon, lat] as [number, number];
    })
    .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
}

function collectionFromUrls(g: AsfGranule): string {
  for (const url of [g.downloadUrl, ...(g.nisar?.additionalUrls ?? [])]) {
    if (!url) continue;
    const m = /\/(NISAR_[A-Z0-9_]+_V\d+)\//.exec(url);
    if (m) return m[1];
  }
  return "UNKNOWN";
}

function maturityFromCollection(collection: string): Maturity {
  if (collection.includes("PROVISIONAL")) return "PROVISIONAL";
  if (collection.includes("BETA")) return "BETA";
  if (collection.startsWith("NISAR_L2_GCOV_V")) return "VALIDATED";
  return "UNKNOWN";
}

function cridFromName(name: string): string | null {
  const m = /_([A-Z]\d{4,6})_[NF]_[A-Z]_J_\d+$/.exec(name);
  return m ? m[1] : null;
}

function productionCodeFromName(name: string): string | null {
  const fields = name.split("_");
  return fields.length > 10 ? fields[8] : null;
}

const BROWSE_BASE = "https://nisar.asf.earthdatacloud.nasa.gov/BROWSE";

function quicklooksFor(g: AsfGranule, scene: string, collection: string): SceneQuicklooks {
  const png: Record<string, string> = {};
  const kml: Record<string, string> = {};
  const candidates = [...(g.nisar?.additionalUrls ?? []), ...(g.browse ?? [])];
  for (const url of candidates) {
    const m = /_NATIVE_A_([A-Z]{4})\.(png|kml)$/i.exec(url);
    if (!m) continue;
    const pol = layerToPolarisation(m[1]);
    if (!pol) continue;
    if (m[2].toLowerCase() === "png") png[pol] = url;
    else kml[pol] = url;
  }
  for (const pol of ["HH", "HV", "VV", "VH"]) {
    const code = pol + pol;
    if (!png[pol]) png[pol] = `${BROWSE_BASE}/${collection}/${scene}/${scene}_NATIVE_A_${code}.png`;
    if (!kml[pol]) kml[pol] = `${BROWSE_BASE}/${collection}/${scene}/${scene}_NATIVE_A_${code}.kml`;
  }
  return { png, kml };
}

function normalise(g: AsfGranule): NisarScene | null {
  const id = g.granuleName ?? g.productName;
  if (!id || !g.startTime) return null;
  const polarisations = (g.nisar?.mainBandPolarization ?? []).filter(Boolean);
  if (g.platform !== "NISAR" || polarisations.length === 0) return null;
  const collection = collectionFromUrls(g);
  return {
    id,
    startTime: g.startTime,
    stopTime: g.stopTime ?? g.startTime,
    band: "L-band",
    polarisations: [...polarisations].sort(),
    productType: g.processingType ? `${g.processingType} ${g.processingLevel}` : "L2 GCOV",
    processingLevel: g.processingLevel ?? "GCOV",
    collection,
    maturity: maturityFromCollection(collection),
    orbitDirection: g.flightDirection ?? "UNKNOWN",
    orbit: g.absoluteOrbit ?? null,
    track: g.track ?? null,
    frame: g.frameNumber ?? null,
    crid: cridFromName(id),
    pgeVersion: g.nisar?.pgeVersion ?? g.pgeVersion ?? null,
    productionCode: productionCodeFromName(id),
    footprint: parseFootprint(g.stringFootprint),
    quicklooks: quicklooksFor(g, id, collection),
    downloadUrl: g.downloadUrl ?? null,
    fileName: g.fileName ?? null,
  };
}

export interface DiscoveryQuery {
  aoi: Aoi;
  start?: string;
  end?: string;
  maxResults?: number;
}

export interface DiscoveryResult {
  scenes: NisarScene[];
  truncated: boolean;
  query: DiscoveryQuery;
}

const cache = new Map<string, DiscoveryResult>();
const inflight = new Map<string, Promise<DiscoveryResult>>();

function queryKey(q: DiscoveryQuery): string {
  return `${q.aoi.west.toFixed(3)},${q.aoi.south.toFixed(3)},${q.aoi.east.toFixed(3)},${q.aoi.north.toFixed(3)}|${q.start ?? ""}|${q.end ?? ""}|${q.maxResults ?? ""}`;
}

export function searchNisarGcov(
  query: DiscoveryQuery,
  signal?: AbortSignal,
): Promise<DiscoveryResult> {
  return abortable(runSearchShared(query), signal);
}

function runSearchShared(query: DiscoveryQuery): Promise<DiscoveryResult> {
  const key = queryKey(query);
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(key);
  if (pending) return pending;

  const maxResults = query.maxResults ?? 300;
  const params = new URLSearchParams({
    platform: "NISAR",
    processingLevel: "GCOV",
    intersectsWith: aoiPolygon(query.aoi),
    maxResults: String(maxResults),
    output: "json",
  });
  if (query.start) params.set("start", `${query.start}T00:00:00Z`);
  if (query.end) params.set("end", `${query.end}T23:59:59Z`);

  const promise = (async (): Promise<DiscoveryResult> => {
    const res = await fetch(`${SEARCH_API}?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`NISAR catalogue search failed (HTTP ${res.status}).`);
    }
    const rows = (await res.json()) as AsfGranule[][];
    const scenes = rows
      .flat()
      .map(normalise)
      .filter((s): s is NisarScene => s !== null)
      .sort((a, b) => (a.startTime < b.startTime ? 1 : -1));
    const result: DiscoveryResult = {
      scenes,
      truncated: scenes.length >= maxResults,
      query,
    };
    cache.set(key, result);
    return result;
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, promise);
  return promise;
}
