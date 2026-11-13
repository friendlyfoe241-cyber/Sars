import Glass from "./glass/Glass";
import StepRail from "./StepRail";
import VortexMark from "./VortexMark";
import type { StepId } from "../lib/steps";

export type ChipTone = "idle" | "busy" | "ok" | "warn" | "error";

const DOT: Record<ChipTone, string> = {
  idle: "#a3adbd",
  busy: "#7cc4ff",
  ok: "#86e3b5",
  warn: "#d4bcff",
  error: "#ff9aa6",
};

/**
 * The floating glass header: brand, the five-step rail, the live status of the
 * selection, and the way back to the globe.  `animKey` replays the entrance
 * when the workspace is revealed from the hero.
 */
export default function AppHeader({
  active,
  available,
  onPick,
  statusLabel,
  statusTone,
  statusNote,
  onGlobe,
  animKey,
}: {
  active: StepId;
  available: Record<StepId, boolean>;
  onPick: (step: StepId, from: DOMRect) => void;
  statusLabel: string;
  statusTone: ChipTone;
  statusNote: string;
  onGlobe: () => void;
  animKey: number;
}) {
  return (
    <div key={animKey} className="hdr-in">
      <Glass as="header" className="lg-dark rounded-[32px]">
        <div className="flex min-h-[60px] flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 pr-2 pl-4 sm:pl-5">
          <div className="order-1 flex items-center gap-3 min-[560px]:order-none">
            <VortexMark size={28} />
            <span className="font-display hidden text-[18px] tracking-[0.06em] min-[420px]:inline">NISAR</span>
            <span className="hidden text-[13px] text-app-muted xl:inline">Surface Change</span>
          </div>
          <div className="order-3 flex w-full justify-center min-[560px]:order-none min-[560px]:w-auto">
            <StepRail active={active} available={available} onPick={onPick} />
          </div>
          <div className="order-2 flex items-center gap-2 min-[560px]:order-none">
            <span
              role="status"
              title={statusNote}
              className="sr-only items-center gap-2 rounded-full px-3 py-[7px] text-[12px] text-app-muted lg:not-sr-only lg:inline-flex"
              style={{ background: "rgba(255,255,255,.06)", boxShadow: "inset 1px 1px 0 rgba(255,255,255,.15)" }}
            >
              <span
                aria-hidden="true"
                className="inline-block size-2 shrink-0 rounded-full"
                style={{ background: DOT[statusTone] }}
              />
              {statusLabel}
            </span>
            <button
              type="button"
              onClick={onGlobe}
              aria-label="Back to the globe"
              className="lg-btn flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-full border-0 px-3 text-[14px] text-app-text sm:px-4"
              style={{ background: "rgba(255,255,255,.08)", boxShadow: "inset 1.5px 1.5px 0 rgba(255,255,255,.35)" }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18" />
              </svg>
              <span className="hidden sm:inline">Globe</span>
            </button>
          </div>
        </div>
      </Glass>
    </div>
  );
}
