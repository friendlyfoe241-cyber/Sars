import { memo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { changeColour } from "../lib/changeDetection";
import type { ViewerDataset } from "../lib/data";
import type { DisplayLayer } from "../lib/useChangeLayers";
import Glass from "./glass/Glass";

interface MapLegendProps {
  viewer: ViewerDataset;
  layer: DisplayLayer | "compare";
  pol: string;
  saturation: number | null;
  variant?: "map" | "inline";
}

const rgb = (c: readonly number[]) => `rgb(${c.join(",")})`;

function MapLegend({ viewer, layer, pol, saturation, variant = "map" }: MapLegendProps) {
  const [collapsed, setCollapsed] = useState(false);
  if (layer === "change" && saturation === null) return null;
  const change = layer === "change";
  const unit = change ? viewer.changeScale.unit : viewer.encoding.unit;
  const ramp = change
    ? `linear-gradient(90deg, ${rgb(changeColour(-saturation!, saturation!))}, ${rgb(
        changeColour(0, saturation!),
      )}, ${rgb(changeColour(saturation!, saturation!))})`
    : "linear-gradient(90deg, rgb(8,8,8), rgb(255,255,255))";

  const content = (
    <div className="vx-legend__body">
      {variant === "inline" && <div className="vx-eyebrow">Legend</div>}
      <div className={`${variant === "inline" ? "mt-1 " : ""}text-[14px] leading-5 font-semibold`}>
        {change ? "Radar brightness change" : "Radar brightness"}
      </div>
      <div className="vx-mono text-[11px] leading-4 text-vx-muted">
        {change ? `after − before · ${pol}` : `${layer === "before" ? "Before" : layer === "after" ? "After" : "Before and after"} · ${pol}`}
      </div>

      <div className="mt-3 h-3 rounded-full border border-vx-control" style={{ background: ramp }} aria-hidden />
      <div className="vx-mono mt-1 flex justify-between text-[11px] leading-4 text-vx-text">
        {change ? (
          <>
            <span>−{saturation}</span>
            <span>0</span>
            <span>+{saturation}</span>
          </>
        ) : (
          <>
            <span>low</span>
            <span>high</span>
          </>
        )}
      </div>
      <div className="mt-1 text-[11px] leading-4 text-vx-muted" title="Display DN: 8-bit display brightness of the browse quicklook, not a calibrated value">
        Unit: {unit}
        {change ? ` · cyan decrease, grey none, amber increase; saturates at ±${saturation}` : ""}
      </div>
      <div className="mt-2 flex items-center gap-2 text-[11px] leading-4 text-vx-muted">
        <span className="vx-checker inline-block size-3 rounded-sm border border-vx-control" aria-hidden />
        No data
      </div>
      {variant === "inline" && (
        <details className="vx-legend__explain mt-3">
          <summary className="vx-note">What am I looking at?</summary>
          <div className="mt-2 grid gap-2 text-[12px] leading-[18px] text-vx-muted">
            <p className="m-0">
              {change
                ? "The colours show where the radar image got darker (cyan) or brighter (amber) between the two dates. Grey means little change."
                : "Each image shows how much radar signal came back from the ground on one date: brighter means more signal. Pick the Change layer to colour where it got darker (cyan) or brighter (amber)."}
            </p>
            <p className="m-0">
              These are browse quicklook images, so the values are display brightness (8-bit display
              DN, 0 to 255), not calibrated measurements.
            </p>
            <p className="m-0">
              Darker often goes with smoother surfaces, such as open standing water. Brighter often
              goes with rougher surfaces, more vegetation or structures, and sometimes wetter soil or
              flooded vegetation. These are possible readings, not confirmed causes.
            </p>
          </div>
        </details>
      )}
    </div>
  );

  if (variant === "inline") {
    return (
      <div className="vx-legend--inline rounded-[18px] bg-white/[0.06]" role="group" aria-label="Map legend">
        {content}
      </div>
    );
  }
  if (collapsed) {
    return (
      <Glass
        as="button"
        type="button"
        className="lg-panel vx-legend vx-legend--chip vx-in-left"
        aria-expanded={false}
        aria-label="Show map legend"
        onClick={() => setCollapsed(false)}
      >
        <span className="vx-legend__chip">
          <span className="vx-eyebrow">Legend</span>
          <ChevronUp size={16} aria-hidden />
        </span>
      </Glass>
    );
  }
  return (
    <Glass className="lg-panel vx-legend vx-in-left" role="group" aria-label="Map legend">
      <div className="vx-legend__head">
        <span className="vx-eyebrow">Legend</span>
        <button
          type="button"
          className="vx-icon-button"
          aria-expanded={true}
          aria-label="Hide map legend"
          title="Fold the legend into a chip"
          onClick={() => setCollapsed(true)}
        >
          <ChevronDown size={18} aria-hidden />
        </button>
      </div>
      {content}
    </Glass>
  );
}

export default memo(MapLegend);
