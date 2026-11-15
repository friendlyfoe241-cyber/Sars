import { useMemo } from "react";

export default function Starfield({
  count = 140,
  animate = true,
}: {
  count?: number;
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
      tint: rnd() < 0.18 ? "#A5C8FF" : rnd() < 0.08 ? "#DCEBFF" : "#FFFFFF",
    }));
  }, [count]);

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
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
