// Area-of-interest (AOI) handling: geographic rectangles used for catalogue
// searches and raster preparation.  All coordinates are WGS84 lon/lat.

export interface Aoi {
  west: number;
  south: number;
  east: number;
  north: number;
}

export const DEFAULT_AOI_SIZE_KM = 100;

export function aoiCenter(aoi: Aoi): [number, number] {
  return [(aoi.south + aoi.north) / 2, (aoi.west + aoi.east) / 2];
}

/** AOI of `sizeKm` width/height centred on a point. */
export function aoiFromCenter(lat: number, lon: number, sizeKm: number): Aoi {
  const dLat = sizeKm / 111.32 / 2;
  const dLon = sizeKm / (111.32 * Math.max(0.2, Math.cos((lat * Math.PI) / 180))) / 2;
  return clampAoi({
    west: lon - dLon,
    south: lat - dLat,
    east: lon + dLon,
    north: lat + dLat,
  });
}

export function clampAoi(aoi: Aoi): Aoi {
  const clampLat = (v: number) => Math.max(-85, Math.min(85, v));
  const wrapLon = (v: number) => {
    let x = v;
    while (x > 180) x -= 360;
    while (x < -180) x += 360;
    return x;
  };
  return {
    west: wrapLon(aoi.west),
    south: clampLat(aoi.south),
    east: wrapLon(aoi.east),
    north: clampLat(aoi.north),
  };
}

export function isValidAoi(aoi: Aoi): boolean {
  return (
    Number.isFinite(aoi.west) &&
    Number.isFinite(aoi.south) &&
    Number.isFinite(aoi.east) &&
    Number.isFinite(aoi.north) &&
    aoi.north > aoi.south &&
    aoi.east > aoi.west &&
    Math.abs(aoi.east - aoi.west) <= 30 &&
    aoi.north - aoi.south <= 30
  );
}

/** WKT polygon for catalogue queries (closed ring). */
export function aoiPolygon(aoi: Aoi): string {
  const { west: w, south: s, east: e, north: n } = aoi;
  return `POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))`;
}

/** Bounding box string "w,s,e,n" (CMR style). */
export function aoiBbox(aoi: Aoi): string {
  return `${aoi.west},${aoi.south},${aoi.east},${aoi.north}`;
}

export function aoiSizeKm(aoi: Aoi): { widthKm: number; heightKm: number } {
  const midLat = (aoi.south + aoi.north) / 2;
  return {
    widthKm:
      (aoi.east - aoi.west) * 111.32 * Math.max(0.2, Math.cos((midLat * Math.PI) / 180)),
    heightKm: (aoi.north - aoi.south) * 111.32,
  };
}

const DMS =
  /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/;

/**
 * Parse "lat, lon" or "lon, lat" text input.  Latitude-first is the common
 * convention; if the first value cannot be a latitude the order is swapped.
 */
export function parseCoordinates(text: string): [number, number] | null {
  const m = DMS.exec(text);
  if (!m) return null;
  const a = parseFloat(m[1]);
  const b = parseFloat(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return [a, b];
  if (Math.abs(b) <= 90 && Math.abs(a) <= 180) return [b, a];
  return null;
}

export function formatLatLon(lat: number, lon: number, digits = 4): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(digits)}°${ns}, ${Math.abs(lon).toFixed(digits)}°${ew}`;
}

export function formatAoi(aoi: Aoi): string {
  const { widthKm, heightKm } = aoiSizeKm(aoi);
  return `${formatLatLon((aoi.south + aoi.north) / 2, (aoi.west + aoi.east) / 2)} · ${widthKm.toFixed(0)} × ${heightKm.toFixed(0)} km`;
}
