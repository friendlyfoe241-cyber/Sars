import type { ReactNode } from "react";

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
    <section className="border-b border-app-border px-4 py-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-medium tracking-[0.06em] text-app-muted uppercase">
          {title}
        </h2>
        {right}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}
