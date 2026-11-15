import type { Aoi } from "./aoi";
import type { NisarScene } from "./discovery";

export interface ScenePair {
  before: NisarScene;
  after: NisarScene;
  baselineDays: number;
  aoiCoverage: number;
  compatibility: string;
}

export interface PairIssue {
  field: string;
  before: string;
  after: string;
}

export function compatibilityKey(scene: NisarScene): string {
  return [
    scene.band,
    scene.productType,
    scene.polarisations.join("+"),
    scene.orbitDirection,
    scene.track ?? "-",
    scene.frame ?? "-",
    scene.collection,
    scene.crid ?? "-",
    scene.pgeVersion ?? "-",
    scene.productionCode ?? "-",
  ].join("|");
}

export function compatibilityLabel(scene: NisarScene): string {
  return [
    scene.band,
    scene.productType,
    scene.polarisations.join("/"),
    scene.orbitDirection.toLowerCase(),
    scene.track !== null ? `track ${scene.track}` : "track unknown",
    scene.frame !== null ? `frame ${scene.frame}` : "frame unknown",
    scene.maturity.toLowerCase(),
  ].join(" · ");
}

export function pairIssues(a: NisarScene, b: NisarScene): PairIssue[] {
  const issues: PairIssue[] = [];
  const compare = (
    field: string,
    va: string | number | null,
    vb: string | number | null,
  ) => {
    if (String(va ?? "-") !== String(vb ?? "-")) {
      issues.push({ field, before: String(va ?? "unknown"), after: String(vb ?? "unknown") });
    }
  };
  compare("sensor band", a.band, b.band);
  compare("product type", a.productType, b.productType);
  compare("polarisation", a.polarisations.join("/"), b.polarisations.join("/"));
  compare("orbit direction", a.orbitDirection, b.orbitDirection);
  compare("track", a.track, b.track);
  compare("frame", a.frame, b.frame);
  compare("processing maturity", a.maturity, b.maturity);
  compare("processing version", a.pgeVersion, b.pgeVersion);
  compare("release", a.crid, b.crid);
  compare("product variant", a.productionCode, b.productionCode);
  if (a.startTime === b.startTime) {
    issues.push({
      field: "acquisition time",
      before: a.startTime,
      after: b.startTime,
    });
  }
  return issues;
}

function daysBetween(isoA: string, isoB: string): number {
  return Math.round(
    Math.abs(new Date(isoA).getTime() - new Date(isoB).getTime()) / 86_400_000,
  );
}

function pointInRing(lon: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function aoiCoverage(footprint: [number, number][], aoi: Aoi): number {
  if (footprint.length < 3) return 0;
  const n = 12;
  let hit = 0;
  for (let r = 0; r < n; r++) {
    const lat = aoi.south + ((aoi.north - aoi.south) * (r + 0.5)) / n;
    for (let c = 0; c < n; c++) {
      const lon = aoi.west + ((aoi.east - aoi.west) * (c + 0.5)) / n;
      if (pointInRing(lon, lat, footprint)) hit++;
    }
  }
  return hit / (n * n);
}

export function findCompatiblePairs(
  scenes: NisarScene[],
  opts: { aoi?: Aoi; limit?: number } = {},
): ScenePair[] {
  const limit = opts.limit ?? 8;
  const groups = new Map<string, NisarScene[]>();
  for (const scene of scenes) {
    const key = compatibilityKey(scene);
    const list = groups.get(key);
    if (list) list.push(scene);
    else groups.set(key, [scene]);
  }

  const pairs: ScenePair[] = [];
  for (const [key, group] of groups) {
    const sorted = [...group].sort((a, b) =>
      a.startTime < b.startTime ? -1 : 1,
    );
    for (let i = 0; i < sorted.length - 1; i++) {
      const baselineDays = daysBetween(sorted[i].startTime, sorted[i + 1].startTime);
      if (baselineDays < 1) continue;
      pairs.push({
        before: sorted[i],
        after: sorted[i + 1],
        baselineDays,
        aoiCoverage: opts.aoi ? aoiCoverage(sorted[i].footprint, opts.aoi) : 1,
        compatibility: key,
      });
    }
  }
  pairs.sort((a, b) => {
    const cov = Math.round(b.aoiCoverage * 10) - Math.round(a.aoiCoverage * 10);
    return cov !== 0 ? cov : a.baselineDays - b.baselineDays;
  });
  return pairs.slice(0, limit);
}
