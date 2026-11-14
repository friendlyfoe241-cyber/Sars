import { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Layers } from "lucide-react";
import L from "leaflet";
import {
  MapContainer,
  TileLayer,
  Pane,
  Rectangle,
  Polygon,
  ImageOverlay,
  ZoomControl,
  useMap,
  useMapEvent,
} from "react-leaflet";
import type { Aoi } from "../lib/aoi";
import type { NisarScene } from "../lib/discovery";
import type { ViewerDataset } from "../lib/data";
import type { DisplayLayer, DisplayMode, LayerUrls } from "../lib/useChangeLayers";
import { formatDate } from "../lib/data";
import { FIT_PADDING, observeSize } from "../lib/freeArea";
import MapLegend from "./MapLegend";
import CompareDivider from "./CompareDivider";
import { Spinner } from "./ui";
import Glass from "./glass/Glass";

interface MapViewProps {
  aoi: Aoi | null;
  scenes: NisarScene[];
  selectedSceneId: string | null;
  onSelectScene: (id: string) => void;
  drawMode: boolean;
  onAoiDrawn: (aoi: Aoi) => void;
  onPickLocation: (lat: number, lon: number) => void;
  /** a map click picks a location only where that makes sense (Locate) */
  pickEnabled: boolean;
  display: DisplayMode;
  pol: string;
  /** change colour-scale saturation of `pol`; the legend describes this value */
  saturation: number | null;
  /** rendered overlays of the loaded pair and channel, by layer */
  urls: LayerUrls;
  /** identity of the loaded pair build (null: none); a change resets the divider */
  pairInstance: number | null;
  /** true while a requested layer of the loaded pair is still being rendered */
  rendering: boolean;
  /** previous overlay of the same pair and channel while `urls` lacks the requested layer */
  fallbackUrl: string | null;
  /** grid bounds of the loaded pair (the AOI it was prepared for) */
  overlayBounds: Aoi | null;
  viewer: ViewerDataset | null;
  /** bump to re-fit the map to the AOI */
  fitKey: number;
  /** before / after scene ids of the loaded pair (footprints kept visible) */
  roleBefore: string | null;
  roleAfter: string | null;
  /** with a pair loaded: also draw the non-selected catalogue footprints */
  showAllFootprints: boolean;
  /** draw the legend over the map (false: the page shows it inline) */
  showLegend?: boolean;
  /** limit drawn footprints for performance */
  maxFootprints?: number;
}

// Basemaps.  Both are keyless raster sources that send CORS headers.
//   Earth      NASA GIBS Blue Marble (default).  Native tiles stop at zoom 8;
//              from zoom 9 Esri World Imagery is drawn on top, with Blue
//              Marble left underneath as an upscaled fallback while those
//              tiles load.  Dimmed for the dark theme by a
//              CSS filter on its own pane only (see leaflet.css), so the radar
//              overlay is never filtered.
//   Reference  Esri World Dark Gray base plus its reference-label layer.
// VITE_BASEMAP_URL / VITE_BASEMAP_ATTRIBUTION replace the whole choice with a
// single custom tile source (not filtered; pass tiles that are already dark).
const CUSTOM_BASEMAP_URL: string = import.meta.env.VITE_BASEMAP_URL || "";
const CUSTOM_BASEMAP_ATTRIBUTION: string = import.meta.env.VITE_BASEMAP_ATTRIBUTION || "";

type BasemapId = "earth" | "reference";

const BASEMAPS: Record<
  BasemapId,
  {
    label: string;
    url: string;
    maxNativeZoom: number;
    attribution: string;
    labelsUrl?: string;
    /** higher-resolution layer drawn on top from `minZoom` up; the base layer
     *  stays underneath (upscaled) so nothing goes blank while it loads */
    detail?: { url: string; minZoom: number; attribution: string };
  }
