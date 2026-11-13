import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import Glass from "./glass/Glass";

export type InstrumentTab = "observations" | "results" | "graph";

const TABS: { id: InstrumentTab; label: string; title: string }[] = [
  { id: "observations", label: "Observations", title: "Observations" },
  { id: "results", label: "Results", title: "Results" },
  { id: "graph", label: "Graph", title: "Brightness by acquisition date" },
];

interface InstrumentDockProps {
  /** "dock": glass bar along the bottom of the free map area (collapsible).
   *  "inline": the same content inside a sidebar step (phones). */
  variant: "dock" | "inline";
  /** Hide from focus and assistive tech (while the hero covers the app). */
  inert?: boolean;
  open: boolean;
  onToggle: () => void;
  tab: InstrumentTab;
  onTab: (t: InstrumentTab) => void;
  /** open the dock on this tab (from the collapsed bar) */
  onOpenTab: (t: InstrumentTab) => void;
  /** one-line status per instrument, shown on the collapsed bar */
  summaries: Record<InstrumentTab, string>;
  observations: ReactNode;
  results: ReactNode;
  graph: ReactNode;
}

function CollapseButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="vx-button vx-button--ghost vx-instr__collapse"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={open ? "instruments" : undefined}
      aria-label={open ? "Hide instruments" : "Show instruments"}
    >
      {open ? <ChevronDown size={18} aria-hidden /> : <ChevronUp size={18} aria-hidden />}
      <span>{open ? "Hide" : "Show"}</span>
    </button>
  );
}

/** Observations table, results table and temporal graph, one at a time. */
export default function InstrumentDock({
  variant,
  open,
  onToggle,
  tab,
  onTab,
  onOpenTab,
  summaries,
  observations,
  results,
  graph,
  inert,
}: InstrumentDockProps) {
  const tabRefs = useRef<Partial<Record<InstrumentTab, HTMLButtonElement | null>>>({});
  const content: Record<InstrumentTab, ReactNode> = { observations, results, graph };
  const inline = variant === "inline";

  const onKey = (e: KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab);
    let next = i;
    if (e.key === "ArrowRight") next = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (i + TABS.length - 1) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    else return;
    e.preventDefault();
    onTab(TABS[next].id);
    tabRefs.current[TABS[next].id]?.focus();
  };

  if (!inline && !open) {
    return (
      <div className="vx-bottom" data-cover="bottom" data-open="false" inert={inert}>
        <Glass className="lg-panel rounded-[28px]">
          <div className="vx-instr" role="group" aria-label="Instruments, collapsed">
            <div className="vx-instr__head">
              <div className="vx-instr__tabs" role="group" aria-label="Open an instrument">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="vx-instr__tab"
                    aria-expanded={false}
                    title={summaries[t.id]}
                    onClick={() => onOpenTab(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <CollapseButton open={false} onToggle={onToggle} />
            </div>
          </div>
        </Glass>
      </div>
    );
  }

  const inner = (
    <div className={`vx-instr${inline ? " vx-instr--inline" : ""}`} id={inline ? undefined : "instruments"}>
      <div className="vx-instr__head">
        <div className="flex min-w-0 items-center gap-2">
          <div role="tablist" aria-label="Instruments" className="vx-instr__tabs" onKeyDown={onKey}>
            {TABS.map((t) => (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[t.id] = el;
                }}
                type="button"
                role="tab"
                id={`instrument-tab-${t.id}${inline ? "-i" : ""}`}
                aria-selected={tab === t.id}
                aria-controls={`instrument-tabpanel${inline ? "-i" : ""}`}
                tabIndex={tab === t.id ? 0 : -1}
                className="vx-instr__tab"
                onClick={() => onTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          {!inline && <span className="vx-instr__summary hidden lg:inline">{summaries[tab]}</span>}
        </div>
        {!inline && <CollapseButton open onToggle={onToggle} />}
      </div>
      <div
        id={`instrument-tabpanel${inline ? "-i" : ""}`}
        role="tabpanel"
        aria-labelledby={`instrument-tab-${tab}${inline ? "-i" : ""}`}
        className="vx-instr__body"
      >
        <h2 className="sr-only">{TABS.find((t) => t.id === tab)!.title}</h2>
        <div id={inline ? undefined : `instrument-${tab}`} tabIndex={-1} className="vx-instr__tabbody">
          {content[tab]}
        </div>
      </div>
    </div>
  );

  if (inline) return <section aria-label="Instruments">{inner}</section>;
  return (
    <div className="vx-bottom" data-cover="bottom" data-open="true" inert={inert}>
      <Glass as="section" aria-label="Instruments" className="lg-panel rounded-[28px]">
        {inner}
      </Glass>
    </div>
  );
}
