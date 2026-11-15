export type DatasetStatus = "nisar_quicklook" | "nisar_calibrated" | "demo";

export type RasterAvailability =
  | "calibrated"
  | "quicklook"
  | "metadata-only";

export interface RasterEncoding {
  type: "quicklook_dn" | "db_linear";
  unit: string;
  nodata: number;
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

export interface PreparedDataset {
  manifest: Manifest;
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

export function formatAcquisitionTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  );
}

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
