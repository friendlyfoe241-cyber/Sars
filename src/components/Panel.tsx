import type { ReactNode } from "react";
import Glass from "./glass/Glass";

export default function Panel({
  title,
  area,
  right,
  scroll = true,
  className = "",
  bodyClassName = "",
  children,
}: {
  title?: string;
  area?: string;
  right?: ReactNode;
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
