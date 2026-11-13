// The part of the map not covered by the floating panels, measured from the
// real rects of whichever panels are currently open.  Used to fit the AOI and
// to place the divider and map furniture.  Pure DOM reads; no state.

/** Distance in px from each container edge to the nearest covering panel
 *  (gap included), or null when no open panel covers that side. */
export interface Insets {
  left: number | null;
  right: number | null;
  top: number | null;
  bottom: number | null;
}

const SELECTORS = {
  left: ".orb-left",
  right: ".orb-right",
  top: ".orb-top",
  bottom: ".orb-bottom",
} as const;

function overlaps(r: DOMRect, c: DOMRect): boolean {
  return (
    r.width > 0 &&
    r.height > 0 &&
    r.right > c.left &&
    r.left < c.right &&
    r.bottom > c.top &&
    r.top < c.bottom
  );
}

export function coveredInsets(container: HTMLElement, gap: number): Insets {
  const cr = container.getBoundingClientRect();
  const shell = container.closest(".orb-shell");
  const out: Insets = { left: null, right: null, top: null, bottom: null };
  if (!shell) return out;
  const take = (side: keyof Insets, value: number) => {
    out[side] = Math.max(out[side] ?? 0, value);
  };
  for (const side of ["left", "right", "top", "bottom"] as const) {
    shell.querySelectorAll<HTMLElement>(`:scope > ${SELECTORS[side]}`).forEach((el) => {
      if (el.hidden) return;
      const r = el.getBoundingClientRect();
      if (!overlaps(r, cr)) return;
      if (side === "left") take(side, r.right - cr.left + gap);
      else if (side === "right") take(side, cr.right - r.left + gap);
      else if (side === "top") take(side, r.bottom - cr.top + gap);
      else take(side, cr.bottom - r.top + gap);
    });
  }
  // a degenerate free area (panels cover nearly everything): ignore the lot
  const w = cr.width - (out.left ?? 0) - (out.right ?? 0);
  const h = cr.height - (out.top ?? 0) - (out.bottom ?? 0);
  if (w < 160 || h < 120) return { left: null, right: null, top: null, bottom: null };
  return out;
}

/**
 * Calls `cb` whenever the map or any panel changes size, opens, closes or is
 * replaced.  Returns the disposer.
 */
export function observeLayout(container: HTMLElement, cb: () => void): () => void {
  const shell = container.closest(".orb-shell");
  const ro = new ResizeObserver(cb);
  ro.observe(container);
  const watch = () => {
    ro.disconnect();
    ro.observe(container);
    shell?.querySelectorAll(":scope > .orb-left, :scope > .orb-right, :scope > .orb-top, :scope > .orb-bottom").forEach((el) => ro.observe(el));
  };
  watch();
  let mo: MutationObserver | null = null;
  if (shell) {
    mo = new MutationObserver((records) => {
      if (records.some((r) => r.type === "childList" && r.target === shell)) watch();
      cb();
    });
    mo.observe(shell, {
      attributes: true,
      subtree: true,
      attributeFilter: ["hidden", "data-collapsed", "data-details", "data-instruments", "data-layout"],
      childList: true,
    });
  }
  return () => {
    ro.disconnect();
    mo?.disconnect();
  };
}
