import { useEffect, useRef } from "react";
import L from "leaflet";
import {
  MapContainer,
  TileLayer,
  Rectangle,
  Polygon,
  ImageOverlay,
  useMap,
  useMapEvent,
} from "react-leaflet";
import type { Aoi } from "../lib/aoi";
import type { NisarScene } from "../lib/discovery";
import type { ViewerDataset } from "../lib/data";
import { changeColour } from "../lib/changeDetection";

export type DisplayLayer = "before" | "after" | "change";

interface MapViewProps {
  aoi: Aoi | null;
  scenes: NisarScene[];
  selectedSceneId: string | null;
  onSelectScene: (id: string) => void;
  drawMode: boolean;
  onAoiDrawn: (aoi: Aoi) => void;
  onPickLocation: (lat: number, lon: number) => void;
  layer: DisplayLayer;
  pol: string;
  overlayUrl: string | null;
  viewer: ViewerDataset | null;
  /** bump to re-fit the map to the AOI */
  fitKey: number;
  /** limit drawn footprints for performance */
  maxFootprints?: number;
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
    map.fitBounds(boundsOf(aoi), { padding: [32, 32], maxZoom: 10 });
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
        { color: "#2563EB", weight: 1.5, dashArray: "4 3", fillOpacity: 0.05 },
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

function Legend({
  viewer,
  layer,
  pol,
}: {
  viewer: ViewerDataset;
  layer: DisplayLayer;
  pol: string;
}) {
  const saturation = viewer.changeScale.saturation;
  const unit = layer === "change" ? viewer.changeScale.unit : viewer.encoding.unit;

  return (
    <div className="absolute top-3 right-3 z-[500] w-[200px] rounded-[3px] border border-app-border bg-white px-3 py-2.5">
      <div className="text-[11px] font-semibold text-app-text">
        {layer === "change" ? "Backscatter change" : "Radar brightness"}
      </div>
      <div className="mt-0.5 text-[10px] text-app-muted">
        {layer === "change"
          ? `after − before · ${pol}`
          : `${pol} · ${viewer.layers[pol] ?? ""}`}
      </div>

      {layer === "change" ? (
        <>
          <div className="mt-2 flex h-2.5">
            {[-1, -2 / 3, -1 / 3, 0, 1 / 3, 2 / 3, 1].map((t, i) => (
              <div
                key={i}
                className="flex-1"
                style={{
                  backgroundColor: `rgb(${changeColour(t * saturation, saturation).join(",")})`,
                }}
              />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-app-muted">
            <span>−{saturation}</span>
            <span>0</span>
            <span>+{saturation}</span>
          </div>
          <div className="mt-0.5 text-[10px] text-app-muted">
            {unit} · decrease / increase
          </div>
        </>
      ) : (
        <>
          <div className="mt-2 flex h-2.5">
            {[8, 60, 112, 164, 216, 255].map((v) => (
              <div
                key={v}
                className="flex-1"
                style={{ backgroundColor: `rgb(${v},${v},${v})` }}
              />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-app-muted">
            <span>low</span>
            <span>high</span>
          </div>
          <div className="mt-0.5 text-[10px] text-app-muted">{unit}</div>
        </>
      )}
    </div>
  );
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

export default function MapView({
  aoi,
  scenes,
  selectedSceneId,
  onSelectScene,
  drawMode,
  onAoiDrawn,
  onPickLocation,
  layer,
  pol,
  overlayUrl,
  viewer,
  fitKey,
  maxFootprints = 200,
}: MapViewProps) {
  const shown = scenes.slice(0, maxFootprints);
  const aoiBounds = aoi ? boundsOf(aoi) : null;
  const drawGuard = useRef(0);

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={[20, 15]}
        zoom={2}
        minZoom={2}
        maxZoom={14}
        preferCanvas={true}
        zoomControl={true}
        attributionControl={true}
        className="h-full w-full"
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />

        {overlayUrl && aoiBounds && (
          <ImageOverlay
            key={overlayUrl}
            url={overlayUrl}
            bounds={aoiBounds}
            opacity={layer === "change" ? 0.9 : 0.95}
          />
        )}

        {/* footprints of actual catalogue results only */}
        {shown.map((scene) => {
          const selected = scene.id === selectedSceneId;
          if (scene.footprint.length < 3) return null;
          return (
            <Polygon
              key={scene.id}
              positions={scene.footprint.map(
                ([lon, lat]) => [lat, lon] as [number, number],
              )}
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e.originalEvent);
                  onSelectScene(scene.id);
                },
              }}
              pathOptions={{
                color: "#2563EB",
                weight: selected ? 2 : 1,
                opacity: selected ? 1 : 0.35,
                fillColor: "#2563EB",
                fill: selected,
                fillOpacity: selected ? 0.12 : 0,
              }}
            />
          );
        })}

        {aoiBounds && (
          <Rectangle
            bounds={aoiBounds}
            pathOptions={{
              color: "#2563EB",
              weight: 2,
              fill: true,
              fillColor: "#2563EB",
              fillOpacity: 0.03,
            }}
          />
        )}

        <ClickHandler enabled={!drawMode} onPick={onPickLocation} drawGuard={drawGuard} />
        <AoiDrawer enabled={drawMode} onAoiDrawn={onAoiDrawn} drawGuard={drawGuard} />
        <FitController aoi={aoi} fitKey={fitKey} />
        <ScaleBar />
      </MapContainer>
      {viewer && <Legend viewer={viewer} layer={layer} pol={pol} />}
      {drawMode && (
        <div className="absolute inset-x-0 top-3 z-[500] flex justify-center">
          <div className="rounded-[3px] border border-app-border bg-white px-3 py-1.5 text-[11px] text-app-text">
            Drag on the map to draw the area of interest
          </div>
        </div>
      )}
    </div>
  );
}
