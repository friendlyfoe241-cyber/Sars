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
  pickEnabled: boolean;
  display: DisplayMode;
  pol: string;
  saturation: number | null;
  urls: LayerUrls;
  pairInstance: number | null;
  rendering: boolean;
  fallbackUrl: string | null;
  overlayBounds: Aoi | null;
  viewer: ViewerDataset | null;
  fitKey: number;
  roleBefore: string | null;
  roleAfter: string | null;
  showAllFootprints: boolean;
  showLegend?: boolean;
  maxFootprints?: number;
}

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
    hiDpi?: boolean;
  }
> = {
  earth: {
    label: "Earth",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxNativeZoom: 19,
    attribution:
      "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    hiDpi: true,
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

const VX = { aoi: "#7CC4FF", selected: "#9D74F0", draw: "#9DB8FF", text: "#F2F4F7" } as const;

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
const AOI_STYLE: L.PathOptions = {
  color: VX.aoi,
  weight: 2,
  fill: true,
  fillColor: VX.aoi,
  fillOpacity: 0,
};

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
  const pairLoaded = viewer !== null;
  const shown = useMemo(() => {
    const drawable = scenes.slice(0, maxFootprints).filter((s) => s.footprint.length >= 3);
    if (!pairLoaded || showAllFootprints) return drawable;
    return drawable.filter(
      (s) => s.id === roleBefore || s.id === roleAfter || s.id === selectedSceneId,
    );
  }, [scenes, maxFootprints, pairLoaded, showAllFootprints, roleBefore, roleAfter, selectedSceneId]);
  const aoiBounds = useMemo(() => (aoi ? boundsOf(aoi) : null), [aoi]);
  const imageBounds = useMemo(
    () => (overlayBounds ? boundsOf(overlayBounds) : null),
    [overlayBounds],
  );
  const drawGuard = useRef(0);
  const [basemapId, setBasemapId] = useState<BasemapId>("earth");
  const basemap = BASEMAPS[basemapId];
  const hiDpi = !!basemap.hiDpi && L.Browser.retina;

  const dividerPosition = useRef(0.5);
  const lastPair = useRef<number | null>(pairInstance);
  if (lastPair.current !== pairInstance) {
    lastPair.current = pairInstance;
    dividerPosition.current = 0.5;
  }

  const compare = display.mode === "swipe";
  const layer: DisplayLayer | "compare" = display.mode === "single" ? display.layer : "compare";
  const overlayUrl = display.mode === "single" ? (urls[display.layer] ?? fallbackUrl) : null;
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
            <Pane
              key={basemapId}
              name="orbBasemap"
              className={`vx-pane-basemap vx-pane-basemap--${basemapId}`}
              style={{ zIndex: 200 }}
            >
              <TileLayer
                url={basemap.url}
                maxNativeZoom={hiDpi ? basemap.maxNativeZoom - 1 : basemap.maxNativeZoom}
                tileSize={hiDpi ? 128 : 256}
                zoomOffset={hiDpi ? 1 : 0}
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
