import { useCallback, useEffect, useMemo, useState } from "react";
import ControlPanel from "./components/ControlPanel";
import MapView, { type DisplayLayer } from "./components/MapView";
import ObservationInfo, {
  type AiExplanation,
  type AiState,
} from "./components/ObservationInfo";
import ResultsPanel from "./components/ResultsPanel";
import SearchPanel from "./components/SearchPanel";
import {
  aoiCenter,
  aoiFromCenter,
  clampAoi,
  formatAoi,
  formatLatLon,
  parseCoordinates,
  DEFAULT_AOI_SIZE_KM,
  type Aoi,
} from "./lib/aoi";
import {
  computeDifference,
  decodeValues,
  summarizeChange,
  type ChangeSummary,
} from "./lib/changeDetection";
import {
  datasetStatusLabel,
  datasetStatusNote,
  loadManifest,
  type PreparedDataset,
  type ViewerDataset,
} from "./lib/data";
import { searchNisarGcov, type NisarScene } from "./lib/discovery";
import { geocodePlace } from "./lib/geocode";
import { findCompatiblePairs, type ScenePair } from "./lib/pairing";
import { renderChange, renderObservation } from "./lib/raster";
import {
  buildPairDataset,
  type PairDataset,
} from "./lib/rasterSource";

interface PolLayers {
  beforeUrl: string;
  afterUrl: string;
  changeUrl: string;
  summary: ChangeSummary;
}

type PairState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; dataset: PairDataset }
  | { status: "error"; message: string };

