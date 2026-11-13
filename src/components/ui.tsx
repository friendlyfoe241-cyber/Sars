import type { ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

/** A labelled block inside a dock: mono eyebrow title, optional right slot. */
export function Section({
  title,
  children,
  right,
}: {
  title: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <section className="orb-section">
      <h3 className="orb-section__title">
        <span>{title}</span>
        {right}
      </h3>
      {children}
    </section>
  );
}

/**
 * A floating instrument panel: 48px header, optional collapse, scrolling body.
 * Solid surface: a backdrop blur would re-blur a large map region every frame.
 */
export function Dock({
  id,
  eyebrow,
  title,
  collapsed,
  onToggle,
  className = "",
  hidden,
  children,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
  hidden?: boolean;
  children: ReactNode;
}) {
  const bodyId = `${id}-body`;
  return (
    <aside className={className} hidden={hidden} aria-labelledby={`${id}-title`}>
      <div className="orb-panel orb-dock" data-collapsed={collapsed}>
        <div className="orb-dock__head">
          <div>
            {eyebrow && <span className="orb-eyebrow">{eyebrow}</span>}
            <h2 id={`${id}-title`}>{title}</h2>
          </div>
          <button
            type="button"
            className="orb-button orb-button--ghost !px-0 w-11"
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
          >
            {collapsed ? <ChevronDown size={18} aria-hidden /> : <ChevronUp size={18} aria-hidden />}
          </button>
        </div>
        <div id={bodyId} className="orb-dock__body">
          {children}
        </div>
      </div>
    </aside>
  );
}

/** Key/value row: label cell (icon + text) left, value right-aligned. */
export function KeyRow({
  icon,
  label,
  children,
  stack,
}: {
  icon?: ReactNode;
  label: string;
  children: ReactNode;
  stack?: boolean;
}) {
  return (
    <div className={`orb-kv${stack ? " orb-kv--stack" : ""}`}>
      <dt className="orb-kv__label">
        {icon}
        <span>{label}</span>
      </dt>
      <dd className="orb-kv__value m-0">{children}</dd>
    </div>
  );
}

export function Spinner() {
  return <span className="orb-spinner" aria-hidden />;
}
