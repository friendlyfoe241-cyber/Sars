import type { RasterEncoding } from "./data";
import { MAX_DN_DELTA, changeColour, deltaScale } from "./changeDetection";

export interface Raster {
  width: number;
  height: number;
  red: Uint8ClampedArray;
}

function context2d(canvas: HTMLCanvasElement, readback = false): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", readback ? { willReadFrequently: true } : undefined);
  if (!ctx) throw new Error("2D canvas context unavailable");
  return ctx;
}

export async function decodeRaster(image: Blob): Promise<Raster> {
  const bitmap = await createImageBitmap(image);
  const { width, height } = bitmap;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = context2d(canvas, true);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const red = new Uint8ClampedArray(width * height);
  for (let i = 0, o = 0; i < red.length; i++, o += 4) red[i] = rgba[o];
  return { width, height, red };
}

export async function loadRaster(url: string, signal?: AbortSignal): Promise<Raster> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Could not load raster ${url} (HTTP ${res.status})`);
  return decodeRaster(await res.blob());
}

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

function opaque(r: number, g: number, b: number): number {
  return LITTLE_ENDIAN
    ? ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
    : ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0;
}

function pixelsToUrl(pixels: Uint32Array, width: number, height: number): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const bytes = new Uint8ClampedArray(pixels.buffer as ArrayBuffer);
  context2d(canvas).putImageData(new ImageData(bytes, width, height), 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(URL.createObjectURL(blob));
      else reject(new Error("Could not encode the overlay image"));
    }, "image/png");
  });
}

export function renderObservation(raster: Raster, encoding: RasterEncoding): Promise<string> {
  const { width, height, red } = raster;
  const lut = new Uint32Array(256);
  for (let dn = 0; dn < 256; dn++) lut[dn] = opaque(dn, dn, dn);
  lut[encoding.nodata] = 0;

  const pixels = new Uint32Array(width * height);
  for (let i = 0; i < pixels.length; i++) pixels[i] = lut[red[i]];
  return pixelsToUrl(pixels, width, height);
}

export function renderChange(
  before: Raster,
  after: Raster,
  encoding: RasterEncoding,
  saturation: number,
): Promise<string> {
  const { width, height } = after;
  const scale = deltaScale(encoding);
  const lut = new Uint32Array(2 * MAX_DN_DELTA + 1);
  for (let d = -MAX_DN_DELTA; d <= MAX_DN_DELTA; d++) {
    const [r, g, b] = changeColour(d * scale, saturation);
    lut[d + MAX_DN_DELTA] = opaque(r, g, b);
  }

  const nodata = encoding.nodata;
  const pixels = new Uint32Array(width * height);
  for (let i = 0; i < pixels.length; i++) {
    const b = before.red[i];
    const a = after.red[i];
    if (b !== nodata && a !== nodata) pixels[i] = lut[a - b + MAX_DN_DELTA];
  }
  return pixelsToUrl(pixels, width, height);
}
