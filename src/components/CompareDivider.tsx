import { useEffect, useRef, useState, type MutableRefObject } from "react";
import L from "leaflet";
import { ImageOverlay, useMap } from "react-leaflet";
import { MoveHorizontal } from "lucide-react";
import Glass from "./glass/Glass";
import { observeSize } from "../lib/freeArea";

const BEFORE_PANE = "orbCompareBefore";
const AFTER_PANE = "orbCompareAfter";
const PANE_Z = { [BEFORE_PANE]: 398, [AFTER_PANE]: 399 } as const;

const GRIP = 44;
const GAP = 8;
const BIG = 100000;

interface Range {
  left: number;
  right: number;
  top: number;
  lineTop: number;
  lineBottom: number;
  gripY: number;
  labelLeft: number;
  labelRight: number;
}

export interface CompareDividerProps {
  bounds: L.LatLngBoundsExpression;
  beforeUrl: string;
  afterUrl: string;
  position: MutableRefObject<number>;
  beforeDate: string;
  afterDate: string;
  channel: string;
}

function shortDate(d: string): string {
  return d.replace(/\s+\d{4}$/, "");
}

function valueText(pct: number): string {
  return `${pct}% — before on the left, after on the right`;
}

function measure(container: HTMLElement, labelH: number): Range {
  const w = container.clientWidth;
  const h = container.clientHeight;
  const top = 12;
  let controlsW = 0;
  container.querySelectorAll<HTMLElement>(".leaflet-top.leaflet-right .leaflet-control").forEach((el) => {
    const y = el.offsetTop + ((el.offsetParent as HTMLElement | null)?.offsetTop ?? 0);
    if (y < top + labelH + GAP) controlsW = Math.max(controlsW, el.offsetWidth);
  });
  return {
    left: 0,
    right: w,
    top,
    lineTop: 0,
    lineBottom: h,
    gripY: h / 2 - GRIP / 2,
    labelLeft: 12,
    labelRight: 12 + controlsW + GAP,
  };
}

