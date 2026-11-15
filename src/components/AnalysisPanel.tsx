import { Download, FileJson, FileSpreadsheet, Map as MapIcon, PlayCircle } from "lucide-react";
import type { AnalysisJob, AnalysisResult } from "../lib/analysisApi";
import { artifactUrl } from "../lib/analysisApi";
import { formatCount, formatPlain } from "../lib/format";
import { KeyRow, Section, Spinner } from "./ui";

export interface AnalysisState {
  status: "idle" | "running" | "done" | "error";
  job?: AnalysisJob;
  message?: string;
}

interface AnalysisPanelProps {
  state: AnalysisState;
  polarisation: string;
  beforeDate: string;
  afterDate: string;
  onRun: () => void;
}

const AUTH_HELP =
  "The analysis server has no Earthdata credentials. Set NASA_EARTHDATA_BEARER_TOKEN in the environment of processing/serve.py (e.g. in .env.local next to the repository root) and restart it.";

function ServiceHelp() {
  return (
    <>
      The calibrated analysis runs in the local Python pipeline. Start it with{" "}
      <code className="vx-code">python processing/serve.py</code> (credentials come from{" "}
      <code className="vx-code">NASA_EARTHDATA_BEARER_TOKEN</code>).
    </>
  );
}

/** Results table rows: value, unit and provenance kind of each metric. */
function MetricTable({ rows }: { rows: { metric: string; value: number | string | null; unit: string; kind: string }[] }) {
  return (
    <table className="vx-itable vx-itable--results">
      <thead>
        <tr>
          <th>Metric</th>
          <th>Result</th>
          <th>Kind</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.metric}>
            <th scope="row">{r.metric}</th>
            <td>
              {typeof r.value === "number"
                ? r.unit === "pixels"
                  ? formatCount(Math.round(r.value))
                  : formatPlain(r.value)
                : (r.value ?? "—")}{" "}
              <span className="vx-itable__sub">{r.unit}</span>
            </td>
            <td>
              <span className="vx-itable__sub">{r.kind}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ResultBody({ result }: { result: AnalysisResult }) {
  const a = result.areaEstimates;
  const s = result.statistics;
  return (
    <>
      <KeyRow label="Method">
        {result.processing.eventMethod} · threshold {result.processing.methodParameters.change_db} dB ·{" "}
        {result.processing.methodParameters.direction}
      </KeyRow>
      <KeyRow label="Polarisation">
        {result.productMetadata.polarisation} · {result.productMetadata.frequencyBand}
      </KeyRow>
      <KeyRow label="Quality">
        {(result.processing.quality.validFraction * 100).toFixed(1)}% valid pixels · grid overlap{" "}
        {result.processing.quality.overlapFraction !== null
          ? `${(result.processing.quality.overlapFraction * 100).toFixed(0)}%`
          : "—"}{" "}
        · speckle filtering: {result.processing.quality.speckleFiltering}
      </KeyRow>

      <div className="vx-instr-scroll mt-3" role="region" aria-label="Area results, scrollable" tabIndex={0}>
        <MetricTable
          rows={[
            { metric: "Area of interest", value: a.aoi_area_km2, unit: "km²", kind: "derived" },
            { metric: "Valid analysed area", value: a.valid_analysed_area_km2, unit: "km²", kind: "derived" },
            {
              metric: "Candidate disturbed area",
              value: a.candidate_changed_area_km2,
              unit: `km² (${formatCount(Math.round(a.candidate_changed_area_hectares))} ha)`,
              kind: "estimate",
            },
            {
              metric: "Candidate disturbance (valid area)",
              value: a.candidate_changed_percent_of_valid,
              unit: "%",
              kind: "estimate",
            },
            { metric: "Valid pixels", value: a.valid_pixels, unit: "pixels", kind: "measured" },
            { metric: "Changed pixels", value: a.changed_pixels, unit: "pixels", kind: "classification" },
            { metric: "Mean change", value: s.mean_difference_db, unit: "dB", kind: "measured" },
            { metric: "Median change", value: s.median_difference_db, unit: "dB", kind: "measured" },
            { metric: "Std of change", value: s.std_difference_db, unit: "dB", kind: "measured" },
          ]}
        />
      </div>
      <p className="vx-note mt-2">{a.note}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <a className="vx-button vx-button--ghost vx-button--compact" href={artifactUrl(result.analysisId, "results.json")} download>
          <FileJson size={14} aria-hidden /> JSON
        </a>
        <a className="vx-button vx-button--ghost vx-button--compact" href={artifactUrl(result.analysisId, "change_summary.csv")} download>
          <FileSpreadsheet size={14} aria-hidden /> CSV
        </a>
        <a className="vx-button vx-button--ghost vx-button--compact" href={artifactUrl(result.analysisId, "change_map.tif")} download>
          <Download size={14} aria-hidden /> GeoTIFF
        </a>
        <a className="vx-button vx-button--ghost vx-button--compact" href={artifactUrl(result.analysisId, "pixels.csv")} download>
          <MapIcon size={14} aria-hidden /> Pixels CSV
        </a>
      </div>
    </>
  );
}

export default function AnalysisPanel({
  state,
  polarisation,
  beforeDate,
  afterDate,
  onRun,
}: AnalysisPanelProps) {
  const result = state.job?.result;
  return (
    <Section
      title="Calibrated analysis"
      right={
        <span className="vx-section__summary">
          {state.status === "running" ? "live · processing" : result ? "live · calibrated" : "live data"}
        </span>
      }
    >
      <p className="vx-note mb-3">
        Retrieval of calibrated GCOV measurements and scientific change analysis by the Python
        pipeline (NASA Harmony subset → dB statistics → candidate-area estimates), for {polarisation}{" "}
        between {beforeDate} and {afterDate}.
      </p>

      {state.status === "idle" && (
        <button type="button" className="vx-button vx-button--primary vx-button--block" onClick={onRun}>
          <PlayCircle size={16} aria-hidden />
          Run calibrated analysis
        </button>
      )}

      {state.status === "running" && (
        <div role="status">
          <div
            className="vx-progress mb-2"
            role="progressbar"
            aria-label="Calibrated analysis progress"
            aria-valuenow={Math.round(state.job?.percent ?? 0)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="vx-progress__fill"
              style={{ width: `${Math.max(2, Math.min(100, state.job?.percent ?? 2))}%` }}
            />
          </div>
          <div className="vx-note">
            <Spinner /> {state.job?.progress ?? "starting"}…
          </div>
        </div>
      )}

      {state.status === "error" && (
        <div className="vx-notice mt-2" data-tone="error" role="alert">
          <h4>Analysis unavailable</h4>
          <p>{state.message}</p>
          {state.message?.includes("NASA_EARTHDATA_BEARER_TOKEN") && <p>{AUTH_HELP}</p>}
          {state.message?.includes("analysis service") && (
            <p>
              <ServiceHelp />
            </p>
          )}
          <button type="button" className="vx-button vx-button--ghost vx-button--compact mt-2" onClick={onRun}>
            Retry
          </button>
        </div>
      )}

      {state.status === "done" && result && <ResultBody result={result} />}
    </Section>
  );
}
