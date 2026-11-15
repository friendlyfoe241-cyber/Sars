# NISAR Surface Change

*Dancing with the SARs — NASA Space Apps Challenge 2026*

A web application for investigating surface change on Earth with NASA–ISRO
NISAR SAR data. Pick any place on the globe, discover the real NISAR L2 GCOV
observations covering it, compare compatible acquisition pairs, run the
scientific change analysis on calibrated measurements, and export the results.

Two layers:

- **Web app** (React + TypeScript + Leaflet): map, discovery, pairing,
  before/after/change comparison, statistics, charts, exports and the Gemini
  "Explain this change" feature (`api/explain-change.ts`).
- **Processing pipeline** (Python, `processing/nisar_change`): catalogue
  discovery, pair selection, authenticated retrieval of calibrated GCOV data
  via NASA Harmony, dB calibration, change classification and area
  calculations. Exposed to the app through `processing/serve.py` (a small
  local JSON API) and as a CLI.

---

## Quick start

```bash
npm install
npm run dev            # web app on http://localhost:5173 (proxies /api to :8788)
```

Start the analysis server (`processing/serve.py`, see below) for the
`/api` endpoints. The prepared demonstration dataset (Tonj floodplain
wetlands, South Sudan) is available from the *Example* button.

## Calibrated analysis (Python pipeline)

```bash
python3 -m venv .venv-py && .venv-py/bin/pip install -r processing/requirements.txt

# credentials: create .env.local (git-ignored) with
#   NASA_EARTHDATA_BEARER_TOKEN=your_token_here
# or export NASA_EARTHDATA_BEARER_TOKEN in the shell.

.venv-py/bin/python processing/serve.py        # analysis API on :8788
```

Then open the web app and press **Run calibrated analysis** in the Explain
step. The pipeline searches the ASF catalogue, selects a compatible pair,
subsets both acquisitions through NASA Harmony to the area of interest,
converts linear power to dB, classifies change and computes area estimates.
Downloads are cached under `processing/cache/`; results (CSV, JSON, GeoTIFF)
under `processing/out/<id>/`.

CLI equivalent:

```bash
cd processing && ../.venv-py/bin/python -m nisar_change \
  --bbox 28.4 7.5 28.7 7.8 --event deforestation \
  --before 2026-10-25 --after 2026-11-06 --pol HV --out out/
```

Tests: `cd processing && ../.venv-py/bin/python -m pytest tests/`,
`node scripts/test-api.mjs` for the Gemini endpoint and
`node scripts/test-georef.mjs` for the derived-georeferencing maths.

## Live mode vs prepared demonstration

| Mode | Data | Label in the UI |
|---|---|---|
| Live discovery | ASF Search API, current catalogue (metadata, footprints, quicklooks) | NISAR data · quicklook |
| Live calibrated analysis | NASA Harmony subsets of NISAR L2 GCOV (needs the token) | live · calibrated |
| Prepared demonstration | `public/data/manifest.json` (prepared example pair) | labelled per its manifest |

The application never silently falls back to the prepared dataset when a live
request fails; it reports the error and keeps the modes visibly distinct.

## Event analysis methods

| Event | Status | Method |
|---|---|---|
| Deforestation / vegetation disturbance | **Implemented** | HV/HH backscatter change (dB) with a documented threshold; candidate-disturbance area estimates |
| Flood | Not implemented | needs permanent-water/terrain masks and a seasonal baseline (`processing/nisar_change/events.py` states the requirements) |
| Earthquake deformation | Not implemented | needs interferometric products; backscatter differencing cannot measure displacement |

Backscatter change is not proof of a cause: outputs are labelled **candidate
disturbance** and carry explicit limitations.

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `NASA_EARTHDATA_BEARER_TOKEN` | Python pipeline (env or `.env.local`) | authenticated NISAR retrieval via NASA Harmony |
| `GEMINI_API_KEY` | Vercel/server | Gemini "Explain this change" (server-side only) |
| `GEMINI_MODEL` | Vercel/server | optional, default `gemini-3-flash-preview` (auto-falls back to `gemini-3.1-flash-lite` if a model id is retired) |
| `VITE_ANALYSIS_API` | build time | only for the optional cross-origin split; leave unset on Render (everything is same origin) |
| `NISAR_MAX_ANALYSIS_PIXELS` | Python worker | optional, default `6000000`; larger areas are analysed on a subsampled grid (see below) |

No Supabase or database is used; no SQL setup is necessary. Never commit
`.env.local`, never use a `VITE_` prefix for secrets.

### Analysis size and memory

The worker keeps its peak memory bounded (verified ≈ 310 MB for a 100 × 100 km
AOI, including the full 20 m GCOV downloads) so it fits small instances such
as Render's 512 MB services.  When the requested area exceeds
`NISAR_MAX_ANALYSIS_PIXELS` at the product resolution (a 100 × 100 km AOI at
20 m is 25M pixels), the analysis runs on **every k-th pixel — an exact
subsample, values untouched, no smoothing** — and the result reports the
factor and the actual analysis pixel size in
`processing.analysisGridDecimation`.  Candidate-area estimates are computed
from the analysis grid's true pixel areas and remain threshold-dependent
estimates.

## Deployment

**Recommended: everything on Render, one service.**  The repository contains a
`render.yaml` blueprint: create a *Blueprint* instance from the repository (or
a *Web Service* with the same settings) — build `npm ci && npm run build &&
pip install -r processing/requirements.txt`, start `python
processing/serve.py --host 0.0.0.0 --port $PORT`, health check `/api/health`.
The Python server hosts the built web app, the analysis API and the
`/api/explain-change` endpoint.  Set `NASA_EARTHDATA_BEARER_TOKEN` and
`GEMINI_API_KEY` as service secrets and leave `VITE_ANALYSIS_API` unset —
everything is served from one origin.

Two operational notes:

- Use a paid instance for demos.  The free tier sleeps after idle time, which
  adds a ~30-60 s cold start to the next visit.
- Peak worker memory is ~310 MB (the analysis grid is bounded), so the
  512 MB instance type is sufficient.

**Optional split (static web elsewhere + worker on Render).**  Run
`processing/serve.py` on any Python host with `NASA_EARTHDATA_BEARER_TOKEN`,
then set `VITE_ANALYSIS_API` to that worker's public HTTPS URL at build time.
Serverless functions are not suitable for Harmony jobs (minutes-long, large
downloads) — keep the pipeline as a worker.

### Retrieval speed

The two Harmony subset jobs of a pair run **concurrently** (roughly halving
the retrieval wall-clock), and the worker **warms its download cache in the
background** when the Explain step opens on a pair — by the time
"Run calibrated analysis" is pressed the data is usually ready and the analysis
completes in seconds.  The warm-up is best-effort and deduplicated (it does
spend NASA Harmony quota for the pair on screen; see `PREFETCH_TTL_S` in
`processing/serve.py`).  Repeat runs of the same area and dates are served
from the cache entirely.

## Known limitations

- Quicklook comparisons (no pipeline) use ASF browse renderings in display
  DN: the *sign* of change is meaningful, the magnitude is not calibrated
  backscatter. Only the Python pipeline produces calibrated dB statistics.
- Only NISAR L2 GCOV products are supported (L-band; HH/HV or VV/VH where
  acquired). Both polarisation channels may not exist in every product.
- The change threshold (default 3 dB) is a documented starting point, not a
  validated value; speckle is not filtered; candidate areas are
  threshold-dependent estimates and are not ground truth.
- Single before/after pairs cannot separate deforestation from soil-moisture,
  seasonal, flooding or wind effects. Validation against independent
  reference data is required before drawing conclusions.
