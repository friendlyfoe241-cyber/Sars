import StepIcon from "./StepIcon";
import type { StepId } from "../lib/steps";

/** A step with nothing to show yet: what it needs, and a way to get there. */
export default function LockedStep({
  step,
  message,
  ctaLabel,
  onCta,
}: {
  step: StepId;
  message: string;
  ctaLabel: string;
  onCta: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-4 px-5 py-6">
      <span
        className="grid h-12 w-12 place-items-center rounded-full text-app-flare"
        style={{ background: "rgba(79,70,229,.18)", boxShadow: "inset 1px 1px 0 rgba(157,184,255,.35)" }}
      >
        <StepIcon id={step} size={22} />
      </span>
      <p className="m-0 text-[13px] leading-[1.6] text-app-muted">{message}</p>
      <button type="button" onClick={onCta} className="vx-button vx-button--primary">
        {ctaLabel}
      </button>
    </div>
  );
}
