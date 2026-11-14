import { useMemo } from "react";

/**
 * Deep-space backdrop: a seeded field of twinkling stars plus two faint
 * nebula clouds that drift very slowly. Purely decorative.
 */
export default function Starfield({
  count = 140,
  nebula = true,
  animate = true,
}: {
  count?: number;
  nebula?: boolean;
  animate?: boolean;
}) {
  const stars = useMemo(() => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    return Array.from({ length: count }, (_, i) => ({
      i,
      x: rnd() * 100,
      y: rnd() * 100,
      r: rnd() < 0.86 ? 1 : rnd() < 0.7 ? 1.6 : 2.2,
      d: 2.5 + rnd() * 5,
      delay: rnd() * 6,
      tint: rnd() < 0.18 ? "#A5C8FF" : rnd() < 0.08 ? "#C9B5FF" : "#FFFFFF",
    }));
  }, [count]);

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {nebula && (
        <>
          <div
            className="absolute rounded-full"
            style={{
              left: "-12%",
              top: "-18%",
              width: "62vw",
              height: "62vw",
              background: "radial-gradient(circle, rgba(79,70,229,.22), transparent 62%)",
              filter: "blur(40px)",
              animation: "nebula-drift 38s ease-in-out infinite",
            }}
          />
          <div
            className="absolute rounded-full"
            style={{
              right: "-15%",
              top: "8%",
              width: "55vw",
              height: "55vw",
              background: "radial-gradient(circle, rgba(157,116,240,.16), transparent 60%)",
              filter: "blur(50px)",
              animation: "nebula-drift 46s ease-in-out -12s infinite reverse",
            }}
          />
        </>
      )}
      {stars.map((s) => (
        <span
          key={s.i}
          className="absolute rounded-full"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.r,
            height: s.r,
            background: s.tint,
            boxShadow: s.r > 1.5 ? `0 0 6px ${s.tint}` : undefined,
            animation: animate ? `star-twinkle ${s.d}s ease-in-out ${s.delay}s infinite` : undefined,
          }}
        />
      ))}
    </div>
  );
}
