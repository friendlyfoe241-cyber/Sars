import { memo } from "react";
import {
  CalendarClock,
  Fingerprint,
  Gauge,
  Layers3,
  MapPin,
  Orbit,
  Radio,
  ShieldCheck,
  Timer,
} from "lucide-react";
import { availabilityLabel, formatAcquisitionTime, type ViewerDataset } from "../lib/data";
import type { NisarScene } from "../lib/discovery";
import { KeyRow, Section } from "./ui";

interface ObservationPanelProps {
  viewer: ViewerDataset | null;
  pol: string;
  beforeScene: NisarScene | null;
  afterScene: NisarScene | null;
  selectedScene: NisarScene | null;
  locationLabel: string;
}

const ICON = 15;
const LINK =
  "break-all underline decoration-orb-control underline-offset-2 hover:decoration-orb-text";

function geometry(a: {
  flightDirection?: string | null;
  orbit?: number | null;
  pathNumber?: number | null;
  frameNumber?: number | null;
}): string {
  const parts = [
    (a.flightDirection ?? "").toLowerCase(),
    a.orbit != null ? `orbit ${a.orbit}` : "",
    a.pathNumber != null ? `track ${a.pathNumber}` : "",
    a.frameNumber != null ? `frame ${a.frameNumber}` : "",
  ].filter(Boolean);
  return parts.join(" · ") || "—";
}

function maturityOf(before: NisarScene | null, after: NisarScene | null): string {
  if (!before && !after) return "—";
  if (before && after && before.maturity !== after.maturity) {
    return `${before.maturity} / ${after.maturity}`;
  }
  return (before ?? after)!.maturity;
}

function SceneRows({ scene }: { scene: NisarScene }) {
  return (
    <dl className="m-0">
      <KeyRow icon={<CalendarClock size={ICON} aria-hidden />} label="Acquired">
        {formatAcquisitionTime(scene.startTime)} – {scene.stopTime.slice(11, 16)} UTC
      </KeyRow>
      <KeyRow icon={<Radio size={ICON} aria-hidden />} label="Band">
        {scene.band} · {scene.productType} · {scene.polarisations.join("/")}
      </KeyRow>
      <KeyRow icon={<Orbit size={ICON} aria-hidden />} label="Geometry">
        {geometry({
          flightDirection: scene.orbitDirection,
          orbit: scene.orbit,
          pathNumber: scene.track,
          frameNumber: scene.frame,
        })}
      </KeyRow>
      <KeyRow icon={<ShieldCheck size={ICON} aria-hidden />} label="Processing">
        {scene.collection} · {scene.maturity}
        {scene.crid ? ` · CRID ${scene.crid}` : ""}
        {scene.pgeVersion ? ` · ${scene.pgeVersion}` : ""}
      </KeyRow>
      <KeyRow icon={<Fingerprint size={ICON} aria-hidden />} label="Product ID" stack>
        {scene.id}
      </KeyRow>
      <KeyRow icon={<Layers3 size={ICON} aria-hidden />} label="Raster" stack>
        Metadata and quicklook browse available; calibrated raster not prepared for this scene
      </KeyRow>
      {scene.downloadUrl && (
        <KeyRow label="Access" stack>
          <a href={scene.downloadUrl} target="_blank" rel="noreferrer" className={LINK}>
            Product download (Earthdata login required)
          </a>
        </KeyRow>
      )}
    </dl>
  );
}

function ObservationPanel({
  viewer,
  pol,
  beforeScene,
  afterScene,
  selectedScene,
  locationLabel,
}: ObservationPanelProps) {
  return (
    <>
      {viewer ? (
        <Section title="Observation pair">
          <dl className="m-0">
            <KeyRow icon={<MapPin size={ICON} aria-hidden />} label="Location">
              {viewer.areaLabel}
            </KeyRow>
            <KeyRow icon={<CalendarClock size={ICON} aria-hidden />} label="Before">
              {formatAcquisitionTime(viewer.earlier.startTime)}
            </KeyRow>
            <KeyRow icon={<CalendarClock size={ICON} aria-hidden />} label="After">
              {formatAcquisitionTime(viewer.later.startTime)}
            </KeyRow>
            <KeyRow icon={<Timer size={ICON} aria-hidden />} label="Baseline">
              {viewer.temporalBaselineDays} days
            </KeyRow>
            <KeyRow icon={<Radio size={ICON} aria-hidden />} label="Band / product">
              {viewer.productLine}
            </KeyRow>
            <KeyRow icon={<Gauge size={ICON} aria-hidden />} label="Channel">
              {pol} · {viewer.layers[pol] ?? "—"}
            </KeyRow>
            <KeyRow icon={<Orbit size={ICON} aria-hidden />} label="Orbit / track / frame">
              {geometry(viewer.earlier)}
            </KeyRow>
            <KeyRow icon={<ShieldCheck size={ICON} aria-hidden />} label="Maturity">
              {maturityOf(beforeScene, afterScene)}
            </KeyRow>
            <KeyRow icon={<Fingerprint size={ICON} aria-hidden />} label="Product IDs" stack>
              <span className="block">{viewer.earlier.productId}</span>
              <span className="mt-2 block">{viewer.later.productId}</span>
            </KeyRow>
          </dl>
        </Section>
      ) : (
        <Section title="Observation pair">
          <dl className="m-0">
            <KeyRow icon={<MapPin size={ICON} aria-hidden />} label="Location">
              {locationLabel || "—"}
            </KeyRow>
          </dl>
          <p className="orb-note mt-2">No comparison loaded. Load a Before and After pair to see its details here.</p>
        </Section>
      )}

      {selectedScene && (
        <Section title="Selected scene">
          <SceneRows scene={selectedScene} />
        </Section>
      )}

      {viewer && (
        <Section title="Source and unit">
          <dl className="m-0">
            <KeyRow label="Source" stack>
              <a
                href="https://nisar-docs.asf.alaska.edu/"
                target="_blank"
                rel="noreferrer"
                className={LINK}
              >
                {viewer.source}
              </a>
            </KeyRow>
            <KeyRow label="Unit">{viewer.encoding.unit}</KeyRow>
            <KeyRow label="Raster" stack>
              {availabilityLabel(viewer.availability)}
            </KeyRow>
          </dl>
        </Section>
      )}

      {viewer && viewer.limitations.length > 0 && (
        <Section title="Limitations">
          <ul className="m-0 grid list-none gap-2 p-0">
            {viewer.limitations.map((l, i) => (
              <li key={i} className="orb-note border-l border-orb-control pl-3">
                {l}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

export default memo(ObservationPanel);
