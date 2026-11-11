# NISAR | Surface Change

Minimal SAR surface-change monitoring prototype for the NASA Space Apps
Challenge 2026 project **Dancing with the SARs**. The application opens
directly into the monitoring interface: pick a polarisation and a display
layer (Before / After / Change) to compare two NISAR acquisitions over one
study area and see what changed on the ground.

Built with React, TypeScript, Vite, Tailwind CSS and Leaflet (React Leaflet).

---

## Study area and scientific focus

| | |
|---|---|
| Study area | **Tonj floodplain wetlands**, Warrap State, South Sudan |
| Basin | Tonj River, upper Bahr el Ghazal system (western Sudd) |
| Phenomenon | **Seasonal wetland inundation** (flood extent dynamics of a floodplain wetland) |
| Window | 28.30°E–29.45°E, 6.90°N–8.00°N |

The study area is defined in `public/data/manifest.json` (bounds, boundary
polygon, description, acquisitions). Adding another study area later means
adding an entry there plus its prepared rasters — no application code changes
are required beyond registering the entry.

## Observation pair (real NISAR data)

Both acquisitions are NASA-ISRO **NISAR L-band** products from the same
track, frame, orbit direction and polarisation, processed with the same
software version and composite release (checked by the preparation script):

| | Earlier | Later |
|---|---|---|
| Product identifier | `NISAR_L2_PR_GCOV_034_014_A_005_2005_DHDH_A_20261025T034252_20261025T034327_P05036_N_F_J_001` | `NISAR_L2_PR_GCOV_035_014_A_005_2005_DHDH_A_20261106T034253_20261106T034327_P05036_N_F_J_001` |
| Acquisition | 25 Oct 2026, 03:42 UTC | 6 Nov 2026, 03:42 UTC |
| Orbit | 6514 (ascending) | 6687 (ascending) |

- Product type: **NISAR L2 GCOV** (geocoded observables), collection
  `NISAR_L2_GCOV_V1` (**VALIDATED**), CRID `P05036`, PGE `R05.03.2`.
- Path 14, frame 5, ascending, L-band, dual polarisation **HH / HV**
  (GCOV layers C11/HHHH and C22/HVHV).
- Temporal baseline: 12 days (NISAR repeat cycle).
- Source: NASA/ISRO NISAR, archived by the NASA ASF DAAC
  (see the [ASF NISAR Data User Guide](https://nisar-docs.asf.alaska.edu/)).

## What is displayed, and which values are calculated

**Real data (not synthetic):** the displayed rasters are the public ASF
*browse quicklook renderings* of the GCOV C11 (HH) and C22 (HV) layers of the
two granules above, resampled to the study window. Georeferencing comes from
the ASF KML ground-overlay quads shipped with each quicklook. The status chip
in the top bar identifies the dataset (`NISAR data · quicklook`).

**Calculated in the browser** (`src/lib/changeDetection.ts`, deterministic,
separate from the UI):

- pixel-level difference `after − before` per polarisation,
- summary statistics over valid pixels (median, mean, IQR, 10/90th
  percentiles, valid-pixel fraction),
- the rendered change layer (diverging scale: blue = decrease,
  white = unchanged, orange-red = increase).

**Known limitations of this data (also shown in the UI):**

- Quicklook values are 8-bit **display DN**, not calibrated backscatter.
  The change layer therefore reports differences in display units. Its
  *sign* is meaningful (the ASF quicklook rendering is shared across scenes
  and monotonic; verified by near-identical histograms and a block regression
  slope of 0.96 between the two dates), but its *magnitude* is not σ⁰ in dB.
- Quicklook resolution is about 181 m per pixel, coarser than the native
  GCOV posting (10–20 m).
- Pixels outside the observation footprint are nodata and are rendered
  transparent; they are excluded from all statistics.
- No flood classification, flooded-area estimate or change percentage is
  computed — those would require an implemented and validated method.

**Upgrading to calibrated data:** `scripts/prepare_nisar_gcov.py` downloads
the two GCOV HDF5 products with `earthaccess` (Earthdata Login required),
extracts calibrated backscatter in dB and rewrites `public/data/` with the
same schema (`encoding.type = "db_linear"`). The application then
automatically displays dB values and a dB change layer — no code changes
needed.

## Data preparation

```bash
cd scripts
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# what was used for the shipped dataset (public ASF quicklooks, no login):
python prepare_nisar_quicklook.py

# calibrated alternative (requires ~/.netrc Earthdata credentials):
python prepare_nisar_gcov.py
```

Scripts write `public/data/manifest.json` and
`public/data/observations/*.png`. Credentials are used only for the download
step and are never stored in the repository.

## Environment variables

See `.env.example`. Configure them in the Vercel project settings (or a local
`.env` used by `vercel dev`):

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | for the AI feature | Gemini API key, **server-side only** (never use a `VITE_` prefix) |
| `GEMINI_MODEL` | no | Gemini model id, default `gemini-2.5-flash` |

There are no other secrets. If `GEMINI_API_KEY` is missing, the
"Explain this change" button returns a clear configuration error and the rest
of the application works normally.

## Supabase

**Not used.** The study area and acquisition metadata live in
`public/data/manifest.json`, which is sufficient for this prototype, so no
database is required and **no SQL setup is necessary**. Consequently there is
no `supabase/schema.sql` file in this repository. If persistent storage is
added later (e.g. saved analysis results), a schema file will be provided
with that change.

## The Gemini feature

`POST /api/explain-change` (Vercel serverless function, `api/explain-change.ts`)
receives only metadata and the calculated summary statistics for the current
observation pair — never imagery — and returns a short structured
explanation: `observedSignal`, `possibleIndication`, `limitations`
(2–4 sentences total). The system instruction forbids inventing
measurements, claiming to have inspected imagery, or presenting any single
cause (flooding, deforestation, …) as established, and requires measured
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
   serverless functions; `public/data/` is served as static assets.

## Project structure

```text
project/
├── public/
│   └── data/
│       ├── manifest.json            # study area, acquisitions, encodings
│       └── observations/            # prepared before/after rasters per pol
├── src/
│   ├── components/
│   │   ├── MapView.tsx              # Leaflet map, boundary, overlays, legend
│   │   ├── ControlPanel.tsx         # study area, acquisition, pol, layer
│   │   └── ObservationInfo.tsx      # metadata, calculated stats, AI feature
│   ├── lib/
│   │   ├── data.ts                  # manifest types and loaders
│   │   ├── changeDetection.ts       # deterministic change maths
│   │   └── raster.ts                # canvas decode/render for overlays
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── api/
│   └── explain-change.ts            # Vercel function, Gemini integration
├── scripts/
│   ├── prepare_nisar_quicklook.py   # builds public/data (used for this build)
│   ├── prepare_nisar_gcov.py        # calibrated variant (needs Earthdata login)
│   ├── test-api.mjs                 # endpoint smoke test
│   └── requirements.txt
├── .env.example
└── package.json
```

## Remaining limitations

- The displayed rasters are quicklook renderings (see above); switching to
  calibrated dB products requires Earthdata credentials and a run of
  `scripts/prepare_nisar_gcov.py`.
- One study area and one acquisition pair only, by design for this version.
- The change layer is a raw pixel difference; no speckle filtering,
  co-registration refinement or classification is applied.
- `scripts/prepare_nisar_gcov.py` was written against the published GCOV
  product structure but could not be executed in the build environment
  (no Earthdata credentials there); dataset paths are located by
  introspection and may need adjustment for future product revisions.
