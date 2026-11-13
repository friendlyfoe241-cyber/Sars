import { useEffect } from "react";

const NEAR_PX = 170;
const NEAR_MAX = 0.45;

/**
 * Drives every `.lg` element's --p from the cursor position:
 * 0 with no cursor near (liquid), up to 0.45 within NEAR_PX (partly frosted),
 * 1 when the cursor is on the element (full glass). Values ease toward their
 * target each frame, so panels melt between states rather than snapping.
 */
export function useGlassProximity() {
  useEffect(() => {
    let mx = 0;
    let my = 0;
    let hasCursor = false;
    let raf = 0;
    let last = 0;
    const current = new WeakMap<Element, number>();

    const tick = (ts: number) => {
      raf = 0;
      const dt = last && ts - last < 100 ? (ts - last) / 1000 : 1 / 60;
      last = ts;
      const k = 1 - Math.exp(-dt * 6);
      let moving = false;
      // Read every rect first, then write every --p: no layout thrash.
      const els = Array.from(document.querySelectorAll<HTMLElement>(".lg")).filter(
        (el) => !el.closest("[inert]") && !el.hasAttribute("data-p-fixed"),
      );
      const targets = els.map((el) => {
        if (!hasCursor) return 0;
        const r = el.getBoundingClientRect();
        const dx = Math.max(r.left - mx, 0, mx - r.right);
        const dy = Math.max(r.top - my, 0, my - r.bottom);
        const d = Math.hypot(dx, dy);
        return d === 0 ? 1 : Math.max(0, 1 - d / NEAR_PX) * NEAR_MAX;
      });
      const writes: [HTMLElement, number][] = [];
      els.forEach((el, i) => {
        const target = targets[i];
        const cur = current.get(el) ?? (parseFloat(el.style.getPropertyValue("--p")) || 0);
        let next = cur + (target - cur) * k;
        if (Math.abs(next - target) < 0.003) next = target;
        else moving = true;
        if (next !== cur) {
          current.set(el, next);
          writes.push([el, next]);
        }
      });
      writes.forEach(([el, v]) => el.style.setProperty("--p", v.toFixed(3)));
      if (moving) raf = requestAnimationFrame(tick);
      else last = 0;
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      mx = e.clientX;
      my = e.clientY;
      hasCursor = true;
      kick();
    };
    const onLeave = () => {
      hasCursor = false;
      kick();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
}
