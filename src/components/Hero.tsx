import { useEffect, useRef, useState, type MouseEvent } from "react";
import Glass from "./glass/Glass";
import StepIcon from "./StepIcon";
import VortexMark from "./VortexMark";
import Starfield from "./Starfield";
import { STEPS, type StepId } from "../lib/steps";
import { FLOAT, FLUID, PANEL, SNAP, SOFT, useSprings } from "../hooks/useSprings";

type Phase = "pre" | "float" | "menu";
interface Rect {
  l: number;
  t: number;
  w: number;
  h: number;
}

/**
 * Landing scene: the globe floats up, hangs, then sinks into a horizon while
 * the liquid-glass command dock springs in. Pressing a command grows a glass
 * panel out of that button to fill the screen, then fades to reveal the
 * workspace focused on that step.
 */
export default function Hero({
  intro,
  onEnter,
}: {
  /** true on first load (full float-in); false when returning from the app */
  intro: boolean;
  onEnter: (step: StepId) => void;
}) {
  const { spring } = useSprings();
  const rootRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>(intro ? "pre" : "menu");
  const [hover, setHover] = useState<number | null>(null);
  const [opening, setOpening] = useState<{ i: number; from: Rect } | null>(null);
  const [size, setSize] = useState({ w: 1440, h: 900 });
  const [run, setRun] = useState(0);
  const entered = useRef(false);

  useEffect(() => {
    const measure = () => {
      const el = rootRef.current;
      if (el) setSize({ w: el.offsetWidth, h: el.offsetHeight });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    if (!intro && run === 0) return;
    setPhase("pre");
    const a = setTimeout(() => setPhase("float"), 120);
    const b = setTimeout(() => setPhase("menu"), 2400);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [intro, run]);

  const W = size.w;
  const H = size.h;
  const isOpen = opening !== null;

  // ---- globe -----------------------------------------------------------
  const gyT = phase === "pre" ? 75 : phase === "float" ? -50 : isOpen ? 2 : -14;
  const gsT = phase === "pre" ? 0.7 : phase === "float" ? 1 : isOpen ? 1.9 : 1.3;
  const gy = spring("gy", gyT, FLOAT, 75);
  const gs = spring("gs", gsT, FLOAT, 0.7);
  const tilt = spring("tilt", hover === null ? 0 : (hover - 2) * 3, SOFT, 0);
  const dim = spring("dim", isOpen ? 1 : 0, SOFT, 0).x;
  const globeSize = Math.round(Math.min(W * (W < 720 ? 1.05 : 0.62), 860));
  const globeOp = Math.min(1, Math.max(0, (75 - gy.x) / 40));

  // ---- title, chrome, dock --------------------------------------------
  const t = spring("tOp", phase === "pre" ? 0 : 1, FLUID, 0).x;
  const tm = spring("tPos", phase === "menu" ? 1 : 0, FLOAT, 0).x;
  const chromeV = spring("chrome", phase === "menu" ? 1 : 0, FLUID, 0).x;
  const menuOn = phase === "menu" && !isOpen;
  const bw = W < 720 ? 64 : 128;
  const dv = spring("dock", menuOn ? 1 : 0, [150, 15, 0.002], 0).x;
  const hi = hover ?? 2;
  const hs = spring("hov", hi * bw, SNAP, hi * bw);
  const hst = Math.min(40, Math.abs(hs.v) * 0.045);
  const indO = spring("hovO", hover === null ? 0 : 1, FLUID, 0).x;

  // ---- expanding panel -------------------------------------------------
  const pan = spring("pan", isOpen ? 1 : 0, PANEL, 0).x;
  const fade = spring("fade", isOpen && pan > 0.92 ? 0 : 1, FLUID, 1).x;
  useEffect(() => {
    if (opening && fade < 0.03 && !entered.current) {
      entered.current = true;
      onEnter(STEPS[opening.i].id);
    }
  }, [opening, fade, onEnter]);

  const open = (i: number, e: MouseEvent<HTMLButtonElement>) => {
    const root = rootRef.current;
    if (!root || isOpen) return;
    const rr = root.getBoundingClientRect();
    const b = e.currentTarget.getBoundingClientRect();
    setOpening({ i, from: { l: b.left - rr.left, t: b.top - rr.top, w: b.width, h: b.height } });
  };

  let panel: Rect & { r: number; cop: number } = { l: 0, t: 0, w: 0, h: 0, r: 0, cop: 0 };
  if (opening) {
    const f = opening.from;
    const m = W < 720 ? 12 : 32;
    const lerp = (a: number, b: number) => a + (b - a) * pan;
    panel = {
      l: lerp(f.l, m),
      t: lerp(f.t, m),
      w: Math.max(40, lerp(f.w, W - 2 * m)),
      h: Math.max(40, lerp(f.h, H - 2 * m)),
      r: Math.max(28, lerp(f.h / 2, 36)),
      cop: Math.max(0, Math.min(1, (pan - 0.5) / 0.4)),
    };
  }

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[2000] overflow-hidden bg-black text-app-text"
      style={{ opacity: fade }}
    >
      <Starfield count={180} />

      {/* globe */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          left: "50%",
          top: "63.4%",
          width: globeSize,
          height: globeSize,
          transform: `translate(-50%, ${gy.x}%) scale(${gs.x}) rotate(${tilt.x}deg)`,
          filter: `blur(${dim * 6}px) brightness(${1 - dim * 0.45})`,
          opacity: globeOp,
        }}
      >
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
          <img src={`${import.meta.env.BASE_URL}globe.webp`} alt="" className="relative block h-full w-full rounded-full" draggable={false} />
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

      {/* top chrome */}
      <header
        className="absolute inset-x-0 top-0 flex items-center justify-between gap-4 px-8 py-7"
        style={{ opacity: Math.max(0, Math.min(1, chromeV)) * (1 - dim), transform: `translateY(${(1 - chromeV) * -20}px)` }}
      >
        <div className="flex items-center gap-3">
          <VortexMark size={32} />
          <span className="font-display text-[22px] tracking-[0.06em]">NISAR</span>
        </div>
        <Glass as="button" type="button" onClick={() => setRun((n) => n + 1)} className="lg-btn rounded-full border-0 bg-transparent px-[18px] text-[14px] text-app-text" style={{ minHeight: 44 }}>
          <span className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            Replay intro
          </span>
        </Glass>
      </header>

      {/* title */}
      <section
        aria-labelledby="hero-title"
        className="pointer-events-none absolute inset-x-0 flex flex-col items-center gap-3 px-6 text-center"
        style={{
          top: `${40 - 28 * tm}%`,
          opacity: Math.max(0, Math.min(1, t)) * (1 - dim),
          transform: `translateY(${(1 - Math.min(1, t)) * 30}px) scale(${1.08 - 0.08 * tm})`,
        }}
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
      {phase === "menu" && (
        <Glass
          as="nav"
          aria-label="Command"
          className="absolute rounded-full"
          style={{
            left: "50%",
            bottom: 44,
            transform: `translate(-50%, ${(1 - dv) * 120}px) scale(${0.85 + 0.15 * dv})`,
            opacity: Math.max(0, Math.min(1, dv * 1.4)),
          }}
        >
          <div className="relative flex p-2" onMouseLeave={() => setHover(null)}>
            <span
              aria-hidden="true"
              className="absolute rounded-full"
              style={{
                top: 8,
                bottom: 8,
                left: 8 + hs.x - hst / 2,
                width: bw + hst,
                opacity: Math.max(0, Math.min(1, indO)),
                background: "rgba(255,255,255,.14)",
                boxShadow:
                  "inset 1.5px 1.5px 0 rgba(255,255,255,.45), inset -1px -1px 0 rgba(255,255,255,.1), 0 8px 24px rgba(0,0,0,.45)",
              }}
            />
            {STEPS.map((s, i) => (
              <button
                key={s.id}
                type="button"
                className="lg-btn hero-pop relative flex flex-col items-center justify-center gap-1.5 rounded-full border-0 bg-transparent text-[14px]"
                style={{
                  width: bw,
                  minHeight: 64,
                  color: hover === i ? "#fff" : "#D9DEE5",
                  animationDelay: `${0.15 + i * 0.07}s`,
                }}
                aria-label={`Open ${s.label}`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onClick={(e) => open(i, e)}
              >
                <StepIcon id={s.id} />
                {W >= 720 && <span>{s.label}</span>}
              </button>
            ))}
          </div>
        </Glass>
      )}

      {/* expanding glass panel */}
      {opening && (
        <Glass
          aria-hidden="true"
          className="absolute"
          style={{ left: panel.l, top: panel.t, width: panel.w, height: panel.h, borderRadius: panel.r, ["--p" as string]: 1 }}
        >
          <div
            className="flex h-full flex-col items-center justify-center gap-4"
            style={{ height: panel.h, opacity: panel.cop }}
          >
            <span className="text-app-flare">
              <StepIcon id={STEPS[opening.i].id} size={44} />
            </span>
            <span className="font-display text-[34px]">{STEPS[opening.i].label}</span>
          </div>
        </Glass>
      )}
    </div>
  );
}
