import { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import L from "leaflet";
import {
  MapContainer,
  TileLayer,
  Pane,
  Rectangle,
  Polygon,
  ImageOverlay,
  useMap,
  useMapEvent,
} from "react-leaflet";
import type { Aoi } from "../lib/aoi";
import type { NisarScene } from "../lib/discovery";
import type { ViewerDataset } from "../lib/data";
import type { DisplayLayer, DisplayMode, LayerUrls } from "../lib/useChangeLayers";
import MapLegend from "./MapLegend";

interface MapViewProps {
  aoi: Aoi | null;
  scenes: NisarScene[];
  selectedSceneId: string | null;
  onSelectScene: (id: string) => void;
  drawMode: boolean;
  onAoiDrawn: (aoi: Aoi) => void;
  onPickLocation: (lat: number, lon: number) => void;
  display: DisplayMode;
  pol: string;
  /** change colour-scale saturation of `pol`; the legend describes this value */
  saturation: number | null;
  /** rendered overlays of the loaded pair and channel, by layer */
  urls: LayerUrls;
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
  /** limit drawn footprints for performance */
  maxFootprints?: number;
}

// Basemaps.  Both are keyless raster sources that send CORS headers.
//   Earth      NASA GIBS Blue Marble (default).  Native tiles stop at zoom 8;
//              deeper map zooms upscale them.  Dimmed for the dark theme by a
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
  }
> = {
  earth: {
    label: "Earth",
    url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg",
    maxNativeZoom: 8,
    attribution:
      '<a href="https://earthdata.nasa.gov/gibs">NASA EOSDIS GIBS</a> &middot; Blue Marble',
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
    const el = L.DomUtil.create("div", "leaflet-control orb-basemap-switch");
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
    return el;
  });
  useEffect(() => {
    const control = new L.Control({ position: "topleft" });
    control.onAdd = () => container;
    control.addTo(map);
    return () => {
      control.remove();
    };
  }, [map, container]);
  return createPortal(
    <div role="group" aria-label="Basemap">
      <div className="orb-eyebrow orb-basemap-switch__label">Basemap</div>
      <div className="orb-basemap-switch__buttons">
        {BASEMAP_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className="orb-basemap-switch__btn"
            aria-pressed={value === id}
            onClick={() => onChange(id)}
          >
            {BASEMAPS[id].label}
          </button>
        ))}
      </div>
    </div>,
    container,
  );
}

function boundsOf(aoi: Aoi): L.LatLngBoundsExpression {
  return [
    [aoi.south, aoi.west],
    [aoi.north, aoi.east],
  ];
}

/** Recentre the map when the AOI changes or a search completes. */
function FitController({ aoi, fitKey }: { aoi: Aoi | null; fitKey: number }) {
  const map = useMap();
  useEffect(() => {
    if (!aoi) return;
    // Keep the AOI clear of the floating panels: the shell publishes the
    // per-breakpoint insets as CSS custom properties.
    const shell = map.getContainer().closest(".orb-shell");
    const cs = shell ? getComputedStyle(shell) : null;
    const inset = (name: string) => Number.parseFloat(cs?.getPropertyValue(name) ?? "") || 12;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    map.fitBounds(boundsOf(aoi), {
      paddingTopLeft: [inset("--orb-fit-left"), inset("--orb-fit-top")],
      paddingBottomRight: [inset("--orb-fit-right"), inset("--orb-fit-bottom")],
      maxZoom: 10,
      animate: !reduceMotion,
      duration: 0.45,
    });
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
        { color: ORBITAL.accent, weight: 2, dashArray: "4 3", fill: false },
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
      position: "bottomleft",
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
// ORBITAL tokens in styles/orbital.css: --orb-accent, --orb-focus, --orb-text.
const ORBITAL = { accent: "#FF6A00", focus: "#8DDCFF", text: "#F5F7FA" } as const;

// Quiet, thin catalogue footprints; the selected one reads in the focus cyan.
const FOOTPRINT_STYLE: L.PathOptions = {
  color: ORBITAL.text,
  weight: 1,
  opacity: 0.2,
  fill: false,
  fillOpacity: 0,
};
const FOOTPRINT_SELECTED_STYLE: L.PathOptions = {
  color: ORBITAL.focus,
  weight: 1.5,
  opacity: 0.95,
  fill: true,
  fillColor: ORBITAL.focus,
  fillOpacity: 0.06,
};
// Selected AOI: orange outline, no visible fill over the data (the invisible
// fill keeps clicks inside the rectangle behaving as before).
const AOI_STYLE: L.PathOptions = {
  color: ORBITAL.accent,
  weight: 2,
  fill: true,
  fillColor: ORBITAL.accent,
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
  display,
  pol,
  saturation,
  urls,
  fallbackUrl,
  overlayBounds,
  viewer,
  fitKey,
  roleBefore,
  roleAfter,
  showAllFootprints,
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

  // "swipe" is reserved for the divider and draws no overlay yet; its legend
  // follows the right-hand layer.
  const layer: DisplayLayer = display.mode === "single" ? display.layer : display.right;
  const overlayUrl = display.mode === "single" ? (urls[display.layer] ?? fallbackUrl) : null;

  return (
    <div className="orb-map">
      <MapContainer
        center={[20, 15]}
        zoom={2}
        minZoom={2}
        maxZoom={14}
        preferCanvas={true}
        zoomControl={true}
        attributionControl={true}
        className="orb-leaflet"
      >
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
              className={`orb-pane-basemap orb-pane-basemap--${basemapId}`}
              style={{ zIndex: 200 }}
            >
              <TileLayer
                url={basemap.url}
                maxNativeZoom={basemap.maxNativeZoom}
                maxZoom={14}
                attribution={basemap.attribution}
              />
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

        <ClickHandler enabled={!drawMode} onPick={onPickLocation} drawGuard={drawGuard} />
        <AoiDrawer enabled={drawMode} onAoiDrawn={onAoiDrawn} drawGuard={drawGuard} />
        <FitController aoi={aoi} fitKey={fitKey} />
        <ScaleBar />
        {!CUSTOM_BASEMAP_URL && <BasemapControl value={basemapId} onChange={setBasemapId} />}
      </MapContainer>
      {viewer && <MapLegend viewer={viewer} layer={layer} pol={pol} saturation={saturation} />}
      {drawMode && (
        <div className="orb-panel orb-panel--glass orb-hint" role="status">
          Drag on the map to draw the area of interest
        </div>
      )}
    </div>
  );
}

export default memo(MapView);
