// Deterministic change-detection maths.  No DOM access and no state: given
// the same inputs these functions always return the same outputs, so results
// are reproducible and testable independently of the UI.
//
// Rasters are 8-bit, and in both encodings the unit value is a linear
// function of the stored DN, so the pixel difference (after - before) is
// always `deltaScale(encoding) * (afterDN - beforeDN)` with an integer DN
// delta in [-255, 255].  Every statistic is therefore derived exactly from a
// 511-bin histogram of DN deltas: one pass over the pixels, no per-pixel
// float arrays and no sorting.  Missing observations (nodata / outside the
// footprint) are excluded from every statistic.

import type { RasterEncoding } from "./data";

/** Largest absolute DN delta between two 8-bit rasters. */
export const MAX_DN_DELTA = 255;
const BINS = 2 * MAX_DN_DELTA + 1;

/** Unit value of one DN step of difference ("display DN" or dB). */
export function deltaScale(encoding: RasterEncoding): number {
  if (encoding.type === "quicklook_dn") return 1;
  return ((encoding.dbMax ?? 5) - (encoding.dbMin ?? -30)) / 254;
}

export interface DeltaHistogram {
  /** counts[d + MAX_DN_DELTA] = number of valid pixels with DN delta d */
  counts: Uint32Array;
  /** pixels where both observations are valid */
  valid: number;
  /** pixels visited (valid or not) */
  total: number;
}

/**
 * Histogram of (after - before) DN deltas over pixels valid in both rasters.
 * `step` > 1 subsamples deterministically (every step-th pixel).
 */
export function deltaHistogram(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
  nodata: number,
  step = 1,
): DeltaHistogram {
  if (before.length !== after.length) {
    throw new Error("before/after rasters have different sizes");
  }
  const counts = new Uint32Array(BINS);
  let valid = 0;
  let total = 0;
  for (let i = 0; i < before.length; i += step) {
    total++;
    const b = before[i];
    const a = after[i];
    if (b === nodata || a === nodata) continue;
    counts[a - b + MAX_DN_DELTA]++;
    valid++;
  }
  return { counts, valid, total };
}

/** DN delta of the pixel at 0-based `rank` in ascending order. */
function deltaAtRank(counts: Uint32Array, rank: number): number {
  let seen = 0;
  for (let bin = 0; bin < BINS; bin++) {
    seen += counts[bin];
    if (seen > rank) return bin - MAX_DN_DELTA;
  }
  return MAX_DN_DELTA;
}

