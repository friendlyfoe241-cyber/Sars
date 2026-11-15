import { useEffect, useRef, useState } from "react";
import Glass from "./glass/Glass";
import StepIcon from "./StepIcon";
import Starfield from "./Starfield";
import { STEPS, type StepId } from "../lib/steps";

const TILT_MAX = 24;

export default function Hero({
  intro,
  leaving,
  onEnter,
}: {
  intro: boolean;
  leaving: boolean;
  onEnter: (step: StepId) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [tilt, setTilt] = useState(0);
  const hoverRef = useRef<number | null>(null);
  const pointerRef = useRef<number | null>(null);
  const focusRef = useRef<number | null>(null);
  const quietRef = useRef(false);
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

  useEffect(() => {
    const ae = document.activeElement;
    if (intro && ae && ae !== document.body) return;
    quietRef.current = true;
    rootRef.current
      ?.querySelector<HTMLButtonElement>("nav[aria-label='Command'] button")
      ?.focus({ preventScroll: true });
    quietRef.current = false;
  }, [intro]);

  const tiltFor = (i: number | null) => {
    if (i === null) return 0;
    const n = STEPS.length;
    return n > 1 ? Math.round(((i - (n - 1) / 2) / ((n - 1) / 2)) * TILT_MAX) : 0;
  };

  const settle = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTilt(0);
      return;
    }
    setTilt(tiltFor(pointerRef.current ?? focusRef.current));
  };

  const pick = (i: number) => {
    hoverRef.current = i;
    setHover(i);
    pointerRef.current = i;
    settle();
  };

  const focusOn = (i: number) => {
    hoverRef.current = i;
    setHover(i);
    if (quietRef.current) return;
    focusRef.current = i;
    settle();
  };

  const blurFrom = () => {
    focusRef.current = null;
    settle();
  };

  const leave = () => {
    hoverRef.current = null;
    setHover(null);
    pointerRef.current = null;
    settle();
  };

  const bw = W >= 720 ? 128 : W >= 360 ? 64 : 56;
  const hi = hover ?? 2;

  return (
    <div
      ref={rootRef}
      className="vx-hero fixed inset-0 z-[2000] overflow-hidden bg-black text-app-text"
      data-leaving={leaving || undefined}
      inert={leaving}
    >
      <Starfield count={180} />

      <div className="vx-hero__layout">
        <section
          aria-labelledby="hero-title"
          className="vx-in-top vx-hero__title pointer-events-none flex flex-col items-center gap-3 px-6 text-center"
        >
          <p className="m-0 font-display text-[13px] tracking-[0.3em] text-app-flare">
            NASA SPACE APPS 2026 · DANCING WITH THE SARS
          </p>
          <h1 id="hero-title" className="vx-hero__h1 m-0">
            NISAR Surface Change
          </h1>
          <p className="vx-hero__sub m-0 font-light text-[#D9DEE5]">
            Watch the planet's surface shift, one radar pass at a time.
          </p>
          <p className="vx-hero__about m-0 text-[#D9DEE5]">
            NISAR is the NASA-ISRO radar satellite that images Earth's surface day or night and
            through cloud. Pick a place and compare two passes to see what changed.
          </p>
        </section>

        <div className="vx-hero__stage" aria-hidden="true">
          <div className="vx-hero__globe-box">
            <div className="vx-in-bottom vx-hero__globe h-full w-full">
              <div className="vx-hero__bob relative h-full w-full">
                <img
                  src={`${import.meta.env.BASE_URL}globe.webp`}
                  alt=""
                  width={1200}
                  height={1200}
                  fetchPriority="high"
                  decoding="async"
                  className="vx-hero__spin relative block h-full w-full rounded-full"
                  style={{ transform: `rotate(${tilt}deg)` }}
                  draggable={false}
                />
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
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
        </div>

        <div className="vx-hero__dock-row pointer-events-none flex justify-center px-3">
          <Glass as="nav" aria-label="Command" className="vx-in-bottom vx-hero__dock pointer-events-auto rounded-full">
            <div className="relative flex p-2" onMouseLeave={leave}>
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
                  onMouseEnter={() => pick(i)}
                  onFocus={() => focusOn(i)}
                  onBlur={blurFrom}
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
    </div>
  );
}
