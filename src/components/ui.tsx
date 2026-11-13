import { useId, useState, type ReactNode } from "react";
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
    <section className="vx-section">
      <h3 className="vx-section__title">
        <span>{title}</span>
        {right}
      </h3>
      {children}
    </section>
  );
}

/**
 * A section whose body sits behind a disclosure header.  `defaultOpen` is the
 * initial state only; afterwards the user's choice wins.
 */
export function DisclosureSection({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  /** short status shown on the header (e.g. "73 scenes") */
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <section className="vx-section vx-section--disclosure">
      <h3 className="vx-section__title vx-section__title--button">
        <button type="button" aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
          <span>{title}</span>
          {summary !== undefined && <span className="vx-section__summary">{summary}</span>}
        </button>
      </h3>
      {open && (
        <div id={bodyId} className="vx-section__body">
          {children}
        </div>
      )}
    </section>
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
    <div className={`vx-kv${stack ? " vx-kv--stack" : ""}`}>
      <dt className="vx-kv__label">
        {icon}
        <span>{label}</span>
      </dt>
      <dd className="vx-kv__value m-0">{children}</dd>
    </div>
  );
}

export function Spinner() {
  return <span className="vx-spinner" aria-hidden />;
}
