import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** Content-box size of an element in CSS pixels (0 x 0 until measured). */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const observer = useRef<ResizeObserver | null>(null);
  const set = useCallback((el: T | null) => {
    observer.current?.disconnect();
    ref.current = el;
    if (!el) return;
    const read = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    read();
    observer.current = new ResizeObserver(read);
    observer.current.observe(el);
  }, []);
  useLayoutEffect(() => () => observer.current?.disconnect(), []);
  return [set, size] as const;
}
