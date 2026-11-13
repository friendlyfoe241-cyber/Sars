import { memo, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { changeColour } from "../lib/changeDetection";
import { formatAcquisitionTime, formatDate } from "../lib/data";
import { formatCount, formatPlain, formatSigned, formatTick } from "../lib/format";
import type { PairStats } from "../lib/usePairStats";
import type { ViewState } from "../lib/viewState";
import { useElementSize } from "../ui/useElementSize";
import { Spinner } from "./ui";

export type GraphView = "date" | "change";

interface TemporalGraphProps {
  status: ViewState;
  stats: PairStats | null;
  channel: string;
  view: GraphView;
  onView: (v: GraphView) => void;
}

// Wording follows the dataset encoding, as the change view does: display-DN
// quicklooks are stretched per scene; other encodings are plain stored DN.
const CAPTION_DN =
  "Per-scene stretched browse brightness — not comparable in magnitude between dates; not calibrated gamma-0.";
const CAPTION_STORED = "Stored 8-bit raster values of each acquisition, over pixels valid in both dates.";
const DAY = 86_400_000;
const M = { l: 48, r: 14, t: 22, b: 34 };

interface Tip {
  x: number;
  y: number;
  title: string;
  lines: string[];
}

function Message({ busy, children }: { busy?: boolean; children: string }) {
  return (
    <p className="orb-instr-empty" role="status">
      {busy && <Spinner />}
      <span>{children}</span>
    </p>
  );
}

function Tooltip({ tip, w }: { tip: Tip | null; w: number }) {
  if (!tip) return null;
  const right = tip.x > w * 0.6;
  return (
    <div
      className="orb-tip"
      role="presentation"
      style={{ top: Math.max(0, tip.y), ...(right ? { right: w - tip.x + 10 } : { left: tip.x + 10 }) }}
    >
      <strong>{tip.title}</strong>
      {tip.lines.map((l) => (
        <span key={l}>{l}</span>
      ))}
    </div>
  );
}

// ---- By date ---------------------------------------------------------------

function ByDatePlot({
  stats,
  channel,
  w,
  h,
  setTip,
}: {
  stats: PairStats;
  channel: string;
  w: number;
  h: number;
  setTip: (t: Tip | null) => void;
}) {
  const own = stats.byChannel[channel];
  const secondary = channel !== "HH"; // HH is cyan; any other channel is the lavender, dashed, hollow variant
  const colour = secondary ? "var(--orb-data-secondary)" : "var(--orb-data-decrease)";
  const pw = Math.max(10, w - M.l - M.r);
  const ph = Math.max(10, h - M.t - M.b);

  // chronological marks: index into own.dates keeps the stats <-> acquisition link
  const marks = useMemo(
    () =>
      stats.acquisitions
        .map((a, i) => ({ a, i, t: Date.parse(a.startTime) }))
        .sort((p, q) => p.t - q.t),
    [stats.acquisitions],
  );
  const tmin = marks[0].t;
  const tmax = marks[marks.length - 1].t;
  const pad = ((tmax - tmin) || 7 * DAY) * 0.25;
  const d0 = tmin - pad;
  const d1 = tmax + pad;
  const x = (t: number) => M.l + ((t - d0) / (d1 - d0)) * pw;
  const y = (dn: number) => M.t + (1 - dn / 255) * ph;
  const yTicks = [0, 64, 128, 192, 255];
  const names = { before: "Before", after: "After" } as const;
  const dnName = stats.displayDn ? "display DN" : "stored DN";
  const dn = (n: number) => formatPlain(n);

  const describe = (i: number, role: "before" | "after", iso: string) => {
    const d = own.dates.dates[i];
    return {
      title: `${names[role]} · ${formatAcquisitionTime(iso)}`,
      lines: [
        `Median ${dn(d.median)} ${dnName}`,
        `p25 to p75: ${dn(d.p25)} to ${dn(d.p75)}`,
        `p10 to p90: ${dn(d.p10)} to ${dn(d.p90)}`,
        `${formatCount(own.dates.validPixels)} common valid pixels`,
      ],
    };
  };

  let lastLabelX = -Infinity;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="group" aria-label={`Brightness by acquisition date, ${channel}`}>
      <text className="orb-axis" x={M.l} y={12}>
        {w < 430 ? "dot median · bar p25–p75 · line p10–p90" : `${channel} ${secondary ? "dashed, hollow" : "solid"} · dot median · bar p25–p75 · whisker p10–p90`}
      </text>
      {yTicks.map((v) => (
        <g key={v}>
          <line className="orb-grid" x1={M.l} x2={M.l + pw} y1={y(v)} y2={y(v)} />
          <text className="orb-axis" x={M.l - 8} y={y(v) + 4} textAnchor="end">
            {v}
          </text>
        </g>
      ))}
      <line className="orb-axisline" x1={M.l} x2={M.l} y1={M.t} y2={M.t + ph} />
      <line className="orb-axisline" x1={M.l} x2={M.l + pw} y1={M.t + ph} y2={M.t + ph} />
      <text
        className="orb-axis orb-axis--title"
        transform={`translate(12 ${M.t + ph / 2}) rotate(-90)`}
        textAnchor="middle"
      >
        {stats.displayDn ? "Display DN" : "Stored DN"}
      </text>
      <text className="orb-axis orb-axis--title" x={M.l + pw / 2} y={h - 3} textAnchor="middle">
        Acquisition date (UTC)
      </text>

      {marks.map(({ a, i, t }) => {
        const d = own.dates.dates[i];
        const cx = x(t);
        const stagger = cx - lastLabelX < 150;
        lastLabelX = cx;
        const tip = describe(i, a.role, a.startTime);
        const label = `${tip.title}. ${tip.lines.join("; ")}`;
        const show = () => setTip({ x: cx, y: Math.max(0, y(d.p90) - 6), ...tip });
        return (
          <g key={a.productId}>
            <line className="orb-grid orb-grid--v" x1={cx} x2={cx} y1={M.t} y2={M.t + ph} />
            <line className="orb-axisline" x1={cx} x2={cx} y1={M.t + ph} y2={M.t + ph + 4} />
            <text className="orb-axis" x={cx} y={M.t + ph + 16 + (stagger ? 13 : 0)} textAnchor="middle">
              <tspan className="orb-axis--role">{names[a.role]}</tspan> · {formatDate(a.startTime)}
            </text>
            <g
              className="orb-mark"
              tabIndex={0}
              role="img"
              aria-label={label}
              onMouseEnter={show}
              onMouseLeave={() => setTip(null)}
              onFocus={show}
              onBlur={() => setTip(null)}
            >
              <rect className="orb-mark__hit" x={cx - 28} y={M.t} width={56} height={ph} />
              <line
                x1={cx}
                x2={cx}
                y1={y(d.p90)}
                y2={y(d.p10)}
                stroke={colour}
                strokeWidth={1.5}
                strokeDasharray={secondary ? "4 3" : undefined}
              />
              {[d.p10, d.p90].map((v) => (
                <line key={v} x1={cx - 6} x2={cx + 6} y1={y(v)} y2={y(v)} stroke={colour} strokeWidth={1.5} />
              ))}
              <rect
                x={cx - 10}
                y={y(d.p75)}
                width={20}
                height={Math.max(2, y(d.p25) - y(d.p75))}
                fill={secondary ? "var(--orb-bg)" : colour}
                fillOpacity={secondary ? 0.9 : 0.85}
                stroke={colour}
                strokeWidth={secondary ? 2 : 1}
                strokeDasharray={secondary ? "4 3" : undefined}
              />
              <circle
                cx={cx}
                cy={y(d.median)}
                r={5.5}
                fill={secondary ? "var(--orb-bg)" : "var(--orb-text)"}
                stroke={secondary ? colour : "var(--orb-bg)"}
                strokeWidth={2}
              />
            </g>
          </g>
        );
      })}
    </svg>
  );
}

