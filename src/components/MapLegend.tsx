import { memo } from "react";
import { changeColour } from "../lib/changeDetection";
import type { ViewerDataset } from "../lib/data";
import type { DisplayLayer } from "../lib/useChangeLayers";

interface MapLegendProps {
  viewer: ViewerDataset;
  /** "compare": both sides are observations, so the brightness legend applies */
  layer: DisplayLayer | "compare";
  pol: string;
  /** change colour-scale saturation of `pol`; the ramp endpoints are this value */
  saturation: number | null;
}

const rgb = (c: readonly number[]) => `rgb(${c.join(",")})`;

function MapLegend({ viewer, layer, pol, saturation }: MapLegendProps) {
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

  return (
    <div className="orb-panel orb-panel--glass orb-legend" role="group" aria-label="Map legend">
      <div className="orb-eyebrow">Legend</div>
      <div className="mt-1 text-[14px] leading-5 font-medium">
        {change ? "Radar brightness change" : "Radar brightness"}
      </div>
      <div className="orb-mono text-[11px] leading-4 text-orb-muted">
        {change ? `after − before · ${pol}` : `${layer === "before" ? "Before" : layer === "after" ? "After" : "Before and after"} · ${pol}`}
      </div>

      <div className="mt-3 h-3 border border-orb-border" style={{ background: ramp }} aria-hidden />
      <div className="orb-mono mt-1 flex justify-between text-[11px] leading-4 text-orb-text">
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
      <div className="mt-1 text-[11px] leading-4 text-orb-muted">
        Unit: {unit}
        {change ? ` · cyan decrease, grey none, amber increase; saturates at ±${saturation}` : ""}
      </div>
      <div className="mt-2 flex items-center gap-2 text-[11px] leading-4 text-orb-muted">
        <span className="orb-checker inline-block size-3 border border-orb-border" aria-hidden />
        No data
      </div>
    </div>
  );
}

export default memo(MapLegend);
