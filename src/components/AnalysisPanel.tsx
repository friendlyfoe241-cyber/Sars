import { Download, FileJson, FileSpreadsheet, Map as MapIcon, PlayCircle } from "lucide-react";
import type { AnalysisJob, AnalysisResult } from "../lib/analysisApi";
import { artifactUrl } from "../lib/analysisApi";
import { formatCount, formatPlain } from "../lib/format";
import {
  NOT_AVAILABLE,
  analysisDirection,
  causeNote,
  directionWord,
  finite,
  fixed,
  methodLabel,
  neutralText,
  thresholdText,
} from "../lib/analysisWording";
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
              {typeof r.value === "number" && !Number.isFinite(r.value)
                ? "—"
                : typeof r.value === "number"
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

function PlainTable({ rows }: { rows: { label: string; value: string; hint: string }[] }) {
  return (
    <dl className="vx-plain">
      {rows.map((r) => (
        <div key={r.label} className="vx-plain__row">
          <dt>{r.label}</dt>
          <dd>
            <strong>{r.value}</strong>
            <span className="vx-itable__sub"> {r.hint}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function num(n: unknown, suffix = ""): string {
  return finite(n) ? `${formatPlain(n)}${suffix}` : NOT_AVAILABLE;
}

function ResultBody({ result }: { result: AnalysisResult }) {
  const a = result.areaEstimates;
  const s = result.statistics;
  const pct = a?.candidate_changed_percent_of_valid;
  const changedKm2 = a?.candidate_changed_area_km2;
  const measuredShare =
    finite(a?.valid_analysed_area_km2) && finite(a?.aoi_area_km2) && a.aoi_area_km2 > 0
      ? (a.valid_analysed_area_km2 / a.aoi_area_km2) * 100
      : null;
  const mean = s?.mean_difference_db;
  const threshold = thresholdText(result);
  const direction = directionWord(analysisDirection(result));
  const overall = !finite(mean)
    ? null
    : Math.abs(mean) < 0.5
      ? "changed by less than 0.5 dB on average"
      : mean < 0
        ? "decreased on average"
        : "increased on average";
  const hectares = a?.candidate_changed_area_hectares;
  return (
    <>
      <div className="vx-notice" data-tone="info" style={{ display: "block" }}>
        <h4 className="mb-1">In plain words</h4>
        {finite(pct) && finite(changedKm2) ? (
          <p>
            About <strong>{fixed(pct, 1)}%</strong> of the area that could be measured (
            <strong>{formatPlain(changedKm2)} km²</strong>) showed a {direction} in calibrated
            gamma-0 backscatter of at least {threshold} between the two dates.
          </p>
        ) : (
          <p>
            The share of the area with a {direction} in calibrated gamma-0 backscatter of at least{" "}
            {threshold} is not available for this run.
          </p>
        )}
        <p className="mt-2">{causeNote(result)} Treat these spots as places worth checking.</p>
        <p className="mt-2">
          {overall
            ? `Across the measured area, calibrated backscatter ${overall} (${formatPlain(mean as number)} dB).`
            : `Average change across the measured area: ${NOT_AVAILABLE}.`}
        </p>
      </div>

      <PlainTable
        rows={[
          { label: "Area you selected", value: num(a?.aoi_area_km2, " km²"), hint: "" },
          {
            label: "Area that could be measured",
            value: num(a?.valid_analysed_area_km2, " km²"),
            hint: measuredShare === null ? "" : `(${measuredShare.toFixed(0)}%, the rest had no usable data)`,
          },
          {
            label: `Area with a ${direction} of at least ${threshold}`,
            value: num(changedKm2, " km²"),
            hint: finite(hectares)
              ? `(${formatCount(Math.round(hectares))} hectares), candidate change, cause not determined, an estimate`
              : "candidate change, cause not determined, an estimate",
          },
          {
            label: "Share of measured area",
            value: finite(pct) ? `${fixed(pct, 1)}%` : NOT_AVAILABLE,
            hint: `estimate, depends on the ${threshold} threshold`,
          },
        ]}
      />

      <details className="mt-3">
        <summary className="vx-note" style={{ cursor: "pointer" }}>
          Show technical details
        </summary>
        <div className="mt-2">
          <TechnicalBody result={result} />
        </div>
      </details>
    </>
  );
}

function TechnicalBody({ result }: { result: AnalysisResult }) {
  const a = result.areaEstimates;
  const s = result.statistics;
  return (
    <>
      <KeyRow label="Method">
        {methodLabel(result.processing?.eventMethod)} · threshold {thresholdText(result)} ·{" "}
        {directionWord(analysisDirection(result))}
      </KeyRow>
      <KeyRow label="Polarisation">
        {result.productMetadata.polarisation} · {result.productMetadata.frequencyBand}
      </KeyRow>
      <KeyRow label="Quality">
        {finite(result.processing?.quality?.validFraction)
          ? `${(result.processing.quality.validFraction * 100).toFixed(1)}%`
          : NOT_AVAILABLE}{" "}
        valid pixels · grid overlap{" "}
        {finite(result.processing?.quality?.overlapFraction)
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
              metric: "Candidate changed area",
              value: a.candidate_changed_area_km2,
              unit: finite(a.candidate_changed_area_hectares)
                ? `km² (${formatCount(Math.round(a.candidate_changed_area_hectares))} ha)`
                : "km²",
              kind: "estimate",
            },
            {
              metric: "Candidate changed (valid area)",
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
      <p className="vx-note mt-2">{neutralText(a.note)}</p>

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
