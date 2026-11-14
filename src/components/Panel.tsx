import type { ReactNode } from "react";
import Glass from "./glass/Glass";

/**
 * A glass region of a step page.  On wide screens the page grid gives it a
 * cell (`area`) and its body scrolls inside it; on narrow screens panels
 * stack in the page's scrolling content column.
 */
export default function Panel({
  title,
  area,
  right,
  scroll = true,
  className = "",
  bodyClassName = "",
  children,
}: {
  /** visible panel title (also its accessible name) */
  title?: string;
  /** grid-template-area of the page grid */
  area?: string;
  /** extra content on the title row */
  right?: ReactNode;
  /** the body scrolls itself (false: a child such as a table scrolls) */
  scroll?: boolean;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <Glass
      as="section"
      aria-label={title}
      className={`lg-panel vx-panel ${className}`}
      style={area ? { gridArea: area } : undefined}
    >
      {title && (
        <div className="vx-panel__head">
          <h3 className="vx-panel__title">{title}</h3>
          {right}
        </div>
      )}
      <div className={`vx-panel__body ${scroll ? "vx-scroll" : ""} ${bodyClassName}`}>{children}</div>
    </Glass>
  );
}
