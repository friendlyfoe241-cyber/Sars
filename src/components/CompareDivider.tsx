import { useEffect, useRef, useState, type MutableRefObject } from "react";
import L from "leaflet";
import { ImageOverlay, useMap } from "react-leaflet";
import { MoveHorizontal } from "lucide-react";
import { coveredInsets, observeLayout } from "../lib/freeArea";

/**
 * Draggable before / after comparison on the one Leaflet map.
 *
 * Both overlays sit on the same bounds, each in its own map pane.  The panes
 * are clipped with CSS `clip-path` at the divider: Before shows left of it,
 * After right of it.  The divider is fixed on screen, so the clip is
 * recomputed from its container x on every map move / zoom / resize (pane
 * coordinates shift while the map pans).  Position, clip, grip, labels and
 * ARIA values are all written straight to the DOM from refs: the divider
 * position is not React state and dragging re-renders nothing.
 */

const BEFORE_PANE = "orbCompareBefore";
const AFTER_PANE = "orbCompareAfter";
// Below Leaflet's overlay pane (400) so the AOI outline and footprints stay on
// top of the radar; above the basemap (200).
const PANE_Z = { [BEFORE_PANE]: 398, [AFTER_PANE]: 399 } as const;

const GRIP = 44;
const GAP = 8;
const BIG = 100000;

interface Range {
  left: number;
  right: number;
  /** container px; labels sit below this when the top bar overlaps the map */
  top: number;
  /** the divider line runs from here to `lineBottom` (free area, not under the panels) */
  lineTop: number;
  lineBottom: number;
  /** grip top: vertically centred in the free area */
  gripY: number;
  labelLeft: number;
  labelRight: number;
}

export interface CompareDividerProps {
  bounds: L.LatLngBoundsExpression;
  beforeUrl: string;
  afterUrl: string;
  /** divider position, 0..1 of the usable range; owned by the parent, not state */
  position: MutableRefObject<number>;
  beforeDate: string;
  afterDate: string;
  channel: string;
}

function valueText(pct: number): string {
  return `${pct}% — before on the left, after on the right`;
}

