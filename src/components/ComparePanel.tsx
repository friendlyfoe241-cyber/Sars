import type { ViewerDataset } from "../lib/data";
import { formatAcquisitionTime } from "../lib/data";
import { KeyRow, Section, Spinner } from "./ui";
import type { DisplayLayer } from "../lib/useChangeLayers";
import type { ChannelStatus } from "../lib/rasterSource";

interface ComparePanelProps {
  dataset: ViewerDataset;
  /** per-channel load state; only ready channels can be selected */
  channelStatus: Record<string, ChannelStatus>;
  pol: string;
  onPolChange: (pol: string) => void;
  layer: DisplayLayer;
  onLayerChange: (layer: DisplayLayer) => void;
  computing: boolean;
  showAllFootprints: boolean;
  onToggleFootprints: (show: boolean) => void;
}

const LAYERS: { id: DisplayLayer; label: string }[] = [
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
  computing,
  showAllFootprints,
  onToggleFootprints,
}: ComparePanelProps) {
  return (
    <>
      <Section title="Radar channel">
        <div className="orb-segment-group orb-segment-group--fill" role="group" aria-label="Polarisation channel">
          {dataset.polarisations.map((p) => {
            const status = channelStatus[p] ?? "unavailable";
            return (
              <button
                key={p}
                type="button"
                className="orb-segment"
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
        <p className="orb-note orb-mono mt-2">{dataset.layers[pol] ?? ""}</p>
      </Section>

      <Section title="Display layer">
        <div className="orb-segment-group orb-segment-group--fill" role="group" aria-label="Display layer">
          {LAYERS.map((l) => (
            <button
              key={l.id}
              type="button"
              className="orb-segment"
              aria-pressed={layer === l.id}
              onClick={() => onLayerChange(l.id)}
            >
              {l.label}
            </button>
          ))}
        </div>
        <p className="orb-note mt-2 flex items-center gap-2" role="status">
          {computing ? (
            <>
              <Spinner /> Rendering…
            </>
          ) : layer === "change" ? (
            `Radar brightness change · pixel difference in ${dataset.changeScale.unit}`
          ) : (
            `Greyscale rendering · ${dataset.encoding.unit}`
          )}
        </p>
      </Section>

      <Section title="Acquisition">
        <dl className="m-0">
          <KeyRow label="Before">{formatAcquisitionTime(dataset.earlier.startTime)}</KeyRow>
          <KeyRow label="After">{formatAcquisitionTime(dataset.later.startTime)}</KeyRow>
          <KeyRow label="Baseline">
            {dataset.temporalBaselineDays} days · {(dataset.earlier.flightDirection ?? "").toLowerCase()} ·{" "}
            {dataset.band}
          </KeyRow>
        </dl>
      </Section>

      <Section title="Map">
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[13px]">
          <input
            type="checkbox"
            className="size-4 accent-[var(--orb-accent)]"
            checked={showAllFootprints}
            onChange={(e) => onToggleFootprints(e.target.checked)}
          />
          <span>Show other catalogue footprints</span>
        </label>
        <p className="orb-note">Only the Before and After footprints are drawn while a comparison is loaded.</p>
      </Section>
    </>
  );
}
