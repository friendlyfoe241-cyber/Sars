import type { Manifest } from "../lib/data";
import { formatAcquisitionTime } from "../lib/data";
import type { DisplayLayer } from "./MapView";

interface ControlPanelProps {
  manifest: Manifest;
  pol: string;
  onPolChange: (pol: string) => void;
  layer: DisplayLayer;
  onLayerChange: (layer: DisplayLayer) => void;
  computing: boolean;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-app-border px-4 py-3.5">
      <h2 className="text-[11px] font-medium tracking-[0.06em] text-app-muted uppercase">
        {title}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

const LAYERS: { id: DisplayLayer; label: string }[] = [
  { id: "before", label: "Before" },
  { id: "after", label: "After" },
  { id: "change", label: "Change" },
];

export default function ControlPanel({
  manifest,
  pol,
  onPolChange,
  layer,
  onLayerChange,
  computing,
}: ControlPanelProps) {
  const { studyArea, acquisitionPair, encoding } = manifest;

  return (
    <div>
      <Section title="Study area">
        <div className="text-[13px] font-medium text-app-text">
          {studyArea.name}
        </div>
        <div className="text-[12px] text-app-muted">
          {studyArea.region}, {studyArea.country}
        </div>
        <p className="mt-1.5 text-[12px] leading-[1.5] text-app-text">
          {studyArea.description}
        </p>
        <div className="mt-2 text-[11px] text-app-muted">
          {studyArea.phenomenon}
        </div>
      </Section>

      <Section title="Acquisition">
        <dl className="space-y-1.5 text-[12px]">
          <div className="flex justify-between gap-3">
            <dt className="text-app-muted">Earlier</dt>
            <dd className="text-right text-app-text">
              {formatAcquisitionTime(acquisitionPair.earlier.startTime)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-app-muted">Later</dt>
            <dd className="text-right text-app-text">
              {formatAcquisitionTime(acquisitionPair.later.startTime)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-app-muted">Baseline</dt>
            <dd className="text-right text-app-text">
              {acquisitionPair.temporalBaselineDays} days ·{" "}
              {acquisitionPair.orbitDirection.toLowerCase()} ·{" "}
              {acquisitionPair.band}
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
          {acquisitionPair.polarisations.map((p) => (
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
              ? `Pixel-level difference in ${manifest.changeScale.unit}`
              : `Greyscale rendering · ${encoding.unit}`}
        </div>
      </Section>
    </div>
  );
}