/** The part of the map not covered by the floating panels. */
function measure(container: HTMLElement): Range {
  const cr = container.getBoundingClientRect();
  const ins = coveredInsets(container, GAP);
  let left = ins.left ?? 0;
  let right = cr.width - (ins.right ?? 0);
  if (right - left < 160) {
    left = 0;
    right = cr.width;
  }
  const lineTop = ins.top ?? 0;
  const lineBottom = cr.height - (ins.bottom ?? 0);
  const anyPanel = ins.left !== null || ins.right !== null || ins.top !== null || ins.bottom !== null;
  // From 1024 the zoom and basemap controls sit at the top-right of the free
  // area: the After label stays clear of them.  Below, they are top-left.
  const desktop = window.matchMedia("(min-width: 1024px)").matches;
  let controlsW = 0;
  container.querySelectorAll<HTMLElement>(".leaflet-top.leaflet-left .leaflet-control").forEach((el) => {
    controlsW = Math.max(controlsW, el.offsetWidth);
  });
  return {
    left,
    right,
    top: Math.max(12, lineTop + (ins.top !== null ? 0 : 12)),
    lineTop,
    lineBottom,
    gripY: anyPanel ? (lineTop + lineBottom) / 2 - GRIP / 2 : cr.height * 0.72,
    // below 1024 Leaflet's zoom buttons sit top-left: keep the label clear of them
    labelLeft: ins.left !== null ? left + GAP : 12 + 44 + GAP,
    labelRight: cr.width - right + GAP + (desktop ? controlsW + GAP : 0),
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

  // Own panes for the two overlays (created once per map, reused).
  useEffect(() => {
    for (const name of [BEFORE_PANE, AFTER_PANE] as const) {
      const pane = map.getPane(name) ?? map.createPane(name);
      pane.style.zIndex = String(PANE_Z[name]);
      pane.classList.add("orb-pane-compare");
    }
    setPanesReady(true);
    return () => {
      for (const name of [BEFORE_PANE, AFTER_PANE]) {
        const pane = map.getPane(name);
        if (pane) pane.style.clipPath = "";
      }
    };
  }, [map]);

  // Layout, clip, drag and keyboard.  Everything below mutates the DOM
  // directly; nothing here sets React state.
  useEffect(() => {
    const container = map.getContainer();
    const root = rootRef.current;
    const line = lineRef.current;
    const grip = gripRef.current;
    const beforeLabel = beforeLabelRef.current;
    const afterLabel = afterLabelRef.current;
    if (!root || !line || !grip || !beforeLabel || !afterLabel) return;

    // Everything that needs layout is measured in relayout() and cached, so
    // render() only writes (no forced reflow per map move / pointermove).
    let range = measure(container);
    let width = container.clientWidth;
    let containerLeft = container.getBoundingClientRect().left;
    let beforeW = 0;
    let afterW = 0;

    const render = () => {
      const frac = position.current;
      const x = range.left + frac * (range.right - range.left);
      line.style.transform = `translate3d(${x}px,0,0)`;
      grip.style.transform = `translate3d(${Math.min(Math.max(x - GRIP / 2, range.left), Math.max(range.right - GRIP, range.left))}px,0,0)`;

      // Clip each pane at the divider.  Pane coordinates move with the map,
      // so convert the container x into layer space on every update.
      const lx = map.containerPointToLayerPoint(L.point(x, 0)).x;
      const before = map.getPane(BEFORE_PANE);
      const after = map.getPane(AFTER_PANE);
      if (before) {
        before.style.clipPath = `polygon(${-BIG}px ${-BIG}px, ${lx}px ${-BIG}px, ${lx}px ${BIG}px, ${-BIG}px ${BIG}px)`;
      }
      if (after) {
        after.style.clipPath = `polygon(${lx}px ${-BIG}px, ${BIG}px ${-BIG}px, ${BIG}px ${BIG}px, ${lx}px ${BIG}px)`;
      }

      // A label is hidden when its side is (nearly) gone, so text never
      // touches the divider.
      const beforeRight = range.labelLeft + beforeW;
      const afterLeft = width - range.labelRight - afterW;
      beforeLabel.dataset.off = String(frac <= 0 || x < beforeRight + GAP);
      afterLabel.dataset.off = String(frac >= 1 || x > afterLeft - GAP);

      const pct = Math.round(frac * 100);
      grip.setAttribute("aria-valuenow", String(pct));
      grip.setAttribute("aria-valuetext", valueText(pct));
    };

    const relayout = () => {
      range = measure(container);
      width = container.clientWidth;
      containerLeft = container.getBoundingClientRect().left;
      // labels are positioned by render(); their width does not depend on it
      beforeW = beforeLabel.offsetWidth;
      afterW = afterLabel.offsetWidth;
      root.style.setProperty("--cmp-top", `${range.top}px`);
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
    const stopObserving = observeLayout(container, relayout);
    // one more pass once the pane elements and first layout exist
    const raf = requestAnimationFrame(relayout);

    // ---- pointer drag ----
    let dragging = false;
    let pointerId = -1;
    let grab = 0;
    // True only while THIS component has disabled map panning.  Never
    // overwritten during a drag, so a second pointerdown cannot record the
    // already-disabled state as the one to restore.
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
      flush(); // apply the last pointer position
      restorePanning();
      delete grip.dataset.dragging;
    };
    // pointermove is coalesced to one update per animation frame
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
      if (dragging) return; // a drag is already active: keep its state
      dragging = true;
      pointerId = e.pointerId;
      grip.setPointerCapture(e.pointerId);
      containerLeft = container.getBoundingClientRect().left;
      const lineX = range.left + position.current * (range.right - range.left);
      // keep the grab point under the pointer; no jump to the pointer
      grab = Math.max(-GRIP / 2, Math.min(GRIP / 2, e.clientX - containerLeft - lineX));
      if (map.dragging.enabled()) {
        map.dragging.disable();
        weDisabledPanning = true;
      }
      grip.dataset.dragging = "true";
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== pointerId) return;
      // the button was released without us seeing pointerup
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

    // ---- keyboard ----
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
      // keep Leaflet's keyboard panning and page scrolling out of it
      e.preventDefault();
      e.stopPropagation();
      position.current = Math.min(1, Math.max(0, Math.round(next * 1000) / 1000));
      render();
    };

    // Leaflet listens for these on the map container: keep them from selecting
    // a location or starting an AOI draw.
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

  // A label's text (or the panes appearing) changes what has to be measured.
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
      <div ref={rootRef} className="orb-compare" data-orb-compare>
        <div ref={lineRef} className="orb-compare__line" aria-hidden />
        <div
          ref={beforeLabelRef}
          className="orb-compare__label orb-compare__label--before"
          aria-hidden
        >
          <span className="orb-eyebrow">Before</span>
          <span className="orb-mono orb-compare__date">
            {beforeDate}
            <span> UTC · {channel}</span>
          </span>
        </div>
        <div
          ref={afterLabelRef}
          className="orb-compare__label orb-compare__label--after"
          aria-hidden
        >
          <span className="orb-eyebrow">After</span>
          <span className="orb-mono orb-compare__date">
            {afterDate}
            <span> UTC · {channel}</span>
          </span>
        </div>
        <div
          ref={gripRef}
          className="orb-compare__grip"
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
        </div>
      </div>
    </>
  );
}
