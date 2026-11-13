import { memo, type ReactNode } from "react";
import { METHOD_VERSION } from "../lib/selection";
import { formatCount, formatPlain, formatSigned } from "../lib/format";
import type { ChannelStats, PairStats } from "../lib/usePairStats";
import type { ViewState } from "../lib/viewState";
import { Spinner } from "./ui";

interface ResultsTableProps {
  status: ViewState;
  stats: PairStats | null;
  /** selected channel (always one the pair has loaded) */
  channel: string;
  /** show every ready channel side by side (the parent computes their statistics) */
  both: boolean;
  onBoth: (both: boolean) => void;
}

const CAVEAT =
  "ASF browse images are stretched per scene (about 5% of valid pixels clip at each end), so the size of a difference is partly a rendering artefact. Values are display brightness, not calibrated gamma-0 backscatter.";

function Message({ busy, children }: { busy?: boolean; children: string }) {
  return (
    <p className="vx-instr-empty" role="status">
      {busy && <Spinner />}
      <span>{children}</span>
    </p>
  );
}

interface Row {
  key: string;
  label: string;
  /** the value cell; the unit of the difference rows is in the column header */
  value: (c: ChannelStats) => ReactNode;
  note: string;
}

const ROWS: Row[] = [
  {
    key: "mean",
    label: "Mean change",
    value: (c) => formatSigned(c.change.mean),
    note: "Average of after − before over valid pixels; pulled by extreme pixels.",
  },
  {
    key: "median",
    label: "Median change",
    value: (c) => formatSigned(c.change.median),
    note: "Typical pixel difference; robust to extreme pixels.",
  },
  {
    key: "iqr",
    label: "Interquartile range (p25 to p75)",
    value: (c) => `${formatSigned(c.change.p25)} to ${formatSigned(c.change.p75)}`,
    note: "Spread of the middle half of pixel differences; not an uncertainty.",
  },
  {
    key: "p1090",
    label: "p10 to p90",
    value: (c) => `${formatSigned(c.change.p10)} to ${formatSigned(c.change.p90)}`,
    note: "Spread of the middle 80% of pixel differences.",
  },
  {
    key: "coverage",
    label: "Valid-data coverage",
    value: (c) => (
      <>
        {formatPlain(c.change.validFraction * 100)}%
        <span className="vx-itable__sub">
          {formatCount(c.change.validPixels)} of {formatCount(c.change.totalPixels)} px
        </span>
      </>
    ),
    note: "Pixels valid in both scenes ÷ pixels in the area of interest. Others are excluded from every statistic.",
  },
];

function ResultsTable({ status, stats, channel, both, onBoth }: ResultsTableProps) {
  if (status.kind === "loading-raster") return <Message busy>Loading comparison…</Message>;
  if (status.kind === "metadata-only") {
    return <Message>Metadata only: quicklook rasters are not available for this pair, so no statistics are calculated.</Message>;
  }
  if (status.kind === "error" && status.source === "pair") {
    return <Message>The comparison could not be loaded, so no statistics are calculated.</Message>;
  }
  if (status.kind === "no-valid-pixels") {
    return <Message>No pixel is valid in both observations, so no statistics can be calculated for this area.</Message>;
  }
  const own = stats?.byChannel[channel];
  if (status.kind !== "ready" || !stats || !own) {
    return <Message>Load a comparison to calculate statistics</Message>;
  }

  const channels = both && stats.channels.length > 1 ? stats.channels : [channel];
  const unit = own.change.unit;

  return (
    <div className="vx-instr-scroll" role="region" aria-label="Results table, scrollable" tabIndex={0}>
      <table className="vx-itable vx-itable--results">
        <caption className="sr-only">
          Radar brightness change, after − before · {channels.join(" and ")} · {unit}
        </caption>
        <thead>
          <tr>
            <th scope="col">Measurement</th>
            {channels.map((c) => (
              <th key={c} scope="col" className="vx-itable__num">
                {channels.length > 1 ? `${c} · ` : ""}
                {unit}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.key}>
              <th scope="row">
                <span className="vx-itable__name">{r.label}</span>
                <span className="vx-itable__sub vx-itable__note" title={r.note}>
                  {r.note}
                </span>
              </th>
              {channels.map((c) => (
                <td key={c} className="vx-itable__num">
                  {stats.byChannel[c] ? r.value(stats.byChannel[c]) : "—"}
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <th scope="row">
              <span className="vx-itable__name">Affected area</span>
              <span className="vx-itable__sub vx-itable__note" title="Needs a classification method, change mask, pixel areas and validation — not available from browse quicklooks.">
                Needs a classification method, change mask, pixel areas and validation — not available from
                browse quicklooks.
              </span>
            </th>
            <td className="vx-itable__num" colSpan={channels.length}>
              Not calculated
            </td>
          </tr>
        </tbody>
      </table>
      <p className="vx-instr-foot">
        {stats.channels.length > 1 && (
          <button
            type="button"
            className="vx-itable__link vx-itable__link--first"
            aria-pressed={both}
            onClick={() => onBoth(!both)}
          >
            {both ? "Show selected channel only" : `Show ${stats.channels.join(" and ")} side by side`}
          </button>
        )}
        <span className="vx-mono">
          Method {METHOD_VERSION} · after − before · {channels.join(" + ")} · unit {unit}
        </span>
        <br />
        {CAVEAT}
      </p>
    </div>
  );
}

export default memo(ResultsTable);
