import { useLayoutEffect, useRef, type ReactNode } from "react";
import { MOTION_MS, prefersReducedMotion } from "../hooks/usePresence";

const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

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

export default function MapStage({
  slotKey,
  heroOpen,
  children,
}: {
  slotKey: string;
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
      const head = slot.parentElement?.querySelector<HTMLElement>(".vx-page__head");
      if (head) ro.observe(head);
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotKey]);

  useLayoutEffect(() => {
    heroWas.current = heroOpen;
  });

  return (
    <div ref={ref} className="vx-stage" data-hidden="false">
      {children}
    </div>
  );
}