> = {
  earth: {
    label: "Earth",
    url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg",
    maxNativeZoom: 8,
    attribution:
      '<a href="https://earthdata.nasa.gov/gibs">NASA EOSDIS GIBS</a> &middot; Blue Marble',
    // Blue Marble is ~500 m/px; past its native zoom switch to Esri imagery.
    detail: {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      minZoom: 9,
      attribution:
        "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    },
  },
  reference: {
    label: "Reference",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    labelsUrl:
      "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
    maxNativeZoom: 16,
    attribution: "Esri, HERE, Garmin, &copy; OpenStreetMap contributors, and the GIS user community",
  },
};

const BASEMAP_IDS: BasemapId[] = ["earth", "reference"];

/** A basemap's detail layer, mounted only at zoom >= minZoom so its tiles are
 *  never requested, and its attribution never shown, below that zoom. */
function DetailTileLayer({ url, minZoom, attribution }: { url: string; minZoom: number; attribution: string }) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvent("zoomend", () => setZoom(map.getZoom()));
  if (zoom < minZoom) return null;
  return <TileLayer url={url} minZoom={minZoom} maxZoom={14} attribution={attribution} />;
}

/** Labelled Earth / Reference switch, placed under Leaflet's zoom buttons. */
function BasemapControl({
  value,
  onChange,
}: {
  value: BasemapId;
  onChange: (id: BasemapId) => void;
}) {
  const map = useMap();
  const [container] = useState(() => {
    const el = L.DomUtil.create("div", "leaflet-control");
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
    return el;
  });
  useEffect(() => {
    const control = new L.Control({ position: "topright" });
    control.onAdd = () => container;
    control.addTo(map);
    return () => {
      control.remove();
    };
  }, [map, container]);
  // Phones: the map stage is short, so the switch collapses to a single 44px
  // icon button that flips between the two basemaps.
  const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 767px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const on = () => setCompact(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  if (compact) {
    const other = BASEMAP_IDS.find((id) => id !== value) ?? value;
    return createPortal(
      <Glass className="lg-panel vx-basemap-switch vx-basemap-switch--compact">
        <button
          type="button"
          className="vx-basemap-switch__icon"
          aria-label={`Basemap: ${BASEMAPS[value].label}. Switch to ${BASEMAPS[other].label}`}
          title={`Basemap: ${BASEMAPS[value].label} (tap for ${BASEMAPS[other].label})`}
          onClick={() => onChange(other)}
        >
          <Layers size={20} aria-hidden="true" />
        </button>
      </Glass>,
      container,
    );
  }
  return createPortal(
    <Glass className="lg-panel vx-basemap-switch">
      <div role="group" aria-label="Basemap">
        <div className="vx-eyebrow vx-basemap-switch__label">Basemap</div>
        <div className="vx-basemap-switch__buttons">
          {BASEMAP_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className="vx-basemap-switch__btn"
              aria-pressed={value === id}
              onClick={() => onChange(id)}
            >
              {BASEMAPS[id].label}
            </button>
          ))}
        </div>
      </div>
    </Glass>,
    container,
  );
}

function boundsOf(aoi: Aoi): L.LatLngBoundsExpression {
  return [
    [aoi.south, aoi.west],
    [aoi.north, aoi.east],
  ];
}

/**
 * Fit the AOI into the map stage (a small constant padding inside it), and
 * keep Leaflet's size in step with the stage: Leaflet does not watch its
 * container, and the stage changes box when the step page changes.
 *
 *  - `fitKey` (new AOI, Fit button): always fits.
 *  - the stage changed size: the map keeps its centre and refits only if
 *    the user has not moved it since the last automatic fit, so a manual pan
 *    or zoom is never thrown away.
 */
