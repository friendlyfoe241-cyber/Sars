// The part of the map not covered by the floating glass surfaces, measured
// from the real rects of whatever is on screen now.  Used to fit the AOI and
// to place the divider and the map furniture.  Pure DOM reads; no state.
//
// A surface declares which edge of the map it covers with
// `data-cover="left|right|top|bottom"` anywhere inside `.vx-shell`.  The
// sidebar animates its own geometry, so it declares its final rect with a
// small invisible marker element instead of being measured mid-flight.

/** Distance in px from each container edge to the nearest covering surface
 *  (gap included), or null when nothing covers that side. */
export interface Insets {
  left: number | null;
  right: number | null;
  top: number | null;
  bottom: number | null;
}

/** Dispatched on `window` when a surface moved without resizing. */
export const LAYOUT_EVENT = "vx-layout";

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

function covers(container: HTMLElement): HTMLElement[] {
  const shell = container.closest(".vx-shell");
  return shell ? Array.from(shell.querySelectorAll<HTMLElement>("[data-cover]")) : [];
}

export function coveredInsets(container: HTMLElement, gap: number): Insets {
  const cr = container.getBoundingClientRect();
  const out: Insets = { left: null, right: null, top: null, bottom: null };
  const take = (side: keyof Insets, value: number) => {
    out[side] = Math.max(out[side] ?? 0, value);
  };
  for (const el of covers(container)) {
    if (el.hidden) continue;
    const side = el.dataset.cover as keyof Insets | undefined;
    if (!side) continue;
    const r = el.getBoundingClientRect();
    if (!overlaps(r, cr)) continue;
    if (side === "left") take(side, r.right - cr.left + gap);
    else if (side === "right") take(side, cr.right - r.left + gap);
    else if (side === "top") take(side, r.bottom - cr.top + gap);
    else if (side === "bottom") take(side, cr.bottom - r.top + gap);
  }
  // a degenerate free area (surfaces cover nearly everything): ignore the lot
  const w = cr.width - (out.left ?? 0) - (out.right ?? 0);
  const h = cr.height - (out.top ?? 0) - (out.bottom ?? 0);
  if (w < 160 || h < 100) return { left: null, right: null, top: null, bottom: null };
  return out;
}

/**
 * Calls `cb` whenever the map or any covering surface changes size, appears,
 * disappears or moves.  Returns the disposer.
 */
export function observeLayout(container: HTMLElement, cb: () => void): () => void {
  const shell = container.closest(".vx-shell");
  const ro = new ResizeObserver(cb);
  const watch = () => {
    ro.disconnect();
    ro.observe(container);
    covers(container).forEach((el) => ro.observe(el));
  };
  watch();
  let mo: MutationObserver | null = null;
  if (shell) {
    mo = new MutationObserver((records) => {
      // surfaces mounting or unmounting: watch the new set
      if (records.some((r) => r.type === "childList")) watch();
      cb();
    });
    // Surfaces are direct children of the shell, so only its own child list
    // matters (a subtree watch would fire for every Leaflet tile while panning).
    mo.observe(shell, { childList: true });
    mo.observe(shell, { attributes: true, subtree: true, attributeFilter: ["hidden", "data-cover", "data-open"] });
  }
  window.addEventListener(LAYOUT_EVENT, cb);
  window.addEventListener("resize", cb);
  return () => {
    ro.disconnect();
    mo?.disconnect();
    window.removeEventListener(LAYOUT_EVENT, cb);
    window.removeEventListener("resize", cb);
  };
}