export default function App() {
  // ---- example dataset (public/data) ---------------------------------
  const [example, setExample] = useState<PreparedDataset | null>(null);

  // ---- location and AOI ---------------------------------------------
  const [query, setQuery] = useState("");
  const [locationLabel, setLocationLabel] = useState("");
  const [locationError, setLocationError] = useState<string | null>(null);
  const [searchingLocation, setSearchingLocation] = useState(false);
  const [aoi, setAoi] = useState<Aoi | null>(null);
  const [aoiSizeKm, setAoiSizeKm] = useState(DEFAULT_AOI_SIZE_KM);
  const [drawMode, setDrawMode] = useState(false);
  const [fitKey, setFitKey] = useState(0);

  // ---- catalogue search ---------------------------------------------
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [scenes, setScenes] = useState<NisarScene[]>([]);
  const [truncated, setTruncated] = useState(false);

  // ---- selection and pair -------------------------------------------
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [roleBefore, setRoleBefore] = useState<string | null>(null);
  const [roleAfter, setRoleAfter] = useState<string | null>(null);
  const [pairState, setPairState] = useState<PairState>({ status: "idle" });

  // ---- viewer --------------------------------------------------------
  const [pol, setPol] = useState("");
  const [layer, setLayer] = useState<DisplayLayer>("change");
  const [layers, setLayers] = useState<PolLayers | null>(null);
  const [computing, setComputing] = useState(false);
  const [ai, setAi] = useState<AiState>({ status: "idle" });

  const pairs = useMemo(() => findCompatiblePairs(scenes, { aoi: aoi ?? undefined }), [scenes, aoi]);
  const viewer: ViewerDataset | null =
    pairState.status === "ready" ? pairState.dataset.viewer : null;

  // ---- startup: the prepared example dataset -------------------------
  useEffect(() => {
    let cancelled = false;
    loadManifest()
      .then((m) => {
        if (cancelled) return;
        setExample({
          manifest: m,
          beforeId: m.acquisitionPair.earlier.productId,
          afterId: m.acquisitionPair.later.productId,
        });
        // The example study area is the initial AOI only; nothing is loaded
        // or searched until the user asks for it.
        if (!aoi) {
          setAoi(m.studyArea.bounds);
          setLocationLabel(`${m.studyArea.name}, ${m.studyArea.country}`);
        }
      })
      .catch(() => {
        /* the example dataset is optional; discovery works without it */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- viewer rendering (unchanged maths, dynamic inputs) ------------
  useEffect(() => {
    if (pairState.status !== "ready" || !pol) return;
    const pair = pairState.dataset;
    const rasters = pair.perPol[pol];
    if (!rasters) return;
    let cancelled = false;
    setComputing(true);
    try {
      const beforeValues = decodeValues(rasters.before.red, pair.viewer.encoding);
      const afterValues = decodeValues(rasters.after.red, pair.viewer.encoding);
      const diff = computeDifference(beforeValues, afterValues);
      const summary = summarizeChange(diff, pair.viewer.changeScale.unit);
      const next: PolLayers = {
        beforeUrl: renderObservation(rasters.before, pair.viewer.encoding),
        afterUrl: renderObservation(rasters.after, pair.viewer.encoding),
        changeUrl: renderChange(
          rasters.before,
          rasters.after,
          pair.viewer.encoding,
          pair.viewer.changeScale.saturation,
        ),
        summary,
      };
      if (!cancelled) {
        setLayers(next);
        setComputing(false);
      }
    } catch (err) {
      if (!cancelled) {
        setComputing(false);
        setSearchError(err instanceof Error ? err.message : String(err));
      }
    }
    return () => {
      cancelled = true;
    };
  }, [pairState, pol]);

  const overlayUrl = useMemo(() => {
    if (!layers) return null;
    return layer === "before"
      ? layers.beforeUrl
      : layer === "after"
        ? layers.afterUrl
        : layers.changeUrl;
  }, [layers, layer]);

  // ---- location and AOI handlers ------------------------------------
  const applyLocation = useCallback(
    (lat: number, lon: number, label: string) => {
      setAoi(aoiFromCenter(lat, lon, aoiSizeKm));
      setLocationLabel(label);
      setLocationError(null);
      setFitKey((k) => k + 1);
    },
    [aoiSizeKm],
  );

  const handleLocationSearch = useCallback(async () => {
    const text = query.trim();
    if (!text) return;
    const coords = parseCoordinates(text);
    if (coords) {
      applyLocation(
        coords[0],
        coords[1],
        formatLatLon(coords[0], coords[1]),
      );
      return;
    }
    setSearchingLocation(true);
    setLocationError(null);
    try {
      const result = await geocodePlace(text);
      if (result) {
        applyLocation(result.lat, result.lon, result.displayName);
      } else {
        setLocationError(
          "No matching place found. Try a different name or enter coordinates as “lat, lon”.",
        );
      }
    } catch (err) {
      setLocationError(
        err instanceof Error ? err.message : "Geocoding failed.",
      );
    } finally {
      setSearchingLocation(false);
    }
  }, [query, applyLocation]);

  const handlePickLocation = useCallback(
    (lat: number, lon: number) => {
      setDrawMode(false);
      applyLocation(lat, lon, `Pinned location · ${formatLatLon(lat, lon)}`);
    },
    [applyLocation],
  );

  const handleAoiDrawn = useCallback((drawn: Aoi) => {
    setAoi(clampAoi(drawn));
    setDrawMode(false);
    setLocationLabel("Custom area of interest");
    setLocationError(null);
  }, []);

  const handleAoiSizeChange = useCallback(
    (km: number) => {
      setAoiSizeKm(km);
      if (aoi) {
        const [lat, lon] = aoiCenter(aoi);
        setAoi(aoiFromCenter(lat, lon, km));
      }
    },
    [aoi],
  );

  const handleExample = useCallback(() => {
    if (!example) return;
    const m = example.manifest;
    setAoi(m.studyArea.bounds);
    setLocationLabel(`${m.studyArea.name}, ${m.studyArea.country}`);
    setQuery(`${m.studyArea.name}`);
    setFitKey((k) => k + 1);
  }, [example]);

  // ---- catalogue search ---------------------------------------------
  const runSearch = useCallback(
    async (bounds: Aoi, from: string, to: string) => {
      setSearching(true);
      setSearchError(null);
      setSearched(true);
      // A new search never keeps stale results or a stale comparison.
      setScenes([]);
      setSelectedSceneId(null);
      setRoleBefore(null);
      setRoleAfter(null);
      setPairState({ status: "idle" });
      setLayers(null);
      setAi({ status: "idle" });
      try {
        const result = await searchNisarGcov({
          aoi: bounds,
          start: from || undefined,
          end: to || undefined,
        });
        setScenes(result.scenes);
        setTruncated(result.truncated);
      } catch (err) {
        setSearchError(
          err instanceof Error ? err.message : "Catalogue search failed.",
        );
      } finally {
        setSearching(false);
      }
    },
    [],
  );

  const handleSearchData = useCallback(() => {
    if (!aoi) return;
    void runSearch(aoi, dateFrom, dateTo);
  }, [aoi, dateFrom, dateTo, runSearch]);

  const handleApplyDates = useCallback(
    (from: string, to: string) => {
      setDateFrom(from);
      setDateTo(to);
      if (aoi) void runSearch(aoi, from, to);
    },
    [aoi, runSearch],
  );

  // ---- pair loading --------------------------------------------------
  const loadPair = useCallback(
    async (before: NisarScene, after: NisarScene) => {
      if (!aoi) return;
      setPairState({ status: "loading" });
      setAi({ status: "idle" });
      setLayers(null);
      try {
        const dataset = await buildPairDataset({
          before,
          after,
          aoi,
          prepared: example,
          areaLabel: locationLabel || formatAoi(aoi),
        });
        setPairState({ status: "ready", dataset });
        setPol(dataset.viewer.polarisations[0] ?? "");
      } catch (err) {
        setPairState({
          status: "error",
          message:
            err instanceof Error
              ? err.message
              : "The rasters for this pair could not be prepared.",
        });
      }
    },
    [aoi, example, locationLabel],
  );

  const handleAssignRole = useCallback(
    (role: "before" | "after", id: string) => {
      setSelectedSceneId(id);
      if (role === "before") setRoleBefore(id);
      else setRoleAfter(id);
    },
    [],
  );

  const handleLoadPair = useCallback(
    (beforeId: string, afterId: string) => {
      const before = scenes.find((s) => s.id === beforeId);
      const after = scenes.find((s) => s.id === afterId);
      if (before && after) void loadPair(before, after);
    },
    [scenes, loadPair],
  );

  const handleLoadSuggested = useCallback(
    (pair: ScenePair) => {
      setRoleBefore(pair.before.id);
      setRoleAfter(pair.after.id);
      setSelectedSceneId(pair.after.id);
      void loadPair(pair.before, pair.after);
    },
    [loadPair],
  );

  // ---- Gemini explain ------------------------------------------------
  const handleExplain = useCallback(async () => {
    if (!viewer || !layers) return;
    setAi({ status: "loading" });
    try {
      const res = await fetch("/api/explain-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studyArea: {
            name: viewer.areaLabel,
            country: "",
            phenomenon: "",
          },
          acquisitionPair: {
            band: viewer.band,
            productType: viewer.productType,
            polarisation: pol,
            temporalBaselineDays: viewer.temporalBaselineDays,
            earlier: viewer.earlier.startTime,
            later: viewer.later.startTime,
          },
          dataset: {
            status: viewer.status,
            unit: viewer.encoding.unit,
            limitations: viewer.limitations,
          },
          statistics: layers.summary,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setAi({
          status: "error",
          message:
            body && typeof body.error === "string"
              ? body.error
              : `The explanation service returned an error (${res.status}).`,
        });
        return;
      }
      const exp = body?.explanation as AiExplanation | undefined;
      if (!exp) {
        setAi({
          status: "error",
          message: "Unexpected response from the explanation service.",
        });
        return;
      }
      setAi({ status: "done", explanation: exp });
    } catch {
      setAi({
        status: "error",
        message:
          "The explanation endpoint is not available. In local development run `vercel dev` instead of `npm run dev`.",
      });
    }
  }, [viewer, layers, pol]);

  const statusChip = viewer
    ? datasetStatusLabel(viewer.status)
    : "No comparison loaded";

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-app-border bg-app-bg px-4">
        <div className="text-[13px] font-semibold tracking-[0.01em] text-app-text">
          NISAR{" "}
          <span className="font-normal text-app-muted">| Surface Change</span>
        </div>
        <span
          title={viewer ? datasetStatusNote(viewer.status) : "Search for NISAR observations to load a comparison."}
          className="rounded-[3px] border border-app-border bg-white px-2 py-[3px] text-[11px] text-app-muted"
        >
          {statusChip}
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[352px] shrink-0 flex-col overflow-y-auto border-r border-app-border bg-app-bg">
          <SearchPanel
            query={query}
            onQueryChange={setQuery}
            onLocationSearch={handleLocationSearch}
            searchingLocation={searchingLocation}
            locationLabel={locationLabel}
            locationError={locationError}
            aoi={aoi}
            aoiSizeKm={aoiSizeKm}
            onAoiSizeChange={handleAoiSizeChange}
            drawMode={drawMode}
            onToggleDraw={() => setDrawMode((d) => !d)}
            onSearchData={handleSearchData}
            searching={searching}
            exampleLabel={example ? `${example.manifest.studyArea.name}` : null}
            onExample={handleExample}
          />

          {(searched || searching) && (
            <ResultsPanel
              scenes={scenes}
              pairs={pairs}
              loading={searching}
              error={searchError}
              truncated={truncated}
              dateFrom={dateFrom}
              dateTo={dateTo}
              onApplyDates={handleApplyDates}
              selectedSceneId={selectedSceneId}
              onSelectScene={setSelectedSceneId}
              roleBefore={roleBefore}
              roleAfter={roleAfter}
              onAssignRole={handleAssignRole}
              onLoadPair={handleLoadPair}
              onLoadSuggested={handleLoadSuggested}
            />
          )}

          {pairState.status === "loading" && (
            <div className="border-b border-app-border px-4 py-3.5 text-[11px] text-app-muted">
              Preparing rasters for the selected pair…
            </div>
          )}

          {pairState.status === "error" && (
            <div className="border-b border-app-border px-4 py-3.5">
              <h2 className="text-[11px] font-medium tracking-[0.06em] text-app-muted uppercase">
                Comparison status
              </h2>
              <p className="mt-2 text-[11px] leading-[1.5] text-app-text">
                {pairState.message}
              </p>
            </div>
          )}

          {pairState.status === "ready" && (
            <>
              <ControlPanel
                dataset={pairState.dataset.viewer}
                pol={pol}
                onPolChange={setPol}
                layer={layer}
                onLayerChange={setLayer}
                computing={computing}
              />
              <ObservationInfo
                dataset={pairState.dataset.viewer}
                pol={pol}
                summary={layers?.summary ?? null}
                ai={ai}
                onExplain={handleExplain}
              />
              <div className="mt-auto px-4 py-3 text-[10px] leading-[1.5] text-app-muted">
                {pairState.dataset.viewer.limitations[0]}
              </div>
            </>
          )}
        </aside>

        <main className="relative min-w-0 flex-1">
          <MapView
            aoi={aoi}
            scenes={scenes}
            selectedSceneId={selectedSceneId}
            onSelectScene={setSelectedSceneId}
            drawMode={drawMode}
            onAoiDrawn={handleAoiDrawn}
            onPickLocation={handlePickLocation}
            layer={layer}
            pol={pol}
            overlayUrl={overlayUrl}
            viewer={viewer}
            fitKey={fitKey}
          />
        </main>
      </div>
    </div>
  );
}
