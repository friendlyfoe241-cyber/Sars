// The map lives in its own box (the map stage inside each step page), so no
// glass surface floats over it any more: the free map area is the whole
// stage.  Fitting the AOI uses a small constant padding inside the stage and
// the compare divider spans the stage from edge to edge.

/** Padding in px between the stage edge and a fitted area of interest. */
export const FIT_PADDING = 24;

/**
 * Calls `cb` (at most once per animation frame) whenever `el` changes size.
 * Returns the disposer.
 */
export function observeSize(el: HTMLElement, cb: () => void): () => void {
  let raf = 0;
  const ro = new ResizeObserver(() => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      cb();
    });
  });
  ro.observe(el);
  return () => {
    if (raf) cancelAnimationFrame(raf);
    ro.disconnect();
  };
}