export default function CompareDivider({
  bounds,
  beforeUrl,
  afterUrl,
  position,
  beforeDate,
  afterDate,
  channel,
}: CompareDividerProps) {
  const map = useMap();
  const [panesReady, setPanesReady] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const gripRef = useRef<HTMLDivElement>(null);
  const beforeLabelRef = useRef<HTMLDivElement>(null);
  const afterLabelRef = useRef<HTMLDivElement>(null);
  const apply = useRef<() => void>(() => {});
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;

  useEffect(() => {
    for (const name of [BEFORE_PANE, AFTER_PANE] as const) {
      const pane = map.getPane(name) ?? map.createPane(name);
      pane.style.zIndex = String(PANE_Z[name]);
      pane.classList.add("vx-pane-compare");
    }
    setPanesReady(true);
    return () => {
      for (const name of [BEFORE_PANE, AFTER_PANE]) {
        const pane = map.getPane(name);
        if (pane) pane.style.clipPath = "";
      }
    };
  }, [map]);

  useEffect(() => {
    const container = map.getContainer();
    const root = rootRef.current;
    const line = lineRef.current;
    const grip = gripRef.current;
    const beforeLabel = beforeLabelRef.current;
    const afterLabel = afterLabelRef.current;
    if (!root || !line || !grip || !beforeLabel || !afterLabel) return;

    let range = measure(container, beforeLabel.offsetHeight);
    let width = container.clientWidth;
    let containerLeft = container.getBoundingClientRect().left;
    let beforeW = 0;
    let afterW = 0;
    let labelH = 0;
    const phoneMq = window.matchMedia("(max-width: 767px)");

    const render = () => {
      const frac = position.current;
      const x = range.left + frac * (range.right - range.left);
      line.style.transform = `translate3d(${x}px,0,0)`;
      grip.style.transform = `translate3d(${Math.min(Math.max(x - GRIP / 2, range.left), Math.max(range.right - GRIP, range.left))}px,0,0)`;

      const lx = map.containerPointToLayerPoint(L.point(x, 0)).x;
      const before = map.getPane(BEFORE_PANE);
      const after = map.getPane(AFTER_PANE);
      if (before) {
        before.style.clipPath = `polygon(${-BIG}px ${-BIG}px, ${lx}px ${-BIG}px, ${lx}px ${BIG}px, ${-BIG}px ${BIG}px)`;
      }
      if (after) {
        after.style.clipPath = `polygon(${lx}px ${-BIG}px, ${BIG}px ${-BIG}px, ${BIG}px ${BIG}px, ${lx}px ${BIG}px)`;
      }

      const beforeRight = range.labelLeft + beforeW;
      const afterLeft = width - range.labelRight - afterW;
      beforeLabel.dataset.off = String(frac <= 0 || x < beforeRight + GAP);
      afterLabel.dataset.off = String(frac >= 1 || x > afterLeft - GAP);

      let top = range.top;
      if (phoneMq.matches && labelH > 0) {
        const nw = map.latLngToContainerPoint(L.latLngBounds(boundsRef.current as L.LatLngBoundsLiteral).getNorthWest());
        top = Math.max(range.top, Math.min(nw.y - labelH - 4, range.lineBottom - labelH));
      }
      root.style.setProperty("--cmp-top", `${top}px`);

      const pct = Math.round(frac * 100);
      grip.setAttribute("aria-valuenow", String(pct));
      grip.setAttribute("aria-valuetext", valueText(pct));
    };

    const relayout = () => {
      beforeW = beforeLabel.offsetWidth;
      afterW = afterLabel.offsetWidth;
      labelH = beforeLabel.offsetHeight;
      range = measure(container, labelH);
      width = container.clientWidth;
      containerLeft = container.getBoundingClientRect().left;
      root.style.setProperty("--cmp-line-top", `${range.lineTop}px`);
      root.style.setProperty("--cmp-line-h", `${Math.max(0, range.lineBottom - range.lineTop)}px`);
      root.style.setProperty("--cmp-grip-y", `${range.gripY}px`);
      beforeLabel.style.left = `${range.labelLeft}px`;
      afterLabel.style.right = `${range.labelRight}px`;
      render();
    };
    apply.current = relayout;

    relayout();
    map.on("move viewreset resize zoomend", render);
    const stopObserving = observeSize(container, relayout);
    const raf = requestAnimationFrame(relayout);

    let dragging = false;
    let pointerId = -1;
    let grab = 0;
    let weDisabledPanning = false;

    const restorePanning = () => {
      if (weDisabledPanning) {
        weDisabledPanning = false;
        map.dragging.enable();
      }
    };
    const finish = () => {
      if (!dragging) return;
      dragging = false;
      if (moveRaf) cancelAnimationFrame(moveRaf);
      flush();
      restorePanning();
      delete grip.dataset.dragging;
    };
    let pendingX: number | null = null;
    let moveRaf = 0;
    const flush = () => {
      moveRaf = 0;
      if (pendingX === null) return;
      const span = range.right - range.left;
      const frac = span > 0 ? (pendingX - containerLeft - grab - range.left) / span : 0.5;
      pendingX = null;
      position.current = Math.min(1, Math.max(0, frac));
      render();
    };
    const setFromClientX = (clientX: number) => {
      pendingX = clientX;
      if (!moveRaf) moveRaf = requestAnimationFrame(flush);
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      e.preventDefault();
      e.stopPropagation();
      if (dragging) return;
      dragging = true;
      pointerId = e.pointerId;
      grip.setPointerCapture(e.pointerId);
      containerLeft = container.getBoundingClientRect().left;
      const lineX = range.left + position.current * (range.right - range.left);
      grab = Math.max(-GRIP / 2, Math.min(GRIP / 2, e.clientX - containerLeft - lineX));
      if (map.dragging.enabled()) {
        map.dragging.disable();
        weDisabledPanning = true;
      }
      grip.dataset.dragging = "true";
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== pointerId) return;
      if (e.pointerType === "mouse" && e.buttons === 0) {
        finish();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      setFromClientX(e.clientX);
    };
    const end = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== pointerId) return;
      e.stopPropagation();
      if (grip.hasPointerCapture(e.pointerId)) grip.releasePointerCapture(e.pointerId);
      finish();
    };
    const onLost = (e: PointerEvent) => {
      if (e.pointerId === pointerId) finish();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const step = e.shiftKey ? 0.1 : 0.01;
      let next: number | null = null;
      switch (e.key) {
        case "ArrowLeft":
        case "ArrowDown":
          next = position.current - step;
          break;
        case "ArrowRight":
        case "ArrowUp":
          next = position.current + step;
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = 1;
          break;
        default:
          return;
      }
      e.preventDefault();
      e.stopPropagation();
      position.current = Math.min(1, Math.max(0, Math.round(next * 1000) / 1000));
      render();
    };

    const stop = (e: Event) => e.stopPropagation();
    const stopTypes = ["mousedown", "mouseup", "mousemove", "click", "dblclick", "contextmenu", "touchstart", "wheel"];
    for (const t of stopTypes) grip.addEventListener(t, stop);
    grip.addEventListener("pointerdown", onDown);
    grip.addEventListener("pointermove", onMove);
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
    grip.addEventListener("lostpointercapture", onLost);
    grip.addEventListener("keydown", onKey);
    grip.addEventListener("keyup", stop);

    return () => {
      cancelAnimationFrame(raf);
      if (moveRaf) cancelAnimationFrame(moveRaf);
      map.off("move viewreset resize zoomend", render);
      stopObserving();
      for (const t of stopTypes) grip.removeEventListener(t, stop);
      grip.removeEventListener("pointerdown", onDown);
      grip.removeEventListener("pointermove", onMove);
      grip.removeEventListener("pointerup", end);
      grip.removeEventListener("pointercancel", end);
      grip.removeEventListener("lostpointercapture", onLost);
      grip.removeEventListener("keydown", onKey);
      grip.removeEventListener("keyup", stop);
      dragging = false;
      restorePanning();
      apply.current = () => {};
    };
  }, [map, position]);

  useEffect(() => {
    apply.current();
  }, [beforeDate, afterDate, channel, panesReady]);

  return (
    <>
      {panesReady && (
        <>
          <ImageOverlay url={beforeUrl} bounds={bounds} opacity={0.95} pane={BEFORE_PANE} />
          <ImageOverlay url={afterUrl} bounds={bounds} opacity={0.95} pane={AFTER_PANE} />
        </>
      )}
      <div ref={rootRef} className="vx-compare" data-vx-compare>
        <div ref={lineRef} className="vx-compare__line" aria-hidden />
        <Glass
          ref={beforeLabelRef}
          className="lg-panel lg-label vx-in-left vx-compare__label vx-compare__label--before absolute"
          aria-hidden
        >
          <span className="vx-eyebrow">Before</span>
          <span className="vx-mono vx-compare__date">
            <span className="vx-compare__sep"> · </span>
            <span className="vx-compare__short">{shortDate(beforeDate)}</span>
            <span className="vx-compare__full">{beforeDate}</span>
            <span className="vx-compare__utc"> UTC · {channel}</span>
          </span>
        </Glass>
        <Glass
          ref={afterLabelRef}
          className="lg-panel lg-label vx-in-right vx-compare__label vx-compare__label--after absolute"
          aria-hidden
        >
          <span className="vx-eyebrow">After</span>
          <span className="vx-mono vx-compare__date">
            <span className="vx-compare__sep"> · </span>
            <span className="vx-compare__short">{shortDate(afterDate)}</span>
            <span className="vx-compare__full">{afterDate}</span>
            <span className="vx-compare__utc"> UTC · {channel}</span>
          </span>
        </Glass>
        <Glass
          ref={gripRef}
          className="lg-panel vx-compare__grip absolute rounded-full"
          role="slider"
          tabIndex={0}
          aria-label={`Comparison divider: before ${beforeDate} UTC on the left, after ${afterDate} UTC on the right`}
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(position.current * 100)}
          aria-valuetext={valueText(Math.round(position.current * 100))}
        >
          <MoveHorizontal size={20} aria-hidden />
        </Glass>
      </div>
    </>
  );
}
