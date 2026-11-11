// Canvas-based raster I/O: load prepared greyscale PNGs and render display
// overlays (greyscale observations, diverging change layer) as data URLs for
// Leaflet image overlays.  Nodata pixels are rendered fully transparent.

import type { RasterEncoding } from "./data";
import { changeColour } from "./changeDetection";

export interface Raster {
  width: number;
  height: number;
  /** red channel of the source greyscale PNG */
  red: Uint8ClampedArray;
}

export async function loadRaster(url: string): Promise<Raster> {
  const img = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const red = new Uint8ClampedArray(canvas.width * canvas.height);
  for (let i = 0; i < red.length; i++) red[i] = data.data[i * 4];
  return { width: canvas.width, height: canvas.height, red };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load raster ${url}`));
    img.src = url;
  });
}

/** Greyscale rendering of an observation; nodata pixels are transparent. */
export function renderObservation(raster: Raster, encoding: RasterEncoding): string {
  const { width, height, red } = raster;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  const img = ctx.createImageData(width, height);
  for (let i = 0; i < red.length; i++) {
    const dn = red[i];
    const o = i * 4;
    if (dn === encoding.nodata) {
      img.data[o + 3] = 0;
      continue;
    }
    // In both encodings the stored DN is already the display greyscale
    // value (quicklook rendering, or the linear dB->DN map built at prep time).
    const v = dn;
    img.data[o] = v;
    img.data[o + 1] = v;
    img.data[o + 2] = v;
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

/** Diverging rendering of the change layer; nodata pixels are transparent. */
export function renderChange(
  before: Raster,
  after: Raster,
  encoding: RasterEncoding,
  saturation: number,
): string {
  const { width, height } = after;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  const img = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const b = before.red[i];
    const a = after.red[i];
    const o = i * 4;
    if (b === encoding.nodata || a === encoding.nodata) {
      img.data[o + 3] = 0;
      continue;
    }
    const delta = encoding.type === "quicklook_dn" ? a - b : ((a - b) / 254) * ((encoding.dbMax ?? 5) - (encoding.dbMin ?? -30));
    const [r, g, bl] = changeColour(delta, saturation);
    img.data[o] = r;
    img.data[o + 1] = g;
    img.data[o + 2] = bl;
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}
