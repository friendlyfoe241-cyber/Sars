import { useLayoutEffect, useRef, type ReactNode } from "react";
import { MOTION_MS, prefersReducedMotion } from "../hooks/usePresence";

const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)"; // --vx-ease

/** Layout offset of `el` inside `ancestor` (transforms ignored). */
function offsetIn(el: HTMLElement, ancestor: HTMLElement): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== ancestor) {
    x += n.offsetLeft;
    y += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  return { x, y };
}

/**
 * The one map stage of the workspace.  It is rendered once in the page frame
 * (so the Leaflet instance is never remounted) and laid over the map slot of
 * the current step page: each page's grid places and sizes an empty
 * `[data-map-slot]` element, and the stage copies that box.
 *
 * When the step changes the stage takes its new box at once and glides there
 * with a FLIP transform (translate + scale back to identity, transform only,
 * one motion duration); Leaflet is resized once by MapView's size observer.
 * A page without a map (a locked step) hides the stage; it keeps a full-size
 * box so Leaflet never sees a zero size.
 */
export default function MapStage({
  slotKey,
  heroOpen,
  children,
}: {
  /** changes whenever the current page's map slot may have been replaced */
  slotKey: string;
  /** no glide while the hero is up or leaving: the page entrance covers it */
  heroOpen: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const heroWas = useRef(heroOpen);

  useLayoutEffect(() => {
    const stage = ref.current;
    const body = stage?.parentElement;
    if (!stage || !body) return;

    const place = (animate: boolean) => {
      const slot = body.querySelector<HTMLElement>("[data-map-slot]");
      const wasHidden = stage.dataset.hidden === "true";
      const old = { x: stage.offsetLeft, y: stage.offsetTop, w: stage.offsetWidth, h: stage.offsetHeight };
      let box = { x: 0, y: 0, w: body.clientWidth, h: body.clientHeight };
      if (slot) box = { ...offsetIn(slot, body), w: slot.offsetWidth, h: slot.offsetHeight };
      // written once per change, never per frame
      const s = stage.style;
      s.left = `${box.x}px`;
      s.top = `${box.y}px`;
      s.width = `${box.w}px`;
      s.height = `${box.h}px`;
      stage.dataset.hidden = String(!slot);
      stage.toggleAttribute("inert", !slot);

      if (!animate || !slot || prefersReducedMotion() || box.w === 0 || box.h === 0) return;
      if (wasHidden) {
        stage.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MOTION_MS, easing: EASE });
        return;
      }
      const dx = old.x - box.x;
      const dy = old.y - box.y;
      const sx = old.w / box.w;
      const sy = old.h / box.h;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return;
      stage.animate(
        [
          { transformOrigin: "0 0", transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
          { transformOrigin: "0 0", transform: "none" },
        ],
        { duration: MOTION_MS, easing: EASE },
      );
    };

    place(!heroWas.current && !heroOpen);

    // the slot or the frame resized (window, phone map expand): follow it
    let raf = 0;
    const ro = new ResizeObserver(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        place(false);
      });
    });
    ro.observe(body);
    const slot = body.querySelector<HTMLElement>("[data-map-slot]");
    if (slot) {
      ro.observe(slot);
      // the page head above the slot can change height (wrapping, text zoom)
      const head = slot.parentElement?.querySelector<HTMLElement>(".vx-page__head");
      if (head) ro.observe(head);
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // heroOpen is read through heroWas; a hero change alone moves nothing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotKey]);

  // after the placement above: remember whether the hero was up this commit
  useLayoutEffect(() => {
    heroWas.current = heroOpen;
  });

  return (
    <div ref={ref} className="vx-stage" data-hidden="false">
      {children}
    </div>
  );
}
