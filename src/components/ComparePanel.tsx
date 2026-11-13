import type { ViewerDataset } from "../lib/data";
import { formatAcquisitionTime } from "../lib/data";
import { DisclosureSection, KeyRow, Section, Spinner } from "./ui";
import type { DisplayChoice } from "../lib/useChangeLayers";
import type { ChannelStatus } from "../lib/rasterSource";

interface ComparePanelProps {
  dataset: ViewerDataset;
  /** per-channel load state; only ready channels can be selected */
  channelStatus: Record<string, ChannelStatus>;
  pol: string;
  onPolChange: (pol: string) => void;
  layer: DisplayChoice;
  onLayerChange: (layer: DisplayChoice) => void;
  /** false while no before/after pair of the selected channel is loaded */
  canCompare: boolean;
  computing: boolean;
  showAllFootprints: boolean;
  onToggleFootprints: (show: boolean) => void;
  /** frame the area of interest on the map again */
  onFit: () => void;
}

const LAYERS: { id: DisplayChoice; label: string }[] = [
  { id: "compare", label: "Compare" },
  { id: "before", label: "Before" },
  { id: "after", label: "After" },
  { id: "change", label: "Change" },
];

export default function ComparePanel({
  dataset,
  channelStatus,
  pol,
  onPolChange,
  layer,
  onLayerChange,
  canCompare,
  computing,
  showAllFootprints,
  onToggleFootprints,
  onFit,
}: ComparePanelProps) {
  return (
    <>
      <Section title="Radar channel">
        <div className="vx-segment-group vx-segment-group--fill" role="group" aria-label="Polarisation channel">
          {dataset.polarisations.map((p) => {
            const status = channelStatus[p] ?? "unavailable";
            return (
              <button
                key={p}
                type="button"
                className="vx-segment"
                aria-pressed={p === pol}
                disabled={status !== "ready"}
                onClick={() => onPolChange(p)}
              >
                {p}
                {status === "loading" ? " (loading…)" : status === "unavailable" ? " (unavailable)" : ""}
              </button>
            );
          })}
        </div>
        <p className="vx-note vx-mono mt-2">{dataset.layers[pol] ?? ""}</p>
      </Section>

      <Section title="Display layer">
        <div className="vx-segment-group vx-segment-group--fill" role="group" aria-label="Display layer">
          {LAYERS.map((l) => (
            <button
              key={l.id}
              type="button"
              className="vx-segment"
              aria-pressed={layer === l.id}
              disabled={l.id === "compare" && !canCompare}
              onClick={() => onLayerChange(l.id)}
            >
              {l.label}
            </button>
          ))}
        </div>
        {!canCompare && (
          <p className="vx-note mt-2">Compare needs a loaded Before and After pair for this channel.</p>
        )}
        <p className="vx-note mt-2 flex items-center gap-2" role="status">
          {computing ? (
            <>
              <Spinner /> Rendering…
            </>
          ) : layer === "compare" ? (
            `Before and after, greyscale · ${dataset.encoding.unit}. Drag the divider on the map, or focus it and use the arrow keys.`
          ) : layer === "change" ? (
            `Radar brightness change · pixel difference in ${dataset.changeScale.unit}`
          ) : (
            `Greyscale rendering · ${dataset.encoding.unit}`
          )}
        </p>
      </Section>

      <DisclosureSection title="Acquisition" summary={`${dataset.temporalBaselineDays} days`}>
        <dl className="m-0">
          <KeyRow label="Before">{formatAcquisitionTime(dataset.earlier.startTime)}</KeyRow>
          <KeyRow label="After">{formatAcquisitionTime(dataset.later.startTime)}</KeyRow>
          <KeyRow label="Baseline">
            {dataset.temporalBaselineDays} days · {(dataset.earlier.flightDirection ?? "").toLowerCase()} ·{" "}
            {dataset.band}
          </KeyRow>
        </dl>
      </DisclosureSection>

      <Section title="Map">
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[13px]">
          <input
            type="checkbox"
            className="size-5 accent-[var(--vx-accent)]"
            checked={showAllFootprints}
            onChange={(e) => onToggleFootprints(e.target.checked)}
          />
          <span>Show other catalogue footprints</span>
        </label>
        <p className="vx-note">Only the Before and After footprints are drawn while a comparison is loaded.</p>
        <button type="button" onClick={onFit} className="vx-button vx-button--block mt-2">
          Fit map to area
        </button>
      </Section>
    </>
  );
}
