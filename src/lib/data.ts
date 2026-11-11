// Types and loaders for the prepared observation dataset.
// The dataset is described by public/data/manifest.json, which is produced by
// the scripts in scripts/ and is the single source of truth for study areas,
// acquisitions and raster encodings. Adding another study area later means
// adding entries there (and their rasters), not changing this code.

export type DatasetStatus = "nisar_quicklook" | "nisar_calibrated" | "demo";

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

export async function loadManifest(): Promise<Manifest> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/manifest.json`);
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
