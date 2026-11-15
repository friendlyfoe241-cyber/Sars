// Client for the local Python analysis API (processing/serve.py), which runs
// the scientific pipeline: catalogue discovery, pair selection, authenticated
// Harmony retrieval of calibrated GCOV data, dB change analysis and area
// calculations.  The browser never sees credentials or raw products, only the
// structured result and result-file downloads.

export interface AnalysisRequest {
  bbox: [number, number, number, number];
  eventType: string;
  beforeDate: string; // YYYY-MM-DD
  afterDate: string;
  polarisation: string;
  thresholdDb?: number;
  direction?: "decrease" | "increase" | "both";
  dateToleranceDays?: number;
}

export interface AnalysisObservation {
  id: string;
  start_time: string;
  stop_time: string;
  polarisations: string[];
  product_type: string;
  collection: string;
  maturity: string;
  orbit_direction: string;
  absolute_orbit: number | null;
  track: number | null;
  frame: number | null;
  crid: string | null;
  pge_version: string | null;
}

export interface TableRecord {
  [key: string]: string | number | null;
}

export interface AnalysisAreaEstimates {
  aoi_area_km2: number;
  valid_analysed_area_km2: number;
  candidate_changed_area_km2: number;
  candidate_changed_area_hectares: number;
  candidate_changed_percent_of_valid: number;
  candidate_changed_percent_of_aoi: number;
  valid_pixels: number;
  changed_pixels: number;
  note: string;
}

export interface AnalysisResult {
  analysisId: string;
  eventType: string;
  status: string;
  generatedUtc: string;
  mode: string;
  areaOfInterest: { bboxWestSouthEastNorth: number[]; areaKm2: number };
  observations: { before: AnalysisObservation; after: AnalysisObservation };
  selectionExplanation: string[] | null;
  acquisitionDates: { before: string; after: string; [k: string]: string };
  productMetadata: {
    productType: string;
    processingLevel: string;
    frequencyBand: string;
    polarisation: string;
    retrieval: Record<string, { job_id: string | null; variable: string | null; cached: boolean }> | null;
  };
  processing: {
    status: string;
    eventMethod: string;
    methodSummary: string;
    methodParameters: { change_db: number; direction: string; [k: string]: unknown };
    inputUnits: string;
    unitsOfResults: string;
    alignment: Record<string, unknown>;
    analysisGrid: Record<string, unknown>;
    quality: {
      validPixels: number;
      validFraction: number;
      overlapFraction: number | null;
      speckleFiltering: string;
    };
  };
  statistics: Record<string, number>;
  backscatterComparison: TableRecord[];
  changeSummary: TableRecord[];
  areaEstimates: AnalysisAreaEstimates;
  rasters: Record<string, string>;
  artifacts: string[];
  apisUsed: Record<string, string>;
  limitations: string[];
  errors: string[];
}

export interface AnalysisJob {
  analysisId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  progress: string;
  /** overall completion, 0-100 (monotonic on the worker) */
  percent?: number;
  result?: AnalysisResult;
  artifactsBase?: string;
  error?: { code: string; message: string; reasons?: string[] };
}

export interface ServiceHealth {
  ok: boolean;
  auth: { bearer_token_configured: boolean };
  events: string[];
}

/** Same origin by default (the Python server hosts the app in production and
 * the Vite dev server proxies /api in development); VITE_ANALYSIS_API points
 * at a worker on another host (e.g. Vercel + remote pipeline). */
const BASE = (import.meta.env.VITE_ANALYSIS_API as string | undefined) ?? "";

/** Base URL of the analysis worker (also hosts /api/explain-change when the
 * frontend is served statically).  Empty = same origin. */
export function analysisBase(): string {
  return BASE;
}

async function jsonFetch(path: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new AnalysisError(
      `The analysis service could not be reached${BASE ? ` at ${BASE}` : ""} (network error). ` +
        "It may be starting up, asleep, or unreachable — press Retry in a moment.",
      { error: { code: "unreachable" } },
    );
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: { message?: string } }).error?.message ?? res.status)
        : `HTTP ${res.status}`;
    throw new AnalysisError(message, body);
  }
  return body;
}

export class AnalysisError extends Error {
  code: string;
  reasons: string[];
  constructor(message: string, body: unknown) {
    super(message);
    const err = (body as { error?: { code?: string; reasons?: string[] } } | null)?.error;
    this.code = err?.code ?? "error";
    this.reasons = err?.reasons ?? [];
  }
}

export async function checkAnalysisService(signal?: AbortSignal): Promise<ServiceHealth> {
  return (await jsonFetch("/api/health", { signal })) as ServiceHealth;
}

export async function submitAnalysis(
  request: AnalysisRequest,
  signal?: AbortSignal,
): Promise<{ analysisId: string }> {
  return (await jsonFetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  })) as { analysisId: string };
}

/** Warm the worker's download cache for a pair the user is looking at
 * (fire-and-forget: any failure is silent — Run remains the real path). */
export async function prefetchAnalysis(request: AnalysisRequest): Promise<void> {
  try {
    await jsonFetch("/api/analyze/prefetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch {
    /* best-effort */
  }
}

export async function getAnalysis(id: string, signal?: AbortSignal): Promise<AnalysisJob> {
  return (await jsonFetch(`/api/analyze/${id}`, { signal })) as AnalysisJob;
}

export function artifactUrl(analysisId: string, file: string): string {
  return `${BASE}/api/artifacts/${analysisId}/${file}`;
}

/** Poll until the job reaches a terminal state (or the signal aborts). */
export async function waitForAnalysis(
  id: string,
  onUpdate?: (job: AnalysisJob) => void,
  signal?: AbortSignal,
): Promise<AnalysisJob> {
  let failures = 0;
  for (;;) {
    let job: AnalysisJob;
    try {
      job = await getAnalysis(id, signal);
      failures = 0;
    } catch (err) {
      // Tolerate transient network blips (worker restarts, brief connection
      // loss) before giving up; a job the worker has forgotten is reported
      // immediately.
      if (
        (err instanceof AnalysisError && err.code !== "unreachable") ||
        (err instanceof DOMException && err.name === "AbortError") ||
        failures >= 4
      ) {
        throw err;
      }
      failures++;
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, 3000);
        signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      });
      continue;
    }
    onUpdate?.(job);
    if (job.status === "succeeded" || job.status === "failed") return job;
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, 3000);
      signal?.addEventListener("abort", () => {
        clearTimeout(t);
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
    });
  }
}
