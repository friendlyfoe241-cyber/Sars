import type { CSSProperties, ElementType, ReactNode } from "react";

/**
 * One liquid-glass surface. The four layers are:
 *   lg-liq   clear, refracting liquid (visible when no cursor is near)
 *   lg-solid frosted glass (fades in as the cursor approaches)
 *   lg-tint  white tint whose strength follows the same proximity value
 *   lg-rim   edge light + slow sheen sweep
 * Proximity is written to the element's --p by useGlassProximity.
 */
export default function Glass({
  as: Tag = "div",
  className = "",
  style,
  children,
  ...rest
}: {
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
} & Record<string, unknown>) {
  const Inner = Tag === "button" || Tag === "a" ? "span" : "div";
  return (
    <Tag className={`lg ${className}`} style={style} {...rest}>
      <span className="lg-liq" aria-hidden="true" />
      <span className="lg-solid" aria-hidden="true" />
      <span className="lg-tint" aria-hidden="true" />
      <span className="lg-rim" aria-hidden="true" />
      <Inner className="lg-c block">{children}</Inner>
    </Tag>
  );
}

/** Hidden SVG filter used by .lg-liq. The noise drifts so idle glass ripples. */
export function LiquidGlassFilter({ refraction = 90 }: { refraction?: number }) {
  // A continuously animated filter re-renders every glass surface that uses it;
  // with reduced motion the noise stays still.
  const still =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <filter
        id="lgDistort"
        x="0%"
        y="0%"
        width="100%"
        height="100%"
        colorInterpolationFilters="sRGB"
      >
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.007 0.009"
          numOctaves={2}
          seed={92}
          result="noise"
        >
          {!still && (
            <animate
              attributeName="baseFrequency"
              dur="16s"
              values="0.007 0.009;0.010 0.006;0.006 0.011;0.007 0.009"
              repeatCount="indefinite"
            />
          )}
        </feTurbulence>
        <feGaussianBlur in="noise" stdDeviation="2.5" result="soft" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="soft"
          scale={refraction}
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </svg>
  );
}
