// Types and loaders for datasets shown in the viewer.
//
// Two raster sources feed the same viewer model:
//   1. a prepared local dataset (public/data/manifest.json, produced by the
//      scripts in scripts/) — the shipped example and the calibrated path;
//   2. dynamic pairs built in the browser from discovered NISAR scenes
//      (src/lib/rasterSource.ts).
// The viewer only ever sees ViewerDataset + rasters, so rendering, change
// statistics and the Gemini feature are shared unchanged.

export type DatasetStatus = "nisar_quicklook" | "nisar_calibrated" | "demo";

export type RasterAvailability =
  | "calibrated" // calibrated raster prepared and ready
  | "quicklook" // public quicklook rendering ready
  | "metadata-only"; // catalogue metadata only, raster not prepared

export interface RasterEncoding {
  type: "quicklook_dn" | "db_linear";
  unit: string;
  nodata: number;
  /** only for db_linear: DN 1..255 maps linearly onto [dbMin, dbMax] */
  dbMin?: number;
  dbMax?: number;
  description: string;
}

export interface Acquisition {
  productId: string;
  startTime: string;
  stopTime: string;
  orbit: number | null;
  pathNumber: number | null;
  frameNumber: number | null;
  flightDirection: string | null;
  polarisations: string[] | null;
  collectionName: string | null;
  processingLevel: string | null;
  processingSoftwareVersion: string | null;
  crid: string | null;
}

/** What the viewer components need to know about the loaded observation pair. */
export interface ViewerDataset {
  status: DatasetStatus;
  availability: RasterAvailability;
  areaLabel: string;
  source: string;
  productLine: string;
  band: string;
  productType: string;
  polarisations: string[];
  layers: Record<string, string>;
  encoding: RasterEncoding;
  /** unit of the change layer; its colour-scale saturation is per channel (see ChannelRasters) */
  changeScale: { unit: string };
  earlier: Acquisition;
  later: Acquisition;
  temporalBaselineDays: number;
  limitations: string[];
}

export interface Manifest {
  schemaVersion: number;
  generatedBy: string;
  dataset: {
    status: DatasetStatus;
    source: string;
    access: string;
    limitations: string[];
  };
  studyArea: {
    id: string;
    name: string;
    region: string;
    country: string;
    phenomenon: string;
    description: string;
    bounds: { west: number; south: number; east: number; north: number };
    boundary: [number, number][];
    center: [number, number];
    pixelSizeMetersApprox: number;
    rasterSize: { width: number; height: number };
  };
  acquisitionPair: {
    sensor: string;
    band: string;
    productType: string;
    collection: string;
    maturity: string;
    crid: string;
    processingSoftwareVersion: string;
    orbitDirection: string;
    path: number;
    frame: number;
    polarisations: string[];
    temporalBaselineDays: number;
    earlier: Acquisition;
    later: Acquisition;
  };
  encoding: RasterEncoding;
  changeScale: {
    saturation: number;
    unit: string;
    description: string;
  };
  rasters: Record<
    string,
    {
      layer: string;
      before: string;
      after: string;
    }
  >;
}

/** Prepared dataset reference: a locally prepared pair and its raster window. */
export interface PreparedDataset {
  manifest: Manifest;
  /** product IDs of the prepared pair */
  beforeId: string;
  afterId: string;
}

export async function loadManifest(url = `${import.meta.env.BASE_URL}data/manifest.json`): Promise<Manifest> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Could not load data/manifest.json (${res.status})`);
  }
  return (await res.json()) as Manifest;
}

export function rasterUrl(relativePath: string): string {
  return `${import.meta.env.BASE_URL}data/${relativePath}`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Deterministic UTC formatting: "25 Oct 2026, 03:42 UTC". */
export function formatAcquisitionTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  );
}

/** Short date form: "25 Oct 2026". */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function datasetStatusLabel(status: DatasetStatus): string {
  switch (status) {
    case "nisar_quicklook":
      return "NISAR data · quicklook";
    case "nisar_calibrated":
      return "NISAR data · calibrated";
    case "demo":
      return "Demo data";
  }
}

export function datasetStatusNote(status: DatasetStatus): string {
  switch (status) {
    case "nisar_quicklook":
      return "Real NISAR L2 GCOV observations, displayed as ASF quicklook renderings (display DN, not calibrated backscatter).";
    case "nisar_calibrated":
      return "Calibrated NISAR L2 GCOV backscatter (dB).";
    case "demo":
      return "Illustrative SAR fixture, not a real observation.";
  }
}

export function availabilityLabel(availability: RasterAvailability): string {
  switch (availability) {
    case "calibrated":
      return "Calibrated raster ready";
    case "quicklook":
      return "Quicklook raster ready (display DN)";
    case "metadata-only":
      return "Metadata only — raster not prepared";
  }
}

/** Layer label for a polarisation channel of a GCOV product. */
export function layerLabel(pol: string): string {
  switch (pol) {
    case "HH":
      return "C11 (HHHH)";
    case "HV":
      return "C22 (HVHV)";
    case "VV":
      return "C11 (VVVV)";
    case "VH":
      return "C22 (VHVH)";
    default:
      return `${pol}${pol}`;
  }
}
