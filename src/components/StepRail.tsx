import { useEffect, useState } from "react";
import { STEPS, type StepId } from "../lib/steps";
import StepIcon from "./StepIcon";

export default function StepRail({
  active,
  available,
  onPick,
}: {
  active: StepId;
  available: Record<StepId, boolean>;
  onPick: (step: StepId) => void;
}) {
  const [vw, setVw] = useState(() => window.innerWidth);
  useEffect(() => {
    let raf = 0;
    const on = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setVw(window.innerWidth);
      });
    };
    window.addEventListener("resize", on);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", on);
    };
  }, []);
  const wide = vw >= 1100;
  const BW = wide ? 100 : vw < 360 ? 44 : 48;
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
          background: "var(--vx-accent)",
          boxShadow: "0 4px 14px rgba(0,0,0,.45)",
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
            style={{ width: BW, minHeight: 44, color: on ? "var(--vx-on-accent)" : ok ? "#C9D0DA" : "#8A93A0" }}
          >
            <StepIcon id={step.id} size={16} />
            {wide && step.label}
          </button>
        );
      })}
    </nav>
  );
}
