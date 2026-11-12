// Place-name geocoding with a small client-side cache and rate limiting.
// Uses the OpenStreetMap Nominatim service (public, CORS-enabled, usage
// policy: max 1 request/second).  Coordinate input is handled directly and
// never sent to the geocoder.

export interface GeocodeResult {
  displayName: string;
  lat: number;
  lon: number;
  bbox?: { west: number; south: number; east: number; north: number };
}

const cache = new Map<string, GeocodeResult | null>();
const MIN_INTERVAL_MS = 1100;
let lastRequestAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function geocodePlace(query: string): Promise<GeocodeResult | null> {
  const q = query.trim();
  if (q.length < 2) return null;
  const key = q.toLowerCase();
  if (cache.has(key)) return cache.get(key) ?? null;

  const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();

  const url =
    "https://nominatim.openstreetmap.org/search?" +
    new URLSearchParams({ q, format: "json", limit: "1" });
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Geocoding service returned ${res.status}.`);
  const rows = (await res.json()) as {
    display_name: string;
    lat: string;
    lon: string;
    boundingbox?: [string, string, string, string];
  }[];

  const result: GeocodeResult | null = rows.length
    ? {
        displayName: rows[0].display_name,
        lat: parseFloat(rows[0].lat),
        lon: parseFloat(rows[0].lon),
        bbox: rows[0].boundingbox
          ? {
              south: parseFloat(rows[0].boundingbox[0]),
              north: parseFloat(rows[0].boundingbox[1]),
              west: parseFloat(rows[0].boundingbox[2]),
              east: parseFloat(rows[0].boundingbox[3]),
            }
          : undefined,
      }
    : null;
  cache.set(key, result);
  return result;
}
