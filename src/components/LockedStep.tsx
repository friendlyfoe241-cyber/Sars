import type { ReactNode } from "react";
import Glass from "./glass/Glass";
import StepIcon from "./StepIcon";
import type { StepId } from "../lib/steps";

/**
 * A step with nothing to show yet, as a whole page: what it needs, the state
 * that is holding it up (a search running, a failed load ...) and a way on.
 */
export default function LockedStep({
  step,
  title,
  message,
  notice,
  ctaLabel,
  onCta,
}: {
  step: StepId;
  title: string;
  message: string;
  /** the current state, when it explains why the step is not ready */
  notice?: ReactNode;
  ctaLabel: string;
  onCta: () => void;
}) {
  return (
    <div className="vx-empty">
      <Glass as="section" aria-label={title} className="lg-panel vx-empty__card">
        <div className="flex flex-col items-center gap-4 px-6 py-8 text-center sm:px-10 sm:py-10">
          <span
            className="grid size-16 place-items-center rounded-full text-app-flare"
            style={{ background: "rgba(79,70,229,.18)", boxShadow: "inset 1px 1px 0 rgba(157,184,255,.35)" }}
          >
            <StepIcon id={step} size={28} />
          </span>
          <h3 className="m-0 text-[20px] leading-7">{title}</h3>
          <p className="m-0 max-w-[44ch] text-[14px] leading-[1.6] text-app-muted">{message}</p>
          {notice && <div className="w-full text-left">{notice}</div>}
          <button type="button" onClick={onCta} className="vx-button vx-button--primary">
            {ctaLabel}
          </button>
        </div>
      </Glass>
    </div>
  );
}
