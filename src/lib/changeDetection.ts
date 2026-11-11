// Deterministic change-detection maths.  No DOM access and no state: given
// the same inputs these functions always return the same outputs, so results
// are reproducible and testable independently of the UI.
//
// Values are handled in the unit declared by the dataset manifest
// ("display DN" for quicklook rasters, "dB" for calibrated ones).  Missing
// observations (nodata / outside the footprint) are NaN and are excluded
// from every statistic.

import type { RasterEncoding } from "./data";

/** Decode one channel of a greyscale raster (red byte of the canvas data) into unit values. */
export function decodeValues(
  redBytes: Uint8ClampedArray,
  encoding: RasterEncoding,
): Float32Array {
  const out = new Float32Array(redBytes.length);
  const nodata = encoding.nodata;
  if (encoding.type === "quicklook_dn") {
    for (let i = 0; i < redBytes.length; i++) {
      out[i] = redBytes[i] === nodata ? NaN : redBytes[i];
    }
  } else {
    const { dbMin, dbMax } = encoding;
    if (dbMin === undefined || dbMax === undefined) {
      throw new Error("db_linear encoding requires dbMin and dbMax");
    }
    for (let i = 0; i < redBytes.length; i++) {
      const dn = redBytes[i];
      out[i] = dn === nodata ? NaN : dbMin + ((dn - 1) / 254) * (dbMax - dbMin);
    }
  }
  return out;
}

/** Pixel-level difference (after - before) in dataset units; NaN where either side is missing. */
export function computeDifference(
  before: Float32Array,
  after: Float32Array,
): Float32Array {
  if (before.length !== after.length) {
    throw new Error("before/after rasters have different sizes");
  }
  const out = new Float32Array(before.length);
  for (let i = 0; i < before.length; i++) {
    out[i] = after[i] - before[i];
  }
  return out;
}

export interface ChangeSummary {
  unit: string;
  totalPixels: number;
  validPixels: number;
  validFraction: number;
  mean: number;
  median: number;
  p10: number;
  p25: number;
  p75: number;
  p90: number;
}

function percentile(sorted: Float64Array, p: number): number {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Robust summary of the difference distribution over valid pixels. */
export function summarizeChange(diff: Float32Array, unit: string): ChangeSummary {
  let count = 0;
  let sum = 0;
  for (let i = 0; i < diff.length; i++) {
    if (!Number.isNaN(diff[i])) {
      count++;
      sum += diff[i];
    }
  }
  const valid = new Float64Array(count);
  let j = 0;
  for (let i = 0; i < diff.length; i++) {
    if (!Number.isNaN(diff[i])) valid[j++] = diff[i];
  }
  valid.sort();
  return {
    unit,
    totalPixels: diff.length,
    validPixels: count,
    validFraction: count / diff.length,
    mean: count > 0 ? sum / count : NaN,
    median: count > 0 ? percentile(valid, 0.5) : NaN,
    p10: count > 0 ? percentile(valid, 0.1) : NaN,
    p25: count > 0 ? percentile(valid, 0.25) : NaN,
    p75: count > 0 ? percentile(valid, 0.75) : NaN,
    p90: count > 0 ? percentile(valid, 0.9) : NaN,
  };
}

/**
 * Diverging colour scale: decrease -> blue, neutral -> white, increase ->
 * orange-red.  Colours are interpolated linearly in RGB; no smoothing.
 */
export function changeColour(delta: number, saturation: number): [number, number, number] {
  const t = Math.max(-1, Math.min(1, delta / saturation));
  const neutral: [number, number, number] = [255, 255, 255];
  const negative: [number, number, number] = [37, 99, 235]; // #2563EB
  const positive: [number, number, number] = [194, 65, 12]; // #C2410C
  const target = t < 0 ? negative : positive;
  const k = Math.abs(t);
  return [
    Math.round(neutral[0] + (target[0] - neutral[0]) * k),
    Math.round(neutral[1] + (target[1] - neutral[1]) * k),
    Math.round(neutral[2] + (target[2] - neutral[2]) * k),
  ];
}
