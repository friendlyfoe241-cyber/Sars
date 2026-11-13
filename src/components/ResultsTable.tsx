import { memo, useState, type ReactNode } from "react";
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
}

const CAVEAT =
  "ASF browse images are stretched per scene (about 5% of valid pixels clip at each end), so the size of a difference is partly a rendering artefact. Values are display brightness, not calibrated gamma-0 backscatter.";

function Message({ busy, children }: { busy?: boolean; children: string }) {
  return (
    <p className="orb-instr-empty" role="status">
      {busy && <Spinner />}
      <span>{children}</span>
    </p>
  );
}

function Value({ children, unit }: { children: ReactNode; unit: string }) {
  return (
    <>
      <span>{children}</span> <span className="orb-itable__unit">{unit}</span>
    </>
  );
}

interface Row {
  key: string;
  label: string;
  value: (c: ChannelStats, unit: string) => ReactNode;
  note: string;
}

const ROWS: Row[] = [
  {
    key: "mean",
    label: "Mean change",
    value: (c, u) => <Value unit={u}>{formatSigned(c.change.mean)}</Value>,
    note: "Average of after − before over valid pixels; pulled by extreme pixels.",
  },
  {
    key: "median",
    label: "Median change",
    value: (c, u) => <Value unit={u}>{formatSigned(c.change.median)}</Value>,
    note: "Typical pixel difference; robust to extreme pixels.",
  },
  {
    key: "iqr",
    label: "Interquartile range (p25 to p75)",
    value: (c, u) => (
      <Value unit={u}>
        {formatSigned(c.change.p25)} to {formatSigned(c.change.p75)}
      </Value>
    ),
    note: "Spread of the middle half of pixel differences; not an uncertainty.",
  },
  {
    key: "p1090",
    label: "p10 to p90",
    value: (c, u) => (
      <Value unit={u}>
        {formatSigned(c.change.p10)} to {formatSigned(c.change.p90)}
      </Value>
    ),
    note: "Spread of the middle 80% of pixel differences.",
  },
  {
    key: "coverage",
    label: "Valid-data coverage",
    value: (c) => (
      <>
        <Value unit="% of AOI pixels">{formatPlain(c.change.validFraction * 100)}</Value>
        <span className="orb-itable__sub">
          {formatCount(c.change.validPixels)} of {formatCount(c.change.totalPixels)} px
        </span>
      </>
    ),
    note: "Pixels valid in both scenes ÷ pixels in the area of interest. Others are excluded from every statistic.",
  },
];

function ResultsTable({ status, stats, channel }: ResultsTableProps) {
  const [both, setBoth] = useState(false);

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
    <>
      <div className="orb-instr-scroll" role="region" aria-label="Results table, scrollable" tabIndex={0}>
        <table className="orb-itable">
          <caption>
            Radar brightness change, after − before · {channels.join(" and ")} · {unit}
            {stats.channels.length > 1 && (
              <button
                type="button"
                className="orb-itable__link"
                aria-pressed={both}
                onClick={() => setBoth((v) => !v)}
              >
                {both ? "Show selected channel only" : `Show ${stats.channels.join(" and ")} side by side`}
              </button>
            )}
          </caption>
          <thead>
            <tr>
              <th scope="col">Measurement</th>
              {channels.map((c) => (
                <th key={c} scope="col" className="orb-itable__num">
                  Value{channels.length > 1 ? ` · ${c}` : ""}
                </th>
              ))}
              <th scope="col">Interpretation / limitation</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.key}>
                <th scope="row">{r.label}</th>
                {channels.map((c) => (
                  <td key={c} className="orb-itable__num">
                    {stats.byChannel[c] ? r.value(stats.byChannel[c], unit) : "—"}
                  </td>
                ))}
                <td className="orb-itable__note">{r.note}</td>
              </tr>
            ))}
            <tr>
              <th scope="row">Affected area</th>
              <td className="orb-itable__num" colSpan={channels.length}>
                Not calculated
              </td>
              <td className="orb-itable__note">
                Needs a classification method, change mask, pixel areas and validation — not available from browse
                quicklooks.
              </td>
            </tr>
          </tbody>
        </table>
      <p className="orb-instr-foot">
        <span className="orb-mono">
          Method {METHOD_VERSION} · after − before · {channels.join(" + ")} · unit {unit}
        </span>
        <br />
        {CAVEAT}
      </p>
      </div>
    </>
  );
}

export default memo(ResultsTable);
