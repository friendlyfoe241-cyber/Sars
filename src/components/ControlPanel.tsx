import type { ViewerDataset } from "../lib/data";
import { formatAcquisitionTime } from "../lib/data";
import { Section } from "./ui";
import type { DisplayLayer } from "../lib/useChangeLayers";

interface ControlPanelProps {
  dataset: ViewerDataset;
  pol: string;
  onPolChange: (pol: string) => void;
  layer: DisplayLayer;
  onLayerChange: (layer: DisplayLayer) => void;
  computing: boolean;
}

const LAYERS: { id: DisplayLayer; label: string }[] = [
  { id: "before", label: "Before" },
  { id: "after", label: "After" },
  { id: "change", label: "Change" },
];

export default function ControlPanel({
  dataset,
  pol,
  onPolChange,
  layer,
  onLayerChange,
  computing,
}: ControlPanelProps) {
  return (
    <div>
      <Section title="Acquisition">
        <dl className="space-y-1.5 text-[12px]">
          <div className="flex justify-between gap-3">
            <dt className="text-app-muted">Earlier</dt>
            <dd className="text-right text-app-text">
              {formatAcquisitionTime(dataset.earlier.startTime)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-app-muted">Later</dt>
            <dd className="text-right text-app-text">
              {formatAcquisitionTime(dataset.later.startTime)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-app-muted">Baseline</dt>
            <dd className="text-right text-app-text">
              {dataset.temporalBaselineDays} days ·{" "}
              {(dataset.earlier.flightDirection ?? "").toLowerCase()} ·{" "}
              {dataset.band}
            </dd>
          </div>
        </dl>
      </Section>

      <Section title="Polarisation">
        <select
          value={pol}
          onChange={(e) => onPolChange(e.target.value)}
          className="block w-full rounded-[3px] border border-app-border bg-white px-2 py-1.5 text-[13px] text-app-text focus:border-app-accent focus:outline-none"
          aria-label="Polarisation channel"
        >
          {dataset.polarisations.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </Section>

      <Section title="Display layer">
        <div className="flex overflow-hidden rounded-[3px] border border-app-border">
          {LAYERS.map((l, i) => (
            <button
              key={l.id}
              type="button"
              onClick={() => onLayerChange(l.id)}
              className={`flex-1 px-2 py-1.5 text-[12px] transition-colors ${
                i > 0 ? "border-l border-app-border" : ""
              } ${
                layer === l.id
                  ? "bg-app-accent text-white"
                  : "bg-white text-app-text hover:bg-app-subtle"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <div className="mt-1.5 text-[11px] text-app-muted">
          {computing
            ? "Rendering…"
            : layer === "change"
              ? `Pixel-level difference in ${dataset.changeScale.unit}`
              : `Greyscale rendering · ${dataset.encoding.unit}`}
        </div>
      </Section>
    </div>
  );
}
