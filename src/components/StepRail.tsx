import { useEffect, useState } from "react";
import { STEPS, type StepId } from "../lib/steps";
import StepIcon from "./StepIcon";

/**
 * Segmented step control.  The active indicator slides sideways to the
 * current step (a transform transition).  Shows labels on wide screens and
 * icons only on narrow ones.
 */
export default function StepRail({
  active,
  available,
  onPick,
}: {
  active: StepId;
  available: Record<StepId, boolean>;
  onPick: (step: StepId) => void;
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
  const BW = wide ? 100 : 48;
  const idx = Math.max(0, STEPS.findIndex((s) => s.id === active));

  return (
    <nav
      aria-label="Workflow steps"
      className="relative flex shrink-0 rounded-full p-1"
      style={{ background: "rgba(255,255,255,.05)", boxShadow: "inset 0 1px 3px rgba(0,0,0,.7)" }}
    >
      <span
        aria-hidden="true"
        className="vx-rail-indicator absolute rounded-full"
        style={{
          top: 4,
          bottom: 4,
          left: 4,
          width: BW,
          transform: `translateX(${idx * BW}px)`,
          background: "linear-gradient(135deg, #4F46E5, #6D4CE0)",
          boxShadow: "inset 1px 1.5px 0 rgba(255,255,255,.45), 0 4px 14px rgba(99,102,241,.4)",
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
            onClick={() => onPick(step.id)}
            aria-current={on ? "step" : undefined}
            aria-label={ok ? (wide ? undefined : step.label) : `${step.label}, locked: ${step.locked}`}
            title={ok ? step.label : `${step.label}: ${step.locked}`}
            className="lg-btn relative flex items-center justify-center gap-2 rounded-full border-0 bg-transparent text-[13px] font-medium"
            style={{ width: BW, minHeight: 44, color: on ? "#fff" : ok ? "#C9D0DA" : "#8A93A0" }}
          >
            <StepIcon id={step.id} size={16} />
            {wide && step.label}
          </button>
        );
      })}
    </nav>
  );
}
