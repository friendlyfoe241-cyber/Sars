import { useEffect, useState, type MouseEvent } from "react";
import { STEPS, type StepId } from "../lib/steps";
import { SNAP, useSprings } from "../hooks/useSprings";
import StepIcon from "./StepIcon";

/**
 * Segmented step control with a liquid indicator that stretches as it moves.
 * Reports the clicked tab's rectangle so the sidebar can grow out of it.
 * Shows labels on wide screens and icons only on narrow ones.
 */
export default function StepRail({
  active,
  available,
  onPick,
}: {
  active: StepId;
  available: Record<StepId, boolean>;
  onPick: (step: StepId, from: DOMRect) => void;
}) {
  const [wide, setWide] = useState(() => window.innerWidth >= 1100);
  useEffect(() => {
    let raf = 0;
    const on = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setWide(window.innerWidth >= 1100);
      });
    };
    window.addEventListener("resize", on);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", on);
    };
  }, []);
  const BW = wide ? 104 : 48;

  const { spring } = useSprings();
  const idx = Math.max(0, STEPS.findIndex((s) => s.id === active));
  const s = spring(`ind${BW}`, idx * BW, SNAP, idx * BW);
  const stretch = Math.min(40, Math.abs(s.v) * 0.045);

  return (
    <nav
      aria-label="Workflow steps"
      className="relative flex rounded-full p-1"
      style={{ background: "rgba(255,255,255,.05)", boxShadow: "inset 0 1px 3px rgba(0,0,0,.7)" }}
    >
      <span
        aria-hidden="true"
        className="absolute rounded-full"
        style={{
          top: 4,
          bottom: 4,
          left: 4 + s.x - stretch / 2,
          width: BW + stretch,
          background: "linear-gradient(135deg, #4F46E5, #6D4CE0)",
          boxShadow:
            "inset 1px 1.5px 0 rgba(255,255,255,.45), inset 0 -6px 12px rgba(0,0,0,.25), 0 6px 22px rgba(99,102,241,.5)",
        }}
      />
      {STEPS.map((step) => {
        const on = step.id === active;
        const ok = available[step.id];
        return (
          <button
            key={step.id}
            type="button"
            data-step={step.id}
            onClick={(e: MouseEvent<HTMLButtonElement>) => onPick(step.id, e.currentTarget.getBoundingClientRect())}
            aria-current={on ? "step" : undefined}
            aria-label={ok ? (wide ? undefined : step.label) : `${step.label}, locked: ${step.locked}`}
            title={ok ? step.label : `${step.label}: ${step.locked}`}
            className="lg-btn relative flex items-center justify-center gap-2 rounded-full border-0 bg-transparent text-[14px]"
            style={{ width: BW, minHeight: 44, color: on ? "#fff" : ok ? "#C9D0DA" : "#7E8794" }}
          >
            <StepIcon id={step.id} size={16} />
            {wide && step.label}
          </button>
        );
      })}
    </nav>
  );
}
