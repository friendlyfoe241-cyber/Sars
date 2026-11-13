# NISAR Surface Change Monitored Prototype

*Dancing with the SARs — NASA Space Apps Challenge 2026*

A React/TypeScript web application for global SAR surface-change monitoring using NASA NISAR data.

---

## Key Capabilities & Architecture

* **Global Discovery:** Search locations worldwide (Nominatim), draw an Area of Interest (AOI), and query the public ASF search service (`api.daac.asf.alaska.edu`) for live **NISAR L2 GCOV** granules.
* **Compatible Pairing:** Automatically pairs scenes matching sensor band, orbit, track, frame, polarization, and processing maturity (12-day repeat cycles).
* **Before / After / Change Viewer:** Compares public browse quicklooks georeferenced via KML quads. Computes pixel-level difference layers (`after − before`) and summary statistics deterministically in the browser.
* **AI Change Explainer:** Serverless Vercel function (`/api/explain-change`) using Gemini to generate structured, evidence-based interpretations (`observedSignal`, `possibleIndication`, `limitations`) from metadata and statistics alone—never raw imagery.
* **Calibrated Processing:** Optional Python script (`prepare_nisar_gcov.py`) supporting NASA Harmony subsetting or lazy HDF5 range requests for calibrated dB GeoTIFF generation.

---

## Project Structure

```text
project/
├── public/data/               # Prepared example dataset (Tonj wetlands, South Sudan)
├── src/
│   ├── components/            # MapView, SearchPanel, ResultsPanel, ControlPanel, ObservationInfo
│   ├── lib/                   # aoi, geocode, discovery, pairing, raster, rasterSource, changeDetection, useChangeLayers, data
│   └── App.tsx
├── api/                       # Vercel serverless function (Gemini integration)
├── scripts/                   # GCOV/quicklook preparation scripts & smoke tests
└── package.json

```

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Run local development server
npm run dev

```
