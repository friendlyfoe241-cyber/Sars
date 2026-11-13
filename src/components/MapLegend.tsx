import { memo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { changeColour } from "../lib/changeDetection";
import type { ViewerDataset } from "../lib/data";
import type { DisplayLayer } from "../lib/useChangeLayers";
import Glass from "./glass/Glass";

interface MapLegendProps {
  viewer: ViewerDataset;
  /** "compare": both sides are observations, so the brightness legend applies */
  layer: DisplayLayer | "compare";
  pol: string;
  /** change colour-scale saturation of `pol`; the ramp endpoints are this value */
  saturation: number | null;
  /** "map": floating glass card over the map; "inline": flat block in the sidebar (phones) */
  variant?: "map" | "inline";
}

const rgb = (c: readonly number[]) => `rgb(${c.join(",")})`;

function MapLegend({ viewer, layer, pol, saturation, variant = "map" }: MapLegendProps) {
  // On the map the legend can fold into a small "Legend" chip.
  const [collapsed, setCollapsed] = useState(false);
  if (layer === "change" && saturation === null) return null;
  const change = layer === "change";
  const unit = change ? viewer.changeScale.unit : viewer.encoding.unit;
  // The ramp is drawn from the same function that colours the raster, at
  // the two saturation endpoints and zero; linear interpolation in between.
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
      <div className="mt-1 text-[11px] leading-4 text-vx-muted">
        Unit: {unit}
        {change ? ` · cyan decrease, grey none, amber increase; saturates at ±${saturation}` : ""}
      </div>
      <div className="mt-2 flex items-center gap-2 text-[11px] leading-4 text-vx-muted">
        <span className="vx-checker inline-block size-3 rounded-sm border border-vx-control" aria-hidden />
        No data
      </div>
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
