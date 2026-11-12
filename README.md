# NISAR | Surface Change

Global SAR surface-change monitoring prototype for the NASA Space Apps
Challenge 2026 project **Dancing with the SARs**. The application opens
directly into the monitoring interface: search any location worldwide,
discover the real NISAR observations covering it, select a compatible
acquisition pair and compare it with the Before / After / Change viewer.

Built with React, TypeScript, Vite, Tailwind CSS and Leaflet (React Leaflet).

---

## What the application does

1. **Global map** — starts at a world view; click anywhere to select a
   location, search by place name or "lat, lon" coordinates (OpenStreetMap
   Nominatim), or draw a rectangular area of interest (AOI).
2. **Live NISAR discovery** — "Search NISAR data" queries the ASF search
   service (the service behind ASF Data Search / Vertex and the `asf_search`
   Python package) for NISAR L2 GCOV granules intersecting the AOI. The
   returned scene footprints are drawn on the map; results are listed newest
   first with product identifier, date, band, polarisation and processing
   maturity (VALIDATED / PROVISIONAL / BETA). A date-range filter is
   available.
3. **Compatible pairs** — scenes are only paired when sensor band, product
   type, polarisation set, orbit direction, track, frame, processing
   maturity and processing versions all match. Suggested pairs are ranked by
   how much of the AOI they actually cover and by baseline (NISAR repeats
   every 12 days). Incompatible manual selections are explained.
4. **Comparison viewer** — the selected pair is loaded into the existing
   Before / After / Change viewer with polarisation switching, the pixel-level
   difference layer and calculated statistics. Rasters are the public ASF
   browse quicklooks of the selected granules, georeferenced with their KML
   ground-overlay quads and resampled to the AOI grid in the browser.
5. **Explain this change** — the Gemini feature uses the currently selected
   study area, pair and calculated statistics.

## Study area example

The repository ships one prepared example dataset (used by the "Example"
link and recognised when its pair is selected):

| | |
|---|---|
| Study area | **Tonj floodplain wetlands**, Warrap State, South Sudan |
| Phenomenon | **Seasonal wetland inundation** (flood extent dynamics) |
| Products | `NISAR_L2_PR_GCOV_034_014_A_005_2005_DHDH_A_20261025T034252_..._P05036_N_F_J_001` (25 Oct 2026) and `NISAR_L2_PR_GCOV_035_014_A_005_2005_DHDH_A_20261106T034253_..._P05036_N_F_J_001` (6 Nov 2026) |
| Product type | NISAR L2 GCOV, collection `NISAR_L2_GCOV_V1` (VALIDATED), CRID P05036, L-band, dual-pol HH/HV, path 14 / frame 5, ascending, 12-day baseline |

Any other location uses exactly the same workflow — the example is data in
`public/data/manifest.json`, not a special case in the code.

## Data discovery and catalogue

- **Catalogue:** ASF search service `api.daac.asf.alaska.edu` (GeoJSON-style
  results with footprints, polarisation, track/frame, orbit, maturity,
  download and browse URLs). CORS-enabled, no authentication for metadata.
  Only `platform=NISAR` + `processingLevel=GCOV` products with polarimetric
  layers are requested and shown — never Sentinel-1, ALOS PALSAR or other
  missions, never unsupported NISAR product types.
- **Caching:** identical searches are served from an in-memory cache
  (`src/lib/discovery.ts`); geocoding is rate-limited to one request per
  second and cached (`src/lib/geocode.ts`).
- **Scene metadata:** product identifier, acquisition time, band,
  polarisation channels, product type, processing maturity, CRID/PGE
  versions, orbit direction, orbit/track/frame, footprint, product download
  URL. Only fields genuinely present in the catalogue are displayed.

## Raster availability

The application distinguishes (per scene and per loaded pair):

| State | Meaning |
|---|---|
| Metadata available | found in the catalogue; footprint and metadata shown |
| Quicklook available | public ASF browse quicklook can be loaded → display-DN comparison possible |
| Calibrated raster available | a prepared calibrated dataset covers the selected pair (e.g. the example dataset) |
| Processed and ready | rasters loaded onto the AOI grid; Before / After / Change enabled |

Finding a scene in the catalogue does not imply its raster is display-ready:
when rasters cannot be prepared, the application shows the scene metadata
and an explicit processing status instead of pretending a comparison exists.

## Which values are calculated, and their limitations

**Calculated in the browser** (`src/lib/changeDetection.ts`, deterministic,
separate from the UI): pixel-level difference `after − before` per
polarisation, summary statistics over valid pixels (median, mean, IQR,
10/90th percentiles, valid-pixel fraction), and the rendered change layer
(blue = decrease, white = unchanged, orange-red = increase).

**Limitations (also shown in the UI):** dynamic pairs use 8-bit quicklook
**display DN** renderings, not calibrated backscatter — the change layer's
*sign* is meaningful (shared monotonic quicklook rendering), its *magnitude*
is not σ⁰ in dB. Quicklook source resolution is ~180 m. Pixels outside the
observation footprint are nodata and excluded from all statistics. No flood
classification or flooded-area estimate is computed.

## Calibrated rasters and NASA Harmony

`scripts/prepare_nisar_gcov.py` prepares calibrated dB rasters for **any**
product IDs and AOI selected in the application (all inputs are command-line
arguments):

