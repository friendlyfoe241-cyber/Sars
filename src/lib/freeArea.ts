export const FIT_PADDING = 24;

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
