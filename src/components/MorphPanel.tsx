import { useRef, type ReactNode } from "react";
import Glass from "./glass/Glass";
import { useSprings, type SpringPreset } from "../hooks/useSprings";

export interface MorphRect {
  l: number;
  t: number;
  w: number;
  h: number;
  /** corner radius */
  r: number;
}

const MORPH: SpringPreset = [175, 19, 0.001];

/**
 * The workspace's glass sidebar. Every time `morphKey` changes it grows out of
 * `from` (a nav tab, or the hero's full-screen panel) into `to` on a spring,
 * with a little overshoot, and the content fades up once the glass has
 * mostly arrived. The component owns the springs so the rest of the app
 * (including the map) does not re-render every frame.
 */
export default function MorphPanel({
  from,
  to,
  morphKey,
  label,
  children,
}: {
  from: MorphRect | null;
  to: MorphRect;
  morphKey: number;
  label: string;
  children: ReactNode;
}) {
  const { spring, reset } = useSprings();
  const lastKey = useRef(morphKey);
  if (lastKey.current !== morphKey) {
    reset("m");
    lastKey.current = morphKey;
  }
  const m = spring("m", 1, MORPH, from ? 0 : 1).x;
  const f = from ?? to;
  const lerp = (a: number, b: number) => a + (b - a) * m;
  const content = Math.max(0, Math.min(1, (m - 0.5) / 0.4));

  return (
    <Glass
      as="aside"
      aria-label={label}
      className="lg-panel absolute z-[1000]"
      style={{
        left: lerp(f.l, to.l),
        top: lerp(f.t, to.t),
        width: Math.max(44, lerp(f.w, to.w)),
        height: Math.max(44, lerp(f.h, to.h)),
        borderRadius: Math.max(18, lerp(f.r, to.r)),
      }}
    >
      <div
        className="vx-scroll"
        style={{
          height: Math.max(44, lerp(f.h, to.h)),
          opacity: content,
          transform: `translateY(${(1 - content) * 14}px)`,
        }}
      >
        {children}
      </div>
    </Glass>
  );
}