```bash
python prepare_nisar_gcov.py \
  --scene-before <product id> --scene-after <product id> \
  --window WEST SOUTH EAST NORTH \
  --via harmony --keep-geotiff
```

Two retrieval backends (both require an Earthdata login, used server-side /
offline only, never in the browser):

- `--via harmony` — **NASA Harmony** spatial (bbox) + variable subsetting of
  the GCOV product into a GeoTIFF covering only the AOI (verified via
  `https://harmony.earthdata.nasa.gov/capabilities?shortName=NISAR_L2_GCOV_V1`:
  `subsetting.bbox: true`, `subsetting.variable: true`, GeoTIFF/PNG output).
  The full HDF5 product is never downloaded.
- `--via hdf5` — lazy HDF5 reads through `earthaccess.open()` (HTTP range
  requests): only the grid rows/columns covering the AOI are fetched.

**Important:** `prepare_nisar_gcov.py` could not be executed in the build
environment (no Earthdata credentials there); HDF5 dataset paths are located
by introspection and the Harmony variable names are tried in order.

## Environment variables

See `.env.example`. Only the Gemini API key is required, and only for the
"Explain this change" feature:

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | for the AI feature | Gemini API key, **server-side only** (never use a `VITE_` prefix) |
| `GEMINI_MODEL` | no | Gemini model id, default `gemini-2.5-flash` |

Metadata discovery and quicklook loading need **no credentials at all** —
they use public endpoints directly from the browser. Earthdata
authentication is required only for downloading calibrated GCOV products,
which happens offline in `scripts/`, never when someone opens the website.

## Supabase

**Not used.** Discovery is live against the public catalogue and the example
configuration lives in `public/data/manifest.json`, so no persistent storage
is needed and **no SQL setup is necessary**. There is no `supabase/schema.sql`
in this repository.

## The Gemini feature

`POST /api/explain-change` (Vercel serverless function,
`api/explain-change.ts`) receives only metadata and the calculated summary
statistics for the currently selected area and pair — never imagery — and
returns a short structured explanation: `observedSignal`,
`possibleIndication`, `limitations` (2–4 sentences total). The system
instruction forbids inventing measurements, claiming to have inspected
imagery, or naming any single cause as established, and requires measured
facts to be separated from interpretation.

## Run locally

```bash
npm install
npm run dev          # UI on http://localhost:5173 (no /api endpoint)
```

For the full experience including the Gemini endpoint, use the Vercel CLI:

```bash
npm i -g vercel
vercel dev           # serves the UI and /api/explain-change together
```

Endpoint tests (no network needed):

```bash
node scripts/test-api.mjs
```

## Deploy to Vercel

1. Push the repository to GitHub/GitLab and import it in Vercel
   (framework preset: **Vite**; build command `npm run build`;
   output directory `dist` — the defaults are correct).
2. Add `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`) under
   *Project → Settings → Environment Variables*.
3. Deploy. The `api/` directory is picked up automatically as Vercel
   serverless functions.

## Project structure

```text
project/
├── public/
│   └── data/                        # prepared example dataset (manifest + rasters)
├── src/
│   ├── components/
│   │   ├── MapView.tsx              # global map, footprints, AOI, overlays, legend
│   │   ├── SearchPanel.tsx          # location search, AOI controls, search button
│   │   ├── ResultsPanel.tsx         # results, suggested pairs, scene metadata
│   │   ├── ControlPanel.tsx         # acquisition, polarisation, display layer
│   │   ├── ObservationInfo.tsx      # metadata, calculated stats, Gemini feature
│   │   └── ui.tsx                   # shared section primitive
│   ├── lib/
│   │   ├── aoi.ts                   # area-of-interest geometry and parsing
│   │   ├── geocode.ts               # place-name search (Nominatim, rate-limited)
│   │   ├── discovery.ts             # ASF catalogue search + normalisation + cache
│   │   ├── pairing.ts               # compatibility rules and pair suggestions
│   │   ├── rasterSource.ts          # quicklook acquisition + AOI resampling
│   │   ├── raster.ts                # canvas decode/render for overlays
│   │   ├── changeDetection.ts       # deterministic change maths
│   │   └── data.ts                  # dataset models and manifest loading
│   ├── App.tsx
│   └── ...
├── api/
│   └── explain-change.ts            # Vercel function, Gemini integration
├── scripts/
│   ├── prepare_nisar_quicklook.py   # builds the example dataset
│   ├── prepare_nisar_gcov.py        # calibrated rasters for any pair/AOI
│   ├── test-api.mjs                 # endpoint smoke test
│   └── requirements.txt
├── .env.example
└── package.json
```

## Remaining limitations

- Dynamic comparisons use quicklook display values (see above); calibrated
  dB comparisons require an offline run of `prepare_nisar_gcov.py`
  (Earthdata login), after which the prepared pair is recognised and shown
  as "calibrated" automatically.
- Only NISAR L2 GCOV products are searched and displayed; other product
  types would need their own rendering/processing support first.
- Suggested pairs are ranked by AOI coverage and baseline; a pair with low
  coverage can still be selected manually — the valid-pixel statistics make
  this visible.
- The result list is capped by the catalogue query limit (300 scenes) with
  a truncation notice; narrow the date range or AOI for very dense areas.
