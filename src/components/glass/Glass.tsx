import type { CSSProperties, ElementType, ReactNode } from "react";

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

export function LiquidGlassFilter({ refraction = 90, animate = true }: { refraction?: number; animate?: boolean }) {
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
          {animate && !still && (
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
