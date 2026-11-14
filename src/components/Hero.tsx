import { useEffect, useRef, useState } from "react";
import Glass from "./glass/Glass";
import StepIcon from "./StepIcon";
import Starfield from "./Starfield";
import { STEPS, type StepId } from "../lib/steps";

/**
 * Landing scene: the title comes in from the top edge, the globe rises behind
 * it and the liquid-glass command dock rises from the bottom edge.  Pressing a
 * command hands over to the workspace at once: the hero fades while its title
 * and dock slide back out to their edges (`leaving`), and the workspace
 * surfaces slide in from theirs.
 */
export default function Hero({
  intro,
  leaving,
  onEnter,
}: {
  /** true on first load; false when returning from the app (Globe button) */
  intro: boolean;
  /** playing the exit; unmounted by the parent once it has finished */
  leaving: boolean;
  onEnter: (step: StepId) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [W, setW] = useState(() => window.innerWidth);

  useEffect(() => {
    let raf = 0;
    const on = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setW(window.innerWidth);
      });
    };
    window.addEventListener("resize", on);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", on);
    };
  }, []);

  // Focus the first command when the user brought the hero up (Globe button)
  // or nothing else holds focus.
  useEffect(() => {
    const ae = document.activeElement;
    if (intro && ae && ae !== document.body) return;
    rootRef.current
      ?.querySelector<HTMLButtonElement>("nav[aria-label='Command'] button")
      ?.focus({ preventScroll: true });
  }, [intro]);

  const globeSize = Math.round(Math.min(W * (W < 720 ? 1.05 : 0.62), 860));
  const bw = W < 720 ? 64 : 128;
  const hi = hover ?? 2;

  return (
    <div
      ref={rootRef}
      className="vx-hero fixed inset-0 z-[2000] overflow-hidden bg-black text-app-text"
      data-leaving={leaving || undefined}
      inert={leaving}
    >
      <Starfield count={180} />

      {/* globe: resting place set here, entrance on the inner layer */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          left: "50%",
          top: "63.4%",
          width: globeSize,
          height: globeSize,
          transform: "translate(-50%, -14%) scale(1.3)",
        }}
      >
        <div className="vx-in-bottom vx-hero__globe h-full w-full">
          <div className="relative h-full w-full" style={{ animation: "hero-bob 7s ease-in-out infinite" }}>
            <div
              className="absolute rounded-full"
              style={{
                inset: "-9%",
                background:
                  "radial-gradient(circle, rgba(63,140,240,.5) 42%, rgba(63,140,240,.12) 58%, transparent 70%)",
                filter: "blur(28px)",
                animation: "hero-glow 6s ease-in-out infinite",
              }}
            />
            <img src={`${import.meta.env.BASE_URL}globe.webp`} alt="" width={1200} height={1200} fetchPriority="high" decoding="async" className="relative block h-full w-full rounded-full" draggable={false} />
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background:
                  "radial-gradient(circle at 30% 24%, rgba(255,255,255,.2), transparent 34%), radial-gradient(circle at 74% 82%, rgba(0,0,0,.6), transparent 62%)",
                boxShadow: "inset -34px -46px 90px rgba(0,0,0,.65), inset 8px 10px 30px rgba(150,200,255,.35)",
              }}
            />
            <div
              className="absolute rounded-full"
              style={{ inset: -1, boxShadow: "0 0 36px 4px rgba(90,160,255,.5), 0 0 140px 30px rgba(63,140,240,.16)" }}
            />
          </div>
        </div>
      </div>

      {/* title */}
      <section
        aria-labelledby="hero-title"
        className="vx-in-top vx-hero__title pointer-events-none absolute inset-x-0 flex flex-col items-center gap-3 px-6 text-center"
        style={{ top: "12%" }}
      >
        <p className="m-0 font-display text-[13px] tracking-[0.3em] text-app-flare">
          NASA SPACE APPS 2026 · DANCING WITH THE SARS
        </p>
        <h1
          id="hero-title"
          className="m-0 leading-[1.02]"
          style={{ fontSize: "clamp(36px, 6vw, 76px)", letterSpacing: "-0.01em", textShadow: "0 8px 40px rgba(0,0,0,.8)" }}
        >
          NISAR Surface Change
        </h1>
        <p className="m-0 font-light text-[#D9DEE5]" style={{ fontSize: "clamp(15px, 1.6vw, 19px)", textShadow: "0 4px 20px rgba(0,0,0,.9)" }}>
          Watch the planet's surface shift, one radar pass at a time.
        </p>
      </section>

      {/* command dock */}
      <div className="pointer-events-none absolute inset-x-0 flex justify-center px-3" style={{ bottom: 44 }}>
        <Glass as="nav" aria-label="Command" className="vx-in-bottom vx-hero__dock pointer-events-auto rounded-full">
          <div className="relative flex p-2" onMouseLeave={() => setHover(null)}>
            <span
              aria-hidden="true"
              className="vx-hero__hover absolute rounded-full"
              style={{
                top: 8,
                bottom: 8,
                left: 8,
                width: bw,
                transform: `translateX(${hi * bw}px)`,
                opacity: hover === null ? 0 : 1,
                background: "rgba(255,255,255,.14)",
                boxShadow:
                  "inset 1.5px 1.5px 0 rgba(255,255,255,.45), inset -1px -1px 0 rgba(255,255,255,.1), 0 8px 24px rgba(0,0,0,.45)",
              }}
            />
            {STEPS.map((s, i) => (
              <button
                key={s.id}
                type="button"
                className="lg-btn relative flex flex-col items-center justify-center gap-1.5 rounded-full border-0 bg-transparent text-[14px]"
                style={{ width: bw, minHeight: 64, color: hover === i ? "#fff" : "#D9DEE5" }}
                aria-label={`Open ${s.label}`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onClick={() => onEnter(s.id)}
              >
                <StepIcon id={s.id} />
                {W >= 720 && <span>{s.label}</span>}
              </button>
            ))}
          </div>
        </Glass>
      </div>
    </div>
  );
}