// ---- Change distribution ----------------------------------------------------

const R_STEPS = [10, 20, 30, 40, 60, 80, 100, 150, 200, 255];

interface Bin {
  k: number;
  centre: number;
  share: number;
}

function buildBins(stats: PairStats, channel: string) {
  const { delta, saturation } = stats.byChannel[channel];
  const counts = delta.counts;
  const valid = delta.valid;
  const mid = 255;
  // extent holding all but the outer 0.25% on each side
  const cut = valid * 0.0025;
  let lo = 0;
  let acc = 0;
  for (let i = 0; i < counts.length; i++) {
    acc += counts[i];
    if (acc > cut) {
      lo = i - mid;
      break;
    }
  }
  let hi = 0;
  acc = 0;
  for (let i = counts.length - 1; i >= 0; i--) {
    acc += counts[i];
    if (acc > cut) {
      hi = i - mid;
      break;
    }
  }
  const want = Math.max(Math.abs(lo), Math.abs(hi), saturation * 1.25, 10);
  const R = R_STEPS.find((r) => r >= want) ?? 255;
  let b = Math.ceil((2 * R) / 45);
  if (b % 2 === 0) b += 1;
  const kmax = Math.floor(R / b);
  const bins: Bin[] = [];
  for (let k = -kmax; k <= kmax; k++) bins.push({ k, centre: k * b, share: 0 });
  let outside = 0;
  for (let i = 0; i < counts.length; i++) {
    const c = counts[i];
    if (!c) continue;
    const k = Math.round((i - mid) / b);
    if (Math.abs(k) > kmax) outside += c;
    else bins[k + kmax].share += c;
  }
  for (const bin of bins) bin.share = (bin.share / valid) * 100;
  const peak = Math.max(...bins.map((x) => x.share));
  const steps = [1, 2, 5, 10, 20, 25, 50, 100];
  const ymax = steps.find((s) => s >= peak * 1.05) ?? 100;
  return { bins, b, R: kmax * b, ymax, outside: (outside / valid) * 100, saturation, valid };
}

