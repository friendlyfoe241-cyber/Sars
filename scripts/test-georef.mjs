// Known-answer test for footprint-derived quicklook georeferencing
// (src/lib/rasterSource.ts deriveQuadFromImage), used for products that
// publish no KML ground overlay.  Run with: node scripts/test-georef.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "georef-"));
const bundle = join(dir, "rasterSource.js");
execFileSync("npx", ["esbuild", "src/lib/rasterSource.ts", "--bundle", "--format=esm", `--outfile=${bundle}`], {
  stdio: "pipe",
});
const { deriveQuadFromImage } = await import(bundle);

// Known image -> geo affine; the swath is a rotated quad of valid pixels
// inside nodata, exactly like an ASF quicklook rendering.
const A = { a: 0.002, b: 0.0005, c: 26, d: -0.0005, e: -0.002, f: 7.5 };
const geo = (col, row) => [A.a * col + A.b * row + A.c, A.d * col + A.e * row + A.f];
const W = 1600, H = 1400;
const px = { w: [100, 500], e: [1500, 800], n: [1300, 100], s: [300, 1200] };
const ringPx = [px.n, px.e, px.s, px.w];
const inQuad = (x, y) => {
  let inside = false;
  for (let i = 0, j = ringPx.length - 1; i < ringPx.length; j = i++) {
    const [xi, yi] = ringPx[i], [xj, yj] = ringPx[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const red = new Uint8ClampedArray(W * H);
for (let r = 0; r < H; r++)
  for (let c = 0; c < W; c++)
    if (inQuad(c, r)) red[r * W + c] = 100;
const footprint = [px.w, px.n, px.e, px.s].map(([c, r]) => geo(c, r));

let failures = 0;
const check = (name, ok, info = "") => {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name} ${info}`); }
};
const TOL = 0.01; // documented accuracy: about 1 km
const close = (p, q) => Math.abs(p[0] - q[0]) < TOL && Math.abs(p[1] - q[1]) < TOL;

const derived = deriveQuadFromImage({ width: W, height: H, red }, footprint);
check("nw corner within 1 km", close(derived.nw, geo(0, 0)), JSON.stringify(derived.nw));
check("ne corner within 1 km", close(derived.ne, geo(W - 1, 0)));
check("se corner within 1 km", close(derived.se, geo(W - 1, H - 1)));
check("sw corner within 1 km", close(derived.sw, geo(0, H - 1)));

const full = { width: 100, height: 100, red: new Uint8ClampedArray(100 * 100).fill(50) };
const refuses = (name, fn) => {
  try { fn(); check(name, false, "did not throw"); } catch { check(name, true); }
};
refuses("refuses a maskless image", () => deriveQuadFromImage(full, [[0, 0], [1, 0], [1, 1], [0, 1]]));
refuses("refuses a degenerate footprint", () => deriveQuadFromImage({ width: W, height: H, red }, [[0, 0], [0, 0], [0, 0], [0, 0]]));

rmSync(dir, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
