import type { ChangeSummary } from "../lib/changeDetection";
import type { ViewerDataset } from "../lib/data";
import { AlertTriangle } from "lucide-react";
import { formatPlain, formatSigned } from "../lib/format";
import { KeyRow, Section, Spinner } from "./ui";

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

interface StatsPanelProps {
  dataset: ViewerDataset;
  pol: string;
  summary: ChangeSummary | null;
  /** the Results table is on screen: link to it instead of repeating the numbers */
  statsInRow: boolean;
  onShowResults: () => void;
  ai: AiState;
  onExplain: () => void;
}

function formatNumber(n: number, unit: string): string {
  return Number.isFinite(n) ? `${formatSigned(n)} ${unit}` : "—";
}

export default function StatsPanel({ dataset, pol, summary, statsInRow, onShowResults, ai, onExplain }: StatsPanelProps) {
  const has = summary && summary.validPixels > 0;
  const unit = summary?.unit ?? dataset.changeScale.unit;
  return (
    <>
      <Section title="Radar brightness change">
        {statsInRow ? (
          <>
            <p className="vx-note mb-3">
              after − before · {pol} · {unit}. The statistics are in the Results table, with their method and
              limitations.
            </p>
            <button type="button" className="vx-button vx-button--block" onClick={onShowResults}>
              Open the Results table
            </button>
          </>
        ) : (
          <>
        <p className="vx-note mb-3">
          after − before · {pol} · {unit}. Positive and negative values describe the radar signal only.
        </p>
        <dl className="m-0">
          <KeyRow label="Median">{has ? formatNumber(summary.median, unit) : "Not calculated"}</KeyRow>
          <KeyRow label="Mean">{has ? formatNumber(summary.mean, unit) : "Not calculated"}</KeyRow>
          <KeyRow label="IQR">
            {has ? `${formatSigned(summary.p25)} to ${formatSigned(summary.p75)} ${unit}` : "Not calculated"}
          </KeyRow>
          <KeyRow label="Valid pixels">
            {summary && summary.totalPixels > 0 ? `${formatPlain(summary.validFraction * 100)}%` : "Not calculated"}
          </KeyRow>
        </dl>
        {has && summary.validFraction < 0.2 && (
          <p className="vx-note mt-2">
            Most of the selected area lies outside this pair's observation footprint.
          </p>
        )}
          </>
        )}
      </Section>

      <Section title="Explanation">
        <button
          type="button"
          onClick={onExplain}
          disabled={ai.status === "loading"}
          className="vx-button vx-button--primary vx-button--block"
        >
          {ai.status === "loading" ? <Spinner /> : null}
          {ai.status === "loading" ? "Requesting explanation" : "Explain this change"}
        </button>
        {ai.status === "idle" && (
          <p className="vx-note mt-2">
            Generates a written reading of the statistics and metadata. It does not inspect the imagery.
          </p>
        )}

        {ai.status === "error" && (
          <div className="vx-notice mt-3" data-tone="error" role="alert">
            <span className="vx-notice__icon">
              <AlertTriangle size={18} aria-hidden />
            </span>
            <h3>Explanation unavailable</h3>
            <p>{ai.message}</p>
          </div>
        )}

        {ai.status === "done" && ai.explanation && (
          <div className="mt-3 grid gap-3 rounded-[18px] bg-white/[0.06] p-4 shadow-[inset_1.5px_1.5px_0_rgba(255,255,255,0.16)]">
            {(
              [
                ["Observed signal", ai.explanation.observedSignal],
                ["Possible indication", ai.explanation.possibleIndication],
                ["Cannot be concluded", ai.explanation.limitations],
              ] as const
            ).map(([label, text]) => (
              <div key={label}>
                <div className="vx-eyebrow">{label}</div>
                <p className="m-0 mt-1 text-[13px] leading-5 text-vx-text">{text}</p>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