function DeltaPlot({
  stats,
  channel,
  w,
  h,
  setTip,
}: {
  stats: PairStats;
  channel: string;
  w: number;
  h: number;
  setTip: (t: Tip | null) => void;
}) {
  const g = useMemo(() => buildBins(stats, channel), [stats, channel]);
  const [cursor, setCursor] = useState(0);
  const pw = Math.max(10, w - M.l - M.r);
  const ph = Math.max(10, h - M.t - M.b - 8);
  const half = g.b / 2;
  const x = (v: number) => M.l + ((v + g.R + half) / (2 * g.R + g.b)) * pw;
  const y = (s: number) => M.t + (1 - s / g.ymax) * ph;
  const bw = Math.max(1, (pw / (2 * g.R + g.b)) * g.b - 1);
  const tickStep = g.R <= 20 ? 10 : g.R <= 40 ? 20 : g.R <= 100 ? 50 : 100;
  const xTicks: number[] = [];
  for (let v = -Math.floor(g.R / tickStep) * tickStep; v <= g.R; v += tickStep) xTicks.push(v);
  const yTicks = [0, g.ymax / 2, g.ymax];
  const idx = Math.min(Math.max(cursor, 0), g.bins.length - 1);

  const describe = (bin: Bin) => {
    const lo = bin.centre - (g.b - 1) / 2;
    const hi = bin.centre + (g.b - 1) / 2;
    return {
      title: g.b === 1 ? `Difference ${formatTick(bin.centre)} display DN` : `Difference ${formatTick(lo)} to ${formatTick(hi)} display DN`,
      lines: [`${bin.share.toFixed(2)}% of valid pixels`],
    };
  };
  const showBin = (i: number) => {
    const bin = g.bins[i];
    if (!bin) return;
    setTip({ x: x(bin.centre), y: Math.max(0, y(bin.share) - 8), ...describe(bin) });
  };
  const onKey = (e: KeyboardEvent) => {
    let next = idx;
    if (e.key === "ArrowRight") next = idx + 1;
    else if (e.key === "ArrowLeft") next = idx - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = g.bins.length - 1;
    else return;
    e.preventDefault();
    next = Math.min(Math.max(next, 0), g.bins.length - 1);
    setCursor(next);
    showBin(next);
  };
  const cur = g.bins[idx];

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="group" aria-label={`Distribution of pixel differences, ${channel}`}>
      <text className="orb-axis" x={M.l} y={12}>
        {w < 430 ? `dashed: ±${g.saturation} map limits` : `dashed: ±${g.saturation} display DN map colour limits`}
        {g.outside >= 0.05 && w >= 430 ? ` · ${g.outside.toFixed(1)}% beyond ±${g.R}` : ""}
      </text>
      {yTicks.map((v) => (
        <g key={v}>
          <line className="orb-grid" x1={M.l} x2={M.l + pw} y1={y(v)} y2={y(v)} />
          <text className="orb-axis" x={M.l - 8} y={y(v) + 4} textAnchor="end">
            {v}
          </text>
        </g>
      ))}
      <text
        className="orb-axis orb-axis--title"
        transform={`translate(12 ${M.t + ph / 2}) rotate(-90)`}
        textAnchor="middle"
      >
        % of valid pixels
      </text>
      <g
        className="orb-mark orb-mark--plot"
        tabIndex={0}
        role="application"
        aria-roledescription="histogram"
        aria-label={`Histogram of after minus before, ${channel}. Left and right arrow keys step through bins.${cur ? ` Current bin: ${describe(cur).title}, ${describe(cur).lines[0]}.` : ""}`}
        onKeyDown={onKey}
        onFocus={() => showBin(idx)}
        onBlur={() => setTip(null)}
        onMouseLeave={() => setTip(null)}
      >
        <rect className="orb-mark__hit" x={M.l} y={M.t} width={pw} height={ph} />
        {g.bins.map((bin, i) => {
          const [r, gr, bl] = changeColour(bin.centre, g.saturation);
          const top = y(bin.share);
          return (
            <rect
              key={bin.k}
              x={x(bin.centre) - bw / 2}
              y={top}
              width={bw}
              height={Math.max(0, M.t + ph - top)}
              fill={`rgb(${r},${gr},${bl})`}
              stroke={i === idx ? "var(--orb-text)" : "none"}
              strokeWidth={1}
              onMouseEnter={() => {
                setCursor(i);
                showBin(i);
              }}
            />
          );
        })}
      </g>
      {[-g.saturation, g.saturation].map((v) => (
        <line
          key={v}
          x1={x(v)}
          x2={x(v)}
          y1={M.t}
          y2={M.t + ph}
          stroke="var(--orb-text-muted)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      ))}
      <line x1={x(0)} x2={x(0)} y1={M.t} y2={M.t + ph} stroke="var(--orb-text)" strokeWidth={1.5} />
      <text className="orb-axis" x={x(0) + 5} y={M.t + 11}>
        0 · no difference
      </text>
      <line className="orb-axisline" x1={M.l} x2={M.l + pw} y1={M.t + ph} y2={M.t + ph} />
      {xTicks.map((v) => (
        <g key={v}>
          <line className="orb-axisline" x1={x(v)} x2={x(v)} y1={M.t + ph} y2={M.t + ph + 4} />
          <text className="orb-axis" x={x(v)} y={M.t + ph + 17} textAnchor="middle">
            {formatTick(v)}
          </text>
        </g>
      ))}
      <text className="orb-axis orb-axis--title" x={M.l + pw / 2} y={h - 3} textAnchor="middle">
        Difference, after − before (display DN)
      </text>
    </svg>
  );
}

// ---- Panel body ---------------------------------------------------------------

function TemporalGraph({ status, stats, channel, view, onView }: TemporalGraphProps) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  // A tooltip belongs to the data it was opened on.
  useEffect(() => setTip(null), [stats, channel, view]);

  const own = stats?.byChannel[channel];
  let message: string | null = null;
  let busy = false;
  if (status.kind === "loading-raster") {
    message = "Loading comparison…";
    busy = true;
  } else if (status.kind === "metadata-only") {
    message = "Metadata only: no quicklook rasters, so nothing to plot.";
  } else if (status.kind === "error" && status.source === "pair") {
    message = "The comparison could not be loaded, so nothing is plotted.";
  } else if (status.kind === "no-valid-pixels") {
    message = "No pixel is valid in both observations, so there are no common valid pixels to plot.";
  } else if (status.kind !== "ready" || !stats || !own) {
    message = "Load a comparison to plot brightness by date";
  } else if (view === "change" && !stats.displayDn) {
    message = "The change distribution is shown for display-DN quicklook pairs only.";
  }

  const caption = stats?.displayDn === false ? CAPTION_STORED : CAPTION_DN;
  const n = stats?.acquisitions.length ?? 0;
  const context =
    own && stats
      ? view === "date"
        ? `${n} acquisitions · ${channel}`
        : `${channel} · ${formatCount(own.delta.valid)} valid px`
      : "";
  return (
    <div className="orb-graph">
      <div className="orb-graph__bar">
        <div className="orb-segment-group orb-segment-group--fill orb-graph__seg" role="group" aria-label="Graph view">
          <button type="button" className="orb-segment" aria-pressed={view === "date"} onClick={() => onView("date")}>
            By date
          </button>
          <button type="button" className="orb-segment" aria-pressed={view === "change"} onClick={() => onView("change")}>
            Change distribution
          </button>
        </div>
        <p className="orb-graph__ctx" aria-live="polite">
          {context}
        </p>
      </div>
      <div className="orb-graph__plot" ref={ref}>
        {message ? (
          <Message busy={busy}>{message}</Message>
        ) : (
          stats &&
          own &&
          size.w > 0 &&
          size.h > 0 &&
          (view === "date" ? (
            <ByDatePlot stats={stats} channel={channel} w={size.w} h={size.h} setTip={setTip} />
          ) : (
            <DeltaPlot stats={stats} channel={channel} w={size.w} h={size.h} setTip={setTip} />
          ))
        )}
        <Tooltip tip={message ? null : tip} w={size.w} />
      </div>
      <p className="orb-graph__caption" title={caption}>
        {caption}
      </p>
      {!message && own && stats && view === "date" && (
        <div className="sr-only">
        <table>
          <caption>Brightness by acquisition date, {channel}, {stats.displayDn ? "display DN" : "stored DN"}</caption>
          <thead>
            <tr>
              <th scope="col">Acquisition</th>
              <th scope="col">Median</th>
              <th scope="col">p25</th>
              <th scope="col">p75</th>
              <th scope="col">p10</th>
              <th scope="col">p90</th>
            </tr>
          </thead>
          <tbody>
            {stats.acquisitions.map((a, i) => (
              <tr key={a.productId}>
                <th scope="row">
                  {a.role === "before" ? "Before" : "After"} {formatAcquisitionTime(a.startTime)}
                </th>
                {(["median", "p25", "p75", "p10", "p90"] as const).map((k) => (
                  <td key={k}>{formatPlain(own.dates.dates[i][k])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      {!message && own && stats && view === "change" && (
        <p className="sr-only">
          Median change {formatSigned(own.change.median)} display DN; interquartile range {formatSigned(own.change.p25)}{" "}
          to {formatSigned(own.change.p75)} display DN.
        </p>
      )}
    </div>
  );
}

export default memo(TemporalGraph);
