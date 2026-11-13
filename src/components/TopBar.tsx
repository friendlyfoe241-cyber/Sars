import { memo } from "react";
import { Compass, Layers, LocateFixed, PanelLeft, PanelRight, Sigma } from "lucide-react";
import { DESTINATIONS, type Dest } from "../ui/types";

export type ChipTone = "idle" | "busy" | "ok" | "warn" | "error";

interface TopBarProps {
  dest: Dest;
  onDest: (d: Dest) => void;
  /** screen title and one-line context, derived from the real selection */
  title: string;
  context: string;
  statusLabel: string;
  statusTone: ChipTone;
  statusNote: string;
  canFit: boolean;
  onFit: () => void;
  controlsOpen: boolean;
  onToggleControls: () => void;
  detailsOpen: boolean;
  onToggleDetails: () => void;
}

const ICONS = { explore: Compass, compare: Layers, results: Sigma } as const;

function StatusChip({
  label,
  tone,
  note,
  inline,
}: {
  label: string;
  tone: ChipTone;
  note: string;
  inline?: boolean;
}) {
  return (
    <span
      className={`orb-chip${inline ? " orb-chip--inline" : ""}`}
      data-tone={tone}
      title={note}
      role={inline ? undefined : "status"}
      aria-hidden={inline ? true : undefined}
    >
      <span className="orb-chip__dot" aria-hidden />
      <span>{label}</span>
    </span>
  );
}

function TopBar({
  dest,
  onDest,
  title,
  context,
  statusLabel,
  statusTone,
  statusNote,
  canFit,
  onFit,
  controlsOpen,
  onToggleControls,
  detailsOpen,
  onToggleDetails,
}: TopBarProps) {
  return (
    <header className="orb-top">
      <div className="orb-brand">
        NISAR<span>Surface Change</span>
      </div>

      <nav className="orb-nav" aria-label="Primary">
        {DESTINATIONS.map(({ id, label }) => {
          const Icon = ICONS[id];
          return (
            <button
              key={id}
              type="button"
              className="orb-nav__item"
              aria-current={dest === id ? "page" : undefined}
              onClick={() => onDest(id)}
            >
              <Icon size={16} aria-hidden className="orb-desktop-only" />
              {label}
            </button>
          );
        })}
      </nav>

      <div className="orb-tools">
        <StatusChip label={statusLabel} tone={statusTone} note={statusNote} />
        <div className="orb-iconbar" role="toolbar" aria-label="Map and panels">
          <button
            type="button"
            className="orb-icon-btn"
            onClick={onFit}
            disabled={!canFit}
            aria-label="Fit map to selection"
            title={canFit ? "Fit map to selection" : "Fit map to selection (choose a location first)"}
          >
            <LocateFixed size={18} aria-hidden />
          </button>
          <button
            type="button"
            className="orb-icon-btn orb-desktop-only"
            onClick={onToggleControls}
            aria-pressed={controlsOpen}
            aria-label="Show controls panel"
            title="Show or hide the controls panel"
          >
            <PanelLeft size={18} aria-hidden />
          </button>
          <button
            type="button"
            className="orb-icon-btn orb-desktop-only"
            onClick={onToggleDetails}
            aria-pressed={detailsOpen}
            aria-label="Show observation panel"
            title="Show or hide the observation panel"
          >
            <PanelRight size={18} aria-hidden />
          </button>
        </div>
      </div>

      <div className="orb-title">
        <span className="orb-eyebrow">{DESTINATIONS.find((d) => d.id === dest)?.label}</span>
        <h1 title={title}>{title}</h1>
        <p title={context}>{context}</p>
        <StatusChip label={statusLabel} tone={statusTone} note={statusNote} inline />
      </div>
    </header>
  );
}

export default memo(TopBar);
