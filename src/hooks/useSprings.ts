import { useEffect, useReducer, useRef } from "react";

/** [stiffness, damping, rest epsilon] */
export type SpringPreset = readonly [number, number, number];

export const FLOAT: SpringPreset = [55, 10, 0.002];
export const FLUID: SpringPreset = [170, 19, 0.02];
export const SOFT: SpringPreset = [110, 16, 0.02];
export const SNAP: SpringPreset = [340, 26, 0.3];
export const PANEL: SpringPreset = [190, 21, 0.001];

interface Spring {
  x: number;
  v: number;
  t: number;
  k: number;
  c: number;
  eps: number;
  rest: boolean;
}

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A tiny spring engine. Call `spring(key, target, preset, initial)` during
 * render: it returns the live spring and re-renders the component every frame
 * until all springs settle. Retargeting mid-flight keeps velocity, so
 * interrupted motion stays fluid.
 */
export function useSprings() {
  const [, force] = useReducer((n: number) => n + 1, 0);
  const ref = useRef<{ sp: Map<string, Spring>; raf: number; last: number; dead: boolean } | null>(null);
  if (!ref.current) ref.current = { sp: new Map(), raf: 0, last: 0, dead: false };
  const s = ref.current;

  useEffect(() => {
    s.dead = false;
    return () => {
      s.dead = true;
      if (s.raf) cancelAnimationFrame(s.raf);
      s.raf = 0;
    };
  }, [s]);

  const loop = (ts: number) => {
    s.raf = 0;
    if (s.dead) return;
    // Real elapsed time (capped), integrated in small sub-steps, so motion
    // keeps its speed even when the browser drops frames.
    const dt = s.last ? Math.min(0.1, Math.max(0, (ts - s.last) / 1000)) : 1 / 60;
    s.last = ts;
    const steps = Math.max(1, Math.ceil(dt / 0.004));
    const h = dt / steps;
    let active = false;
    s.sp.forEach((p) => {
      if (p.rest) return;
      for (let j = 0; j < steps; j++) {
        const a = -p.k * (p.x - p.t) - p.c * p.v;
        p.v += a * h;
        p.x += p.v * h;
      }
      if (Math.abs(p.x - p.t) < p.eps && Math.abs(p.v) < p.eps * 6) {
        p.x = p.t;
        p.v = 0;
        p.rest = true;
      } else active = true;
    });
    force();
    if (active) kick();
    else s.last = 0;
  };
  const kick = () => {
    if (!s.raf && !s.dead) s.raf = requestAnimationFrame(loop);
  };

  const spring = (key: string, target: number, preset: SpringPreset, init?: number) => {
    let p = s.sp.get(key);
    if (reducedMotion()) {
      // snap: no animation, no per-frame re-renders
      if (!p) {
        p = { x: target, v: 0, t: target, k: preset[0], c: preset[1], eps: preset[2], rest: true };
        s.sp.set(key, p);
      } else {
        p.x = p.t = target;
        p.v = 0;
        p.rest = true;
      }
      return p;
    }
    if (!p) {
      p = { x: init ?? 0, v: 0, t: target, k: preset[0], c: preset[1], eps: preset[2], rest: false };
      s.sp.set(key, p);
      if (p.x === target) p.rest = true;
      else kick();
    } else if (p.t !== target) {
      p.t = target;
      p.rest = false;
      kick();
    }
    return p;
  };

  const reset = (prefix: string) => {
    [...s.sp.keys()].forEach((k) => {
      if (k.startsWith(prefix)) s.sp.delete(k);
    });
  };

  return { spring, reset };
}
