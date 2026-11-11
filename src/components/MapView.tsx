import { useEffect } from "react";
import L from "leaflet";
import {
  MapContainer,
  TileLayer,
  Polygon,
  ImageOverlay,
  useMap,
} from "react-leaflet";
import type { Manifest } from "../lib/data";
import { changeColour } from "../lib/changeDetection";

export type DisplayLayer = "before" | "after" | "change";

interface MapViewProps {
  manifest: Manifest;
  layer: DisplayLayer;
  pol: string;
  overlayUrl: string | null;
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

function Legend({
  manifest,
  layer,
  pol,
}: {
  manifest: Manifest;
  layer: DisplayLayer;
  pol: string;
}) {
  const saturation = manifest.changeScale.saturation;
  const unit = layer === "change" ? manifest.changeScale.unit : manifest.encoding.unit;

  return (
    <div className="absolute top-3 right-3 z-[500] w-[200px] rounded-[3px] border border-app-border bg-white px-3 py-2.5">
      <div className="text-[11px] font-semibold text-app-text">
        {layer === "change" ? "Backscatter change" : "Radar brightness"}
      </div>
      <div className="mt-0.5 text-[10px] text-app-muted">
        {layer === "change"
          ? `after − before · ${pol}`
          : `${pol} · ${manifest.rasters[pol]?.layer ?? ""}`}
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

export default function MapView({ manifest, layer, pol, overlayUrl }: MapViewProps) {
  const { bounds, boundary } = manifest.studyArea;
  const imageBounds: L.LatLngBoundsExpression = [
    [bounds.south, bounds.west],
    [bounds.north, bounds.east],
  ];
  const positions = boundary.map(
    ([lon, lat]) => [lat, lon] as [number, number],
  );

  return (
    <div className="relative h-full w-full">
      <MapContainer
        bounds={imageBounds}
        boundsOptions={{ padding: [16, 16] }}
        zoomControl={true}
        attributionControl={true}
        className="h-full w-full"
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        {overlayUrl && (
          <ImageOverlay
            key={overlayUrl}
            url={overlayUrl}
            bounds={imageBounds}
            opacity={layer === "change" ? 0.9 : 0.95}
          />
        )}
        <Polygon
          positions={positions}
          pathOptions={{
            color: "#2563EB",
            weight: 1.5,
            fill: false,
            opacity: 0.9,
          }}
        />
        <ScaleBar />
      </MapContainer>
      <Legend manifest={manifest} layer={layer} pol={pol} />
    </div>
  );
}
