import type { ChangeSummary } from "../lib/changeDetection";
import type { Manifest } from "../lib/data";
import { formatAcquisitionTime } from "../lib/data";

export interface AiExplanation {
  observedSignal: string;
  possibleIndication: string;
  limitations: string;
}

export interface AiState {
  status: "idle" | "loading" | "done" | "error";
  explanation?: AiExplanation;
  message?: string;
}

interface ObservationInfoProps {
  manifest: Manifest;
  pol: string;
  summary: ChangeSummary | null;
  ai: AiState;
  onExplain: () => void;
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[92px_1fr] items-start gap-x-3 py-1">
      <dt className="text-[11px] leading-[1.6] text-app-muted">{label}</dt>
      <dd className="min-w-0 text-[12px] leading-[1.6] text-app-text">
        {children}
      </dd>
    </div>
  );
}

function formatNumber(n: number, unit: string): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)} ${unit}`;
}

export default function ObservationInfo({
  manifest,
  pol,
  summary,
  ai,
  onExplain,
}: ObservationInfoProps) {
  const { acquisitionPair, encoding, dataset } = manifest;

  return (
    <section className="border-b border-app-border px-4 py-3.5">
      <h2 className="text-[11px] font-medium tracking-[0.06em] text-app-muted uppercase">
        Observation info
      </h2>

      <dl className="mt-2 divide-y divide-app-border/60">
        <Row label="Study area">
          {manifest.studyArea.name}, {manifest.studyArea.country}
        </Row>
        <Row label="Earlier acq.">
          {formatAcquisitionTime(acquisitionPair.earlier.startTime)}
        </Row>
        <Row label="Later acq.">
          {formatAcquisitionTime(acquisitionPair.later.startTime)}
        </Row>
        <Row label="Sensor band">
          {acquisitionPair.sensor} · {acquisitionPair.band} ·{" "}
          {acquisitionPair.productType}
        </Row>
        <Row label="Polarisation">
          {pol} · {manifest.rasters[pol]?.layer ?? "—"}
        </Row>
        <Row label="Product ID">
          <div className="space-y-0.5">
            <div className="break-all font-mono text-[10px] leading-[1.5] text-app-muted">
              {acquisitionPair.earlier.productId}
            </div>
            <div className="break-all font-mono text-[10px] leading-[1.5] text-app-muted">
              {acquisitionPair.later.productId}
            </div>
          </div>
        </Row>
        <Row label="Source">
          <a
            href="https://nisar-docs.asf.alaska.edu/"
            target="_blank"
            rel="noreferrer"
            className="text-app-accent underline decoration-app-border underline-offset-2 hover:decoration-app-accent"
          >
            {dataset.source}
          </a>
        </Row>
        <Row label="Unit">{encoding.unit}</Row>
        <Row label="Difference">
          {summary && summary.validPixels > 0 ? (
            <div>
              <div>
                median {formatNumber(summary.median, summary.unit)} · mean{" "}
                {formatNumber(summary.mean, summary.unit)}
              </div>
              <div className="text-[11px] text-app-muted">
                IQR {formatNumber(summary.p25, summary.unit)} to{" "}
                {formatNumber(summary.p75, summary.unit)} ·{" "}
                {(summary.validFraction * 100).toFixed(1)}% valid pixels
              </div>
            </div>
          ) : (
            "Not calculated"
          )}
        </Row>
      </dl>

      <div className="mt-3">
        <button
          type="button"
          onClick={onExplain}
          disabled={ai.status === "loading"}
          className="rounded-[3px] border border-app-border bg-white px-3 py-1.5 text-[12px] text-app-text hover:bg-app-subtle disabled:opacity-60"
        >
          {ai.status === "loading" ? "Requesting…" : "Explain this change"}
        </button>

        {ai.status === "error" && (
          <p className="mt-2 text-[11px] leading-[1.5] text-app-muted">
            {ai.message}
          </p>
        )}

        {ai.status === "done" && ai.explanation && (
          <div className="mt-2 space-y-1.5 rounded-[3px] border border-app-border bg-app-subtle px-3 py-2.5">
            <div>
              <div className="text-[10px] font-medium tracking-[0.06em] text-app-muted uppercase">
                Observed signal
              </div>
              <p className="mt-0.5 text-[11px] leading-[1.55] text-app-text">
                {ai.explanation.observedSignal}
              </p>
            </div>
            <div>
              <div className="text-[10px] font-medium tracking-[0.06em] text-app-muted uppercase">
                Possible indication
              </div>
              <p className="mt-0.5 text-[11px] leading-[1.55] text-app-text">
                {ai.explanation.possibleIndication}
              </p>
            </div>
            <div>
              <div className="text-[10px] font-medium tracking-[0.06em] text-app-muted uppercase">
                Cannot be concluded
              </div>
              <p className="mt-0.5 text-[11px] leading-[1.55] text-app-text">
                {ai.explanation.limitations}
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
