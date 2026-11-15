import type { ReactNode } from "react";
import type { ViewerDataset } from "../lib/data";
import { formatAcquisitionTime } from "../lib/data";
import { DisclosureSection, KeyRow, Section, Spinner } from "./ui";
import type { DisplayChoice } from "../lib/useChangeLayers";
import type { ChannelStatus } from "../lib/rasterSource";

interface ComparePanelProps {
  dataset: ViewerDataset;
  channelStatus: Record<string, ChannelStatus>;
  pol: string;
  onPolChange: (pol: string) => void;
  layer: DisplayChoice;
  onLayerChange: (layer: DisplayChoice) => void;
  canCompare: boolean;
  computing: boolean;
  showAllFootprints: boolean;
  onToggleFootprints: (show: boolean) => void;
  onFit: () => void;
  legend?: ReactNode;
}

const CHANNEL_HINT: Record<string, string> = {
  HH: "Sent horizontally, received horizontally",
  HV: "Sent horizontally, received vertically",
  VV: "Sent vertically, received vertically",
  VH: "Sent vertically, received horizontally",
};

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
  legend,
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
                title={CHANNEL_HINT[p]}
              >
                {p}
                {status === "loading" ? " (loading…)" : status === "unavailable" ? " (unavailable)" : ""}
              </button>
            );
          })}
        </div>
        <p className="vx-note vx-mono mt-2">{dataset.layers[pol] ?? ""}</p>
        <p className="vx-note mt-1">
          HH: radar sent and received horizontally. HV: sent horizontally, received vertically, more
          sensitive to vegetation.
        </p>
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

      {legend}

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
