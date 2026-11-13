import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { LayoutMode } from "../ui/useLayoutMode";

export type InstrumentTab = "observations" | "results" | "graph";

const TABS: { id: InstrumentTab; label: string; eyebrow: string; title: string }[] = [
  { id: "observations", label: "Observations", eyebrow: "Catalogue", title: "Observations" },
  { id: "results", label: "Results", eyebrow: "Statistics", title: "Results" },
  { id: "graph", label: "Graph", eyebrow: "Temporal", title: "Brightness by acquisition date" },
];

interface InstrumentRowProps {
  layout: LayoutMode;
  open: boolean;
  onToggle: () => void;
  tab: InstrumentTab;
  onTab: (t: InstrumentTab) => void;
  /** open the row on this tab (from the collapsed bar) */
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
      className="orb-button orb-button--ghost orb-instr__collapse"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={open ? "instruments" : undefined}
      aria-label={open ? "Hide instrument row" : "Show instrument row"}
    >
      {open ? <ChevronDown size={18} aria-hidden /> : <ChevronUp size={18} aria-hidden />}
      <span className="orb-instr__collapse-text">{open ? "Hide" : "Show"}</span>
    </button>
  );
}

function Panel({
  id,
  eyebrow,
  title,
  children,
  action,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section
      id={`instrument-${id}`}
      className="orb-panel orb-instr__panel"
      aria-labelledby={`instrument-${id}-title`}
      tabIndex={-1}
    >
      <header className="orb-instr__head">
        <div>
          <span className="orb-eyebrow">{eyebrow}</span>
          <h2 id={`instrument-${id}-title`}>{title}</h2>
        </div>
        {action}
      </header>
      <div className="orb-instr__body">{children}</div>
    </section>
  );
}

export default function InstrumentRow({
  layout,
  open,
  onToggle,
  tab,
  onTab,
  onOpenTab,
  summaries,
  observations,
  results,
  graph,
}: InstrumentRowProps) {
  const tabRefs = useRef<Partial<Record<InstrumentTab, HTMLButtonElement | null>>>({});
  const content: Record<InstrumentTab, ReactNode> = { observations, results, graph };
  const collapsible = layout === "wide" || layout === "mid";

  if (collapsible && !open) {
    return (
      <div className="orb-bottom orb-bottom--closed" data-layout="bar">
        <div className="orb-bar" role="group" aria-label="Instruments, collapsed">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="orb-bar__tab"
              aria-expanded={false}
              onClick={() => onOpenTab(t.id)}
            >
              <span className="orb-bar__name">{t.label}</span>
              <span className="orb-bar__status">{summaries[t.id]}</span>
            </button>
          ))}
          <CollapseButton open={false} onToggle={onToggle} />
        </div>
      </div>
    );
  }

  if (layout === "wide") {
    return (
      <div className="orb-bottom" id="instruments" data-layout="wide">
        <Panel id="observations" eyebrow="Catalogue" title="Observations">
          {observations}
        </Panel>
        <Panel id="results" eyebrow="Statistics" title="Results">
          {results}
        </Panel>
        <Panel
          id="graph"
          eyebrow="Temporal"
          title="Brightness by acquisition date"
          action={<CollapseButton open onToggle={onToggle} />}
        >
          {graph}
        </Panel>
      </div>
    );
  }

  if (layout === "mid") {
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
    return (
      <div className="orb-bottom" id="instruments" data-layout="mid">
        <section className="orb-panel orb-instr__panel" aria-label="Instruments">
          <header className="orb-instr__head">
            <div role="tablist" aria-label="Instrument panels" className="orb-instr__tabs" onKeyDown={onKey}>
              {TABS.map((t) => (
                <button
                  key={t.id}
                  ref={(el) => {
                    tabRefs.current[t.id] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`instrument-tab-${t.id}`}
                  aria-selected={tab === t.id}
                  aria-controls="instrument-tabpanel"
                  tabIndex={tab === t.id ? 0 : -1}
                  className="orb-instr__tab"
                  onClick={() => onTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <CollapseButton open onToggle={onToggle} />
          </header>
          <div
            id="instrument-tabpanel"
            role="tabpanel"
            aria-labelledby={`instrument-tab-${tab}`}
            className="orb-instr__body"
          >
            <h2 className="sr-only">{TABS.find((t) => t.id === tab)!.title}</h2>
            <div id={`instrument-${tab}`} tabIndex={-1} className="orb-instr__tabbody">
              {content[tab]}
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="orb-bottom" id="instruments" data-layout="stacked">
      {TABS.map((t) => (
        <Panel key={t.id} id={t.id} eyebrow={t.eyebrow} title={t.title}>
          {content[t.id]}
        </Panel>
      ))}
    </div>
  );
}