/** Linearly interpolated percentile (same definition as a sorted-array lookup). */
function percentile(hist: DeltaHistogram, p: number): number {
  const idx = (hist.valid - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const vLo = deltaAtRank(hist.counts, lo);
  const vHi = hi === lo ? vLo : deltaAtRank(hist.counts, hi);
  return vLo + (vHi - vLo) * (idx - lo);
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

/** Robust summary of the difference distribution over valid pixels. */
export function summarizeChange(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
  encoding: RasterEncoding,
  unit: string,
): ChangeSummary {
  if (
    encoding.type === "db_linear" &&
    (encoding.dbMin === undefined || encoding.dbMax === undefined)
  ) {
    throw new Error("db_linear encoding requires dbMin and dbMax");
  }
  const hist = deltaHistogram(before, after, encoding.nodata);
  const scale = deltaScale(encoding);
  const count = hist.valid;
  let sum = 0;
  for (let bin = 0; bin < BINS; bin++) {
    sum += hist.counts[bin] * (bin - MAX_DN_DELTA);
  }
  const pct = (p: number) => (count > 0 ? percentile(hist, p) * scale : NaN);
  return {
    unit,
    totalPixels: hist.total,
    validPixels: count,
    validFraction: hist.total > 0 ? count / hist.total : 0,
    mean: count > 0 ? (sum / count) * scale : NaN,
    median: pct(0.5),
    p10: pct(0.1),
    p25: pct(0.25),
    p75: pct(0.75),
    p90: pct(0.9),
  };
}

/**
 * Colour-scale saturation: 98th percentile of the difference over a
 * deterministic subsample (every 3rd pixel), rounded to a tidy value.
 */
export function computeSaturation(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
  encoding: RasterEncoding,
): number {
  const quicklook = encoding.type === "quicklook_dn";
  const hist = deltaHistogram(before, after, encoding.nodata, 3);
  if (hist.valid === 0) return quicklook ? 10 : 1;
  const rank = Math.floor((hist.valid - 1) * 0.98);
  const p98 = Math.abs(deltaAtRank(hist.counts, rank) * deltaScale(encoding));
  if (quicklook) return Math.max(10, Math.round(p98 / 5) * 5);
  return Math.max(1, Math.round(p98 * 2) / 2);
}

// ORBITAL diverging scale centred on zero (design system "scientific
// visualisation language"): decrease cyan, no difference neutral grey,
// increase amber.  Keep in step with --orb-data-* in styles/orbital.css.
const NEUTRAL = [190, 201, 210] as const; // #BEC9D2
const NEGATIVE = [104, 197, 235] as const; // #68C5EB
const POSITIVE = [243, 184, 90] as const; // #F3B85A

/**
 * Diverging colour scale: decrease -> cyan, zero -> neutral grey, increase ->
 * amber.  Colours are interpolated linearly in RGB; no smoothing.
 */
export function changeColour(delta: number, saturation: number): [number, number, number] {
  const t = Math.max(-1, Math.min(1, delta / saturation));
  const target = t < 0 ? NEGATIVE : POSITIVE;
  const k = Math.abs(t);
  return [
    Math.round(NEUTRAL[0] + (target[0] - NEUTRAL[0]) * k),
    Math.round(NEUTRAL[1] + (target[1] - NEUTRAL[1]) * k),
    Math.round(NEUTRAL[2] + (target[2] - NEUTRAL[2]) * k),
  ];
}

// ---------------------------------------------------------------------------
// Per-date brightness distribution (temporal graph)
// ---------------------------------------------------------------------------

/** Number of 8-bit display DN values (0..255). */
export const DN_BINS = 256;

/** Distribution of display DN of one acquisition over the common-valid pixels. */
export interface DateDistribution {
  mean: number;
  median: number;
  p10: number;
  p25: number;
  p75: number;
  p90: number;
}

export interface PerDateStats {
  /** pixels valid in EVERY date */
  validPixels: number;
  /** pixels visited */
  totalPixels: number;
  validFraction: number;
  /** one entry per input raster, in input order (callers pass chronological order) */
  dates: DateDistribution[];
}

/** DN of the pixel at 0-based `rank` in ascending order. */
function dnAtRank(counts: Uint32Array, rank: number): number {
  let seen = 0;
  for (let dn = 0; dn < DN_BINS; dn++) {
    seen += counts[dn];
    if (seen > rank) return dn;
  }
  return DN_BINS - 1;
}

/** Same interpolated percentile definition as `percentile` above, for a DN histogram. */
function dnPercentile(counts: Uint32Array, valid: number, p: number): number {
  const idx = (valid - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const vLo = dnAtRank(counts, lo);
  const vHi = hi === lo ? vLo : dnAtRank(counts, hi);
  return vLo + (vHi - vLo) * (idx - lo);
}

/**
 * Display-DN distribution of each raster over the pixels that are valid in
 * ALL rasters (same nodata rule as `deltaHistogram`: a pixel equal to
 * `nodata` in any raster is excluded from every date).  One pass, a 256-bin
 * histogram per date, exact (linearly interpolated) percentiles.  Values are
 * NaN when no pixel is valid in all dates.  No interpolation across dates.
 */
export function perDateStats(
  rasters: readonly Uint8ClampedArray[],
  nodata: number,
): PerDateStats {
  const n = rasters.length;
  const size = n > 0 ? rasters[0].length : 0;
  for (const r of rasters) {
    if (r.length !== size) throw new Error("rasters have different sizes");
  }
  const hists = rasters.map(() => new Uint32Array(DN_BINS));
  let valid = 0;
  for (let i = 0; i < size; i++) {
    let ok = true;
    for (let d = 0; d < n; d++) {
      if (rasters[d][i] === nodata) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    valid++;
    for (let d = 0; d < n; d++) hists[d][rasters[d][i]]++;
  }
  const dates = hists.map((counts): DateDistribution => {
    if (valid === 0) {
      return { mean: NaN, median: NaN, p10: NaN, p25: NaN, p75: NaN, p90: NaN };
    }
    let sum = 0;
    for (let dn = 0; dn < DN_BINS; dn++) sum += counts[dn] * dn;
    return {
      mean: sum / valid,
      median: dnPercentile(counts, valid, 0.5),
      p10: dnPercentile(counts, valid, 0.1),
      p25: dnPercentile(counts, valid, 0.25),
      p75: dnPercentile(counts, valid, 0.75),
      p90: dnPercentile(counts, valid, 0.9),
    };
  });
  return {
    validPixels: valid,
    totalPixels: size,
    validFraction: size > 0 ? valid / size : 0,
    dates,
  };
}