function FitController({ aoi, fitKey }: { aoi: Aoi | null; fitKey: number }) {
  const map = useMap();
  const aoiRef = useRef(aoi);
  aoiRef.current = aoi;
  const userMoved = useRef(false);
  const programmatic = useRef(false);
  const guardTimer = useRef(0);

  const fit = useRef((): void => {});
  fit.current = () => {
    const target = aoiRef.current;
    if (!target) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    programmatic.current = true;
    window.clearTimeout(guardTimer.current);
    // moveend normally clears the flag; the timer covers a fit that moves nothing
    guardTimer.current = window.setTimeout(() => {
      programmatic.current = false;
    }, 900);
    userMoved.current = false;
    map.fitBounds(boundsOf(target), {
      padding: [FIT_PADDING, FIT_PADDING],
      maxZoom: 10,
      animate: !reduceMotion,
      duration: 0.45,
    });
  };

  // A move or zoom the app did not start is the user's.
  useEffect(() => {
    const onStart = () => {
      if (!programmatic.current) userMoved.current = true;
    };
    const onEnd = () => {
      programmatic.current = false;
    };
    map.on("movestart zoomstart", onStart);
    map.on("moveend zoomend", onEnd);
    return () => {
      map.off("movestart zoomstart", onStart);
      map.off("moveend zoomend", onEnd);
      window.clearTimeout(guardTimer.current);
    };
  }, [map]);

  // The stage changed box (rAF-coalesced): resize Leaflet, keeping its centre.
  useEffect(() => {
    const container = map.getContainer();
    let w = container.clientWidth;
    let h = container.clientHeight;
    return observeSize(container, () => {
      const nw = container.clientWidth;
      const nh = container.clientHeight;
      if (nw === w && nh === h) return;
      w = nw;
      h = nh;
      map.invalidateSize();
      if (!userMoved.current && nw > 0 && nh > 0) fit.current();
    });
  }, [map]);

  useEffect(() => {
    map.invalidateSize();
    if (aoiRef.current) fit.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  return null;
}

/** Click on the map selects a location (skipped while drawing an AOI and
 * right after a completed draw, whose trailing click must not move the AOI). */
function ClickHandler({
  enabled,
  onPick,
  drawGuard,
}: {
  enabled: boolean;
  onPick: (lat: number, lon: number) => void;
  drawGuard: { current: number };
}) {
  useMapEvent("click", (e) => {
    if (!enabled || Date.now() < drawGuard.current) return;
    onPick(e.latlng.lat, e.latlng.lng);
  });
  return null;
}

/** Drag-to-draw rectangle AOI; temporarily disables map panning. */
function AoiDrawer({
  enabled,
  onAoiDrawn,
  drawGuard,
}: {
  enabled: boolean;
  onAoiDrawn: (aoi: Aoi) => void;
  drawGuard: { current: number };
}) {
  const map = useMap();
  const rectRef = useRef<L.Rectangle | null>(null);

  useEffect(() => {
    if (!enabled) return;
    map.dragging.disable();
    let start: L.LatLng | null = null;

    const onMouseDown = (e: L.LeafletMouseEvent) => {
      start = e.latlng;
      rectRef.current = L.rectangle(
        L.latLngBounds(start, start),
        { color: VX.draw, weight: 2, dashArray: "4 3", fill: false },
      ).addTo(map);
    };
    const onMouseMove = (e: L.LeafletMouseEvent) => {
      if (!start || !rectRef.current) return;
      rectRef.current.setBounds(L.latLngBounds(start, e.latlng));
    };
    const onMouseUp = (e: L.LeafletMouseEvent) => {
      if (start) {
        const b = L.latLngBounds(start, e.latlng);
        if (b.getSouth() !== b.getNorth() && b.getWest() !== b.getEast()) {
          drawGuard.current = Date.now() + 800;
          onAoiDrawn({
            west: b.getWest(),
            south: b.getSouth(),
            east: b.getEast(),
            north: b.getNorth(),
          });
        }
      }
      rectRef.current?.remove();
      rectRef.current = null;
      start = null;
    };

    map.on("mousedown", onMouseDown);
    map.on("mousemove", onMouseMove);
    map.on("mouseup", onMouseUp);
    return () => {
      map.off("mousedown", onMouseDown);
      map.off("mousemove", onMouseMove);
      map.off("mouseup", onMouseUp);
      rectRef.current?.remove();
      rectRef.current = null;
      map.dragging.enable();
    };
  }, [enabled, map, onAoiDrawn]);

  return null;
}

function ScaleBar() {
  const map = useMap();
  useEffect(() => {
    const control = L.control.scale({
      position: "bottomright",
      metric: true,
      imperial: false,
    });
    control.addTo(map);
    return () => {
      control.remove();
    };
  }, [map]);
  return null;
}

// Leaflet paths take literal colours (canvas renderer), so these mirror the
// Vortex tokens in styles/vortex.css: cyan, violet, text accent, text.
const VX = { aoi: "#7CC4FF", selected: "#9D74F0", draw: "#9DB8FF", text: "#F2F4F7" } as const;

// Quiet, thin catalogue footprints; the selected one reads in violet.
const FOOTPRINT_STYLE: L.PathOptions = {
  color: VX.text,
  weight: 1,
  opacity: 0.2,
  fill: false,
  fillOpacity: 0,
};
const FOOTPRINT_SELECTED_STYLE: L.PathOptions = {
  color: VX.selected,
  weight: 1.5,
  opacity: 0.95,
  fill: true,
  fillColor: VX.selected,
  fillOpacity: 0.06,
};
// Selected AOI: cyan outline, no visible fill over the data (the invisible
// fill keeps clicks inside the rectangle behaving as before).
const AOI_STYLE: L.PathOptions = {
  color: VX.aoi,
  weight: 2,
  fill: true,
  fillColor: VX.aoi,
  fillOpacity: 0,
};

/**
 * One catalogue footprint.  Memoised with stable positions, style and
 * handlers so that selecting a scene only touches the two polygons whose
 * state changed instead of re-projecting every footprint on the map.
 */
const Footprint = memo(function Footprint({
  scene,
  selected,
  onSelect,
}: {
  scene: NisarScene;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const positions = useMemo(
    () => scene.footprint.map(([lon, lat]) => [lat, lon] as [number, number]),
    [scene.footprint],
  );
  const eventHandlers = useMemo<L.LeafletEventHandlerFnMap>(
    () => ({
      click: (e) => {
        L.DomEvent.stopPropagation(e.originalEvent);
        onSelect(scene.id);
      },
    }),
    [scene.id, onSelect],
  );
  return (
    <Polygon
      positions={positions}
      eventHandlers={eventHandlers}
      pathOptions={selected ? FOOTPRINT_SELECTED_STYLE : FOOTPRINT_STYLE}
    />
  );
});

function MapView({
  aoi,
  scenes,
  selectedSceneId,
  onSelectScene,
  drawMode,
  onAoiDrawn,
  onPickLocation,
  pickEnabled,
  display,
  pol,
  saturation,
  urls,
  pairInstance,
  rendering,
  fallbackUrl,
  overlayBounds,
  viewer,
  fitKey,
  roleBefore,
  roleAfter,
  showAllFootprints,
  showLegend = true,
  maxFootprints = 200,
}: MapViewProps) {
  // Once a pair is loaded only the selected footprints stay (quiet map);
  // a labelled toggle in Compare restores the rest.
  const pairLoaded = viewer !== null;
  const shown = useMemo(() => {
    const drawable = scenes.slice(0, maxFootprints).filter((s) => s.footprint.length >= 3);
    if (!pairLoaded || showAllFootprints) return drawable;
    return drawable.filter(
      (s) => s.id === roleBefore || s.id === roleAfter || s.id === selectedSceneId,
    );
  }, [scenes, maxFootprints, pairLoaded, showAllFootprints, roleBefore, roleAfter, selectedSceneId]);
  // Stable bounds objects: react-leaflet re-applies bounds whenever the prop
  // identity changes.
  const aoiBounds = useMemo(() => (aoi ? boundsOf(aoi) : null), [aoi]);
  const imageBounds = useMemo(
    () => (overlayBounds ? boundsOf(overlayBounds) : null),
    [overlayBounds],
  );
  const drawGuard = useRef(0);
  const [basemapId, setBasemapId] = useState<BasemapId>("earth");
  const basemap = BASEMAPS[basemapId];

  // Divider position (0..1 of the usable map width) is a ref owned here and
  // written by CompareDivider's DOM code: dragging never re-renders anything.
  // It survives channel and layer switches and resets for a new pair or area.
  const dividerPosition = useRef(0.5);
  const lastPair = useRef<number | null>(pairInstance);
  if (lastPair.current !== pairInstance) {
    lastPair.current = pairInstance;
    dividerPosition.current = 0.5;
  }

  const compare = display.mode === "swipe";
  const layer: DisplayLayer | "compare" = display.mode === "single" ? display.layer : "compare";
  const overlayUrl = display.mode === "single" ? (urls[display.layer] ?? fallbackUrl) : null;
  // Compare needs both layers; while either renders show the loading state
  // instead of half a comparison.
  const compareReady = compare && imageBounds !== null && !!urls[display.left] && !!urls[display.right];
  const beforeDate = viewer ? formatDate(viewer.earlier.startTime) : "";
  const afterDate = viewer ? formatDate(viewer.later.startTime) : "";

  return (
    <div className="vx-map">
      <MapContainer
        center={[20, 15]}
        zoom={2}
        minZoom={2}
        maxZoom={14}
        preferCanvas={true}
        zoomControl={false}
        attributionControl={true}
        className="vx-leaflet"
      >
        <ZoomControl position="topright" />
        {CUSTOM_BASEMAP_URL ? (
          <Pane name="orbBasemap" style={{ zIndex: 200 }}>
            <TileLayer
              url={CUSTOM_BASEMAP_URL}
              subdomains="abcd"
              maxZoom={20}
              attribution={CUSTOM_BASEMAP_ATTRIBUTION}
            />
          </Pane>
        ) : (
          <>
            {/* own pane: the dimming filter in leaflet.css targets it alone */}
            <Pane
              key={basemapId}
              name="orbBasemap"
              className={`vx-pane-basemap vx-pane-basemap--${basemapId}`}
              style={{ zIndex: 200 }}
            >
              <TileLayer
                url={basemap.url}
                maxNativeZoom={basemap.maxNativeZoom}
                maxZoom={14}
                attribution={basemap.attribution}
              />
              {basemap.detail && <DetailTileLayer {...basemap.detail} />}
            </Pane>
            {basemap.labelsUrl && (
              <Pane key={`${basemapId}-labels`} name="orbLabels" style={{ zIndex: 450 }}>
                <TileLayer
                  url={basemap.labelsUrl}
                  maxNativeZoom={basemap.maxNativeZoom}
                  maxZoom={14}
                />
              </Pane>
            )}
          </>
        )}

        {compareReady && imageBounds && display.mode === "swipe" && (
          <CompareDivider
            bounds={imageBounds}
            beforeUrl={urls[display.left]!}
            afterUrl={urls[display.right]!}
            position={dividerPosition}
            beforeDate={beforeDate}
            afterDate={afterDate}
            channel={pol}
          />
        )}

        {overlayUrl && imageBounds && (
          <ImageOverlay
            url={overlayUrl}
            bounds={imageBounds}
            opacity={layer === "change" ? 0.9 : 0.95}
          />
        )}

        {/* footprints of actual catalogue results only */}
        {shown.map((scene) => (
          <Footprint
            key={scene.id}
            scene={scene}
            selected={scene.id === selectedSceneId}
            onSelect={onSelectScene}
          />
        ))}

        {aoiBounds && <Rectangle bounds={aoiBounds} pathOptions={AOI_STYLE} />}

        <ClickHandler enabled={pickEnabled && !drawMode} onPick={onPickLocation} drawGuard={drawGuard} />
        <AoiDrawer enabled={drawMode} onAoiDrawn={onAoiDrawn} drawGuard={drawGuard} />
        <FitController aoi={aoi} fitKey={fitKey} />
        <ScaleBar />
        {!CUSTOM_BASEMAP_URL && <BasemapControl value={basemapId} onChange={setBasemapId} />}
      </MapContainer>
      {compare && viewer && !compareReady && rendering && (
        <Glass className="lg-panel vx-hint" role="status">
          <Spinner /> Rendering Before and After…
        </Glass>
      )}
      {viewer && showLegend && (
        <MapLegend viewer={viewer} layer={layer} pol={pol} saturation={saturation} />
      )}
      {drawMode && (
        <Glass className="lg-panel vx-hint" role="status">
          Drag on the map to draw the area of interest
        </Glass>
      )}
    </div>
  );
}

export default memo(MapView);
