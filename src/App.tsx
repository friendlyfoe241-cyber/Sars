import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAbortError } from "./lib/abort";
import ControlPanel from "./components/ControlPanel";
import MapView from "./components/MapView";
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
  datasetStatusLabel,
  datasetStatusNote,
  loadManifest,
  type PreparedDataset,
  type ViewerDataset,
} from "./lib/data";
import { searchNisarGcov, type NisarScene } from "./lib/discovery";
import { geocodePlace } from "./lib/geocode";
import { findCompatiblePairs, type ScenePair } from "./lib/pairing";
import {
  buildPairDataset,
  pairQuicklookStatus,
  type PairDataset,
  RasterUnavailableError,
} from "./lib/rasterSource";
import {
  METHOD_VERSION,
  aoiKey,
  pairKey,
  scenePairId,
  selectionKey,
} from "./lib/selection";
import { useChangeLayers, type DisplayLayer } from "./lib/useChangeLayers";
import {
  IDLE_PAIR,
  deriveViewState,
  selectCurrentPair,
  type PairState,
} from "./lib/viewState";

const IDLE_AI: AiState = { status: "idle" };
const METADATA_ONLY_MESSAGE =
  "Quicklook rasters for this pair are not available. Scene metadata is shown instead of a comparison.";

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
  const [pairState, setPairState] = useState<PairState>(IDLE_PAIR);
  // Pairs whose rasters turned out to be unavailable (learned from a failed
  // load); listed as "Metadata only" from then on.
  const [unavailablePairs, setUnavailablePairs] = useState<ReadonlySet<string>>(new Set());

  // ---- viewer --------------------------------------------------------
  const [pol, setPol] = useState("");
  const [layer, setLayer] = useState<DisplayLayer>("change");
  // The explanation is stored with the selection key it was requested for
  // and only shown while that key is the current one.
  const [aiEntry, setAiEntry] = useState<{ key: string; state: AiState } | null>(null);

  // Cancellation: every search / pair load has an AbortController and a
  // sequence number.  The controller drops the fetches; the sequence check is
  // the final guard against a late response being applied.
  const searchSeq = useRef(0);
  const pairSeq = useRef(0);
  const searchAbort = useRef<AbortController | null>(null);
  const pairAbort = useRef<AbortController | null>(null);
  const aiRequest = useRef<string | null>(null);
  const aoiRef = useRef<Aoi | null>(null);
  // Channel to load first for the next pair (read at load time only).
  const polRef = useRef("");

  // ---- selection identity and everything derived from it -------------
  // Suggested pairs; ones known to lack rasters sort last and are labelled.
  const { pairs, metadataOnlyPairIds } = useMemo(() => {
    const raw = findCompatiblePairs(scenes, { aoi: aoi ?? undefined });
    const metadataOnly = new Set<string>();
    for (const p of raw) {
      const id = scenePairId(p.before.id, p.after.id);
      if (
        pairQuicklookStatus(p.before, p.after, example) === "metadata-only" ||
        unavailablePairs.has(id)
      ) {
        metadataOnly.add(id);
      }
    }
    const sorted = [...raw].sort(
      (a, b) =>
        Number(metadataOnly.has(scenePairId(a.before.id, a.after.id))) -
        Number(metadataOnly.has(scenePairId(b.before.id, b.after.id))),
    );
    return { pairs: sorted, metadataOnlyPairIds: metadataOnly };
  }, [scenes, aoi, example, unavailablePairs]);

  const pairBase = useMemo(
    () =>
      aoi && roleBefore && roleAfter
        ? { aoi, beforeId: roleBefore, afterId: roleAfter, methodVersion: METHOD_VERSION }
        : null,
    [aoi, roleBefore, roleAfter],
  );
  const currentPairKey = pairBase ? pairKey(pairBase) : null;
  // The only place a loaded result is matched against the selection.
  const activePair = selectCurrentPair(pairState, currentPairKey);
  const viewer: ViewerDataset | null = activePair?.viewer ?? null;
  // The channel is always one the active pair has loaded (other channels of
  // the pair may still be loading or unavailable).
  const readyChannels = activePair
    ? activePair.viewer.polarisations.filter((p) => activePair.channelStatus[p] === "ready")
    : [];
  const channel = readyChannels.includes(pol) ? pol : (readyChannels[0] ?? "");
  const currentSelectionKey = pairBase ? selectionKey({ ...pairBase, channel }) : null;

  polRef.current = pol;

  const layerRequest = useMemo(() => [layer], [layer]);
  const { summary, urls, rendering } = useChangeLayers(activePair, channel, layerRequest);

  const viewState = deriveViewState({
    aoi,
    searching,
    searched,
    searchError,
    sceneCount: scenes.length,
    suggestedPairCount: pairs.length,
    pairState,
    currentPairKey,
    activePair,
    summary,
  });
  const ai: AiState =
    aiEntry && aiEntry.key === currentSelectionKey ? aiEntry.state : IDLE_AI;

  // ---- invalidation ---------------------------------------------------
  const abortPairLoad = useCallback(() => {
    pairSeq.current++;
    pairAbort.current?.abort();
    pairAbort.current = null;
  }, []);

  /** Drop the loaded pair, in-flight load and explanation (not the scenes). */
  const clearPair = useCallback(() => {
    abortPairLoad();
    aiRequest.current = null;
    setPairState(IDLE_PAIR);
    setAiEntry(null);
  }, [abortPairLoad]);

  /**
   * The single entry point for every AOI change.  When the AOI actually
   * changes, one batched update drops the scene list (it belongs to the
   * previous area), role assignments, loaded pair, statistics, overlay (all
   * derived from the pair) and the explanation, and cancels in-flight search
   * and pair loads.
   */
  const commitAoi = useCallback(
    (next: Aoi, opts: { fit?: boolean } = {}) => {
      const previous = aoiRef.current;
      if (!previous || aoiKey(previous) !== aoiKey(next)) {
        aoiRef.current = next;
        searchSeq.current++;
        searchAbort.current?.abort();
        searchAbort.current = null;
        abortPairLoad();
        aiRequest.current = null;
        setAoi(next);
        setSearching(false);
        setSearched(false);
        setSearchError(null);
        setScenes([]);
        setTruncated(false);
        setSelectedSceneId(null);
        setRoleBefore(null);
        setRoleAfter(null);
        setPairState(IDLE_PAIR);
        setAiEntry(null);
      }
      if (opts.fit) setFitKey((k) => k + 1);
    },
    [abortPairLoad],
  );

  // A selection change (before/after assignment) invalidates any pair load
  // that belongs to another selection.  Display is already guarded by the key
  // check above; this releases the stale data and cancels the fetches.
  useEffect(() => {
    if (pairState.status !== "idle" && pairState.key !== currentPairKey) clearPair();
  }, [pairState, currentPairKey, clearPair]);

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
        // or searched until the user asks for it.  The first AOI frames the
        // map once; if the user already chose an area, leave everything be.
        if (!aoiRef.current) commitAoi(m.studyArea.bounds, { fit: true });
        setLocationLabel((current) => current || `${m.studyArea.name}, ${m.studyArea.country}`);
      })
      .catch(() => {
        /* the example dataset is optional; discovery works without it */
      });
    return () => {
      cancelled = true;
    };
  }, [commitAoi]);

  // ---- location and AOI handlers ------------------------------------
  const applyLocation = useCallback(
    (lat: number, lon: number, label: string) => {
      commitAoi(aoiFromCenter(lat, lon, aoiSizeKm), { fit: true });
      setLocationLabel(label);
      setLocationError(null);
    },
    [aoiSizeKm, commitAoi],
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
    commitAoi(clampAoi(drawn)); // drawing never moves the camera
    setDrawMode(false);
    setLocationLabel("Custom area of interest");
    setLocationError(null);
  }, [commitAoi]);

  const handleAoiSizeChange = useCallback(
    (km: number) => {
      setAoiSizeKm(km);
      if (aoi) {
        const [lat, lon] = aoiCenter(aoi);
        commitAoi(aoiFromCenter(lat, lon, km));
      }
    },
    [aoi, commitAoi],
  );

  const handleExample = useCallback(() => {
    if (!example) return;
    const m = example.manifest;
    commitAoi(m.studyArea.bounds, { fit: true });
    setLocationLabel(`${m.studyArea.name}, ${m.studyArea.country}`);
    setQuery(`${m.studyArea.name}`);
  }, [example, commitAoi]);

  // ---- catalogue search ---------------------------------------------
  const runSearch = useCallback(
    async (bounds: Aoi, from: string, to: string) => {
      const seq = ++searchSeq.current;
      searchAbort.current?.abort();
      const controller = new AbortController();
      searchAbort.current = controller;
      abortPairLoad(); // abandon any pair load started for the old results
      aiRequest.current = null;
      setSearching(true);
      setSearchError(null);
      setSearched(true);
      // A new search never keeps stale results or a stale comparison.
      setScenes([]);
      setSelectedSceneId(null);
      setRoleBefore(null);
      setRoleAfter(null);
      setPairState(IDLE_PAIR);
      setAiEntry(null);
      try {
        const result = await searchNisarGcov(
          {
            aoi: bounds,
            start: from || undefined,
            end: to || undefined,
          },
          controller.signal,
        );
        if (seq !== searchSeq.current) return;
        setScenes(result.scenes);
        setTruncated(result.truncated);
      } catch (err) {
        if (seq !== searchSeq.current || isAbortError(err)) return;
        setSearchError(
          err instanceof Error ? err.message : "Catalogue search failed.",
        );
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    },
    [abortPairLoad],
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
      const key = pairKey({
        aoi,
        beforeId: before.id,
        afterId: after.id,
        methodVersion: METHOD_VERSION,
      });
      abortPairLoad();
      aiRequest.current = null;
      setAiEntry(null);
      // Metadata alone can say the pair has no quicklook: no network needed.
      if (pairQuicklookStatus(before, after, example) === "metadata-only") {
        setPairState({ status: "error", key, message: METADATA_ONLY_MESSAGE, metadataOnly: true });
        return;
      }
      const seq = ++pairSeq.current;
      const controller = new AbortController();
      pairAbort.current = controller;
      // The previous pair's results are gone before the first await.
      setPairState({ status: "loading", key });
      // Channels beyond the first arrive after the pair is ready.  An update
      // can land before the awaited result is applied, so the newest
      // snapshot of this build is kept here as well.
      let latest = null as PairDataset | null;
      try {
        const dataset = await buildPairDataset({
          before,
          after,
          aoi,
          prepared: example,
          areaLabel: locationLabel || formatAoi(aoi),
          channel: polRef.current,
          signal: controller.signal,
          onChannelUpdate: (next) => {
            if (seq !== pairSeq.current) return;
            latest = next;
            setPairState((cur) =>
              cur.status === "ready" && cur.key === key && cur.dataset.instance === next.instance
                ? { ...cur, dataset: next }
                : cur,
            );
          },
        });
        if (seq !== pairSeq.current) return;
        setPairState({ status: "ready", key, dataset: latest ?? dataset });
        setPol(Object.keys(dataset.perPol)[0] ?? "");
      } catch (err) {
        if (seq !== pairSeq.current || isAbortError(err)) return;
        const metadataOnly = err instanceof RasterUnavailableError;
        if (metadataOnly) {
          setUnavailablePairs((cur) => new Set(cur).add(scenePairId(before.id, after.id)));
        }
        setPairState({
          status: "error",
          key,
          metadataOnly,
          message:
            err instanceof Error
              ? err.message
              : "The rasters for this pair could not be prepared.",
        });
      }
    },
    [aoi, example, locationLabel, abortPairLoad],
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
    if (!viewer || !summary || !currentSelectionKey) return;
    const key = currentSelectionKey;
    aiRequest.current = key;
    // A response is applied only if no newer request or invalidation replaced it.
    const settle = (state: AiState) => {
      if (aiRequest.current === key) setAiEntry({ key, state });
    };
    setAiEntry({ key, state: { status: "loading" } });
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
            polarisation: channel,
            temporalBaselineDays: viewer.temporalBaselineDays,
            earlier: viewer.earlier.startTime,
            later: viewer.later.startTime,
          },
          dataset: {
            status: viewer.status,
            unit: viewer.encoding.unit,
            limitations: viewer.limitations,
          },
          statistics: summary,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        settle({
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
        settle({
          status: "error",
          message: "Unexpected response from the explanation service.",
        });
        return;
      }
      settle({ status: "done", explanation: exp });
    } catch {
      settle({
        status: "error",
        message:
          "The explanation endpoint is not available. In local development run `vercel dev` instead of `npm run dev`.",
      });
    }
  }, [viewer, summary, channel, currentSelectionKey]);

  const handleToggleDraw = useCallback(() => setDrawMode((d) => !d), []);

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
            onToggleDraw={handleToggleDraw}
            onSearchData={handleSearchData}
            searching={searching}
            exampleLabel={example ? `${example.manifest.studyArea.name}` : null}
            onExample={handleExample}
          />

          {(searched || searching) && (
            <ResultsPanel
              scenes={scenes}
              pairs={pairs}
              metadataOnlyPairIds={metadataOnlyPairIds}
              status={viewState}
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

          {viewState.kind === "loading-raster" && (
            <div className="border-b border-app-border px-4 py-3.5 text-[11px] text-app-muted">
              Preparing rasters for the selected pair…
            </div>
          )}

          {(viewState.kind === "metadata-only" ||
            (viewState.kind === "error" && viewState.source === "pair")) && (
            <div className="border-b border-app-border px-4 py-3.5">
              <h2 className="text-[11px] font-medium tracking-[0.06em] text-app-muted uppercase">
                Comparison status
              </h2>
              <p className="mt-2 text-[11px] leading-[1.5] text-app-text">
                {viewState.message}
              </p>
            </div>
          )}

          {(viewState.kind === "ready" || viewState.kind === "no-valid-pixels") && (
            <>
              {viewState.kind === "no-valid-pixels" && (
                <div className="border-b border-app-border px-4 py-3.5 text-[11px] leading-[1.5] text-app-text">
                  No pixel is valid in both observations for this area and
                  channel, so no difference is calculated.
                </div>
              )}
              <ControlPanel
                dataset={viewState.dataset.viewer}
                channelStatus={viewState.dataset.channelStatus}
                pol={channel}
                onPolChange={setPol}
                layer={layer}
                onLayerChange={setLayer}
                computing={rendering}
              />
              <ObservationInfo
                dataset={viewState.dataset.viewer}
                pol={channel}
                summary={summary}
                ai={ai}
                onExplain={handleExplain}
              />
              <div className="mt-auto px-4 py-3 text-[10px] leading-[1.5] text-app-muted">
                {viewState.dataset.viewer.limitations[0]}
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
            pol={channel}
            overlayUrl={urls[layer] ?? null}
            overlayBounds={activePair?.bounds ?? null}
            viewer={viewer}
            fitKey={fitKey}
          />
        </main>
      </div>
    </div>
  );
}
