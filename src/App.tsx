import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAbortError } from "./lib/abort";
import CataloguePanel from "./components/CataloguePanel";
import ComparePanel from "./components/ComparePanel";
import MapView from "./components/MapView";
import ObservationPanel from "./components/ObservationPanel";
import SearchPanel from "./components/SearchPanel";
import StateNotice from "./components/StateNotice";
import StatsPanel, { type AiExplanation, type AiState } from "./components/StatsPanel";
import TopBar, { type ChipTone } from "./components/TopBar";
import { Dock } from "./components/ui";
import { DESTINATIONS, type Dest } from "./ui/types";
import { useLayoutMode } from "./ui/useLayoutMode";
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
  formatDate,
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
import {
  layersForDisplay,
  useChangeLayers,
  type DisplayLayer,
  type DisplayMode,
} from "./lib/useChangeLayers";
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

  // ---- shell (presentation only) -------------------------------------
  const layoutMode = useLayoutMode();
  const [dest, setDest] = useState<Dest>("explore");
  const [controlsOpen, setControlsOpen] = useState(true);
  // The observation panel is open by default except where it is an overlay.
  const [detailsOpen, setDetailsOpen] = useState(layoutMode !== "mid");
  useEffect(() => setDetailsOpen(layoutMode !== "mid"), [layoutMode]);
  // With a pair loaded only its own footprints are drawn unless restored.
  const [showAllFootprints, setShowAllFootprints] = useState(false);

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

  const display = useMemo<DisplayMode>(() => ({ mode: "single", layer }), [layer]);
  const layerRequest = useMemo(() => layersForDisplay(display), [display]);
  const { summary, urls, fallbackUrl, rendering, saturation } = useChangeLayers(
    activePair,
    channel,
    layerRequest,
  );

  // Memoised on its real inputs: a fresh object every render would defeat
  // memo() on the panels that receive it.
  const sceneCount = scenes.length;
  const suggestedPairCount = pairs.length;
  const viewState = useMemo(
    () =>
      deriveViewState({
        aoi,
        searching,
        searched,
        searchError,
        sceneCount,
        suggestedPairCount,
        pairState,
        currentPairKey,
        activePair,
        summary,
      }),
    [
      aoi,
      searching,
      searched,
      searchError,
      sceneCount,
      suggestedPairCount,
      pairState,
      currentPairKey,
      activePair,
      summary,
    ],
  );
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

  const handleLocationSearch = useCallback(async (input: string) => {
    const text = input.trim();
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
  }, [applyLocation]);

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
  const handleFit = useCallback(() => setFitKey((k) => k + 1), []);
  const handleToggleControls = useCallback(() => setControlsOpen((o) => !o), []);
  const handleToggleDetails = useCallback(() => setDetailsOpen((o) => !o), []);

  const handleRetryPair = useCallback(() => {
    if (roleBefore && roleAfter) handleLoadPair(roleBefore, roleAfter);
  }, [roleBefore, roleAfter, handleLoadPair]);

  // A comparison that has just become ready opens the Compare destination.
  const previousKind = useRef(viewState.kind);
  useEffect(() => {
    const was = previousKind.current;
    const now = viewState.kind;
    previousKind.current = now;
    const loaded = (k: string) => k === "ready" || k === "no-valid-pixels";
    if (loaded(now) && !loaded(was)) setDest("compare");
  }, [viewState.kind]);

  // Scenes by role, for the observation panel (stable references).
  const sceneById = useMemo(() => new Map(scenes.map((sc) => [sc.id, sc])), [scenes]);
  const beforeScene = (roleBefore && sceneById.get(roleBefore)) || null;
  const afterScene = (roleAfter && sceneById.get(roleAfter)) || null;
  const selectedScene = (selectedSceneId && sceneById.get(selectedSceneId)) || null;

  // ---- top bar: title, context and status reflect the real selection ---
  const title = locationLabel || (aoi ? formatAoi(aoi) : "Choose a location");
  const context = viewer
    ? `${formatDate(viewer.earlier.startTime)} → ${formatDate(viewer.later.startTime)} · ${channel || "no channel"} · ${viewer.band}`
    : aoi
      ? `${formatAoi(aoi)} · no comparison loaded`
      : "No area selected";
  let statusLabel = "No comparison loaded";
  let statusTone: ChipTone = "idle";
  let statusNote = "Search for NISAR observations to load a comparison.";
  if (viewer) {
    statusLabel = datasetStatusLabel(viewer.status);
    statusTone = viewState.kind === "no-valid-pixels" ? "warn" : "ok";
    statusNote = datasetStatusNote(viewer.status);
  } else if (viewState.kind === "searching") {
    statusLabel = "Searching catalogue";
    statusTone = "busy";
  } else if (viewState.kind === "loading-raster") {
    statusLabel = "Loading comparison";
    statusTone = "busy";
  } else if (viewState.kind === "metadata-only") {
    statusLabel = "Metadata only";
    statusTone = "warn";
  } else if (viewState.kind === "error") {
    statusLabel = "Request failed";
    statusTone = "error";
  }

  const destLabel = DESTINATIONS.find((d) => d.id === dest)?.label ?? "";
  const overlayDetails = layoutMode === "wide" || layoutMode === "mid";
  const notice = (here: Dest) => (
    <div className="orb-section">
      <StateNotice
        state={viewState}
        here={here}
        onNavigate={setDest}
        onRetrySearch={handleSearchData}
        onRetryPair={handleRetryPair}
        canRetryPair={Boolean(roleBefore && roleAfter)}
      />
    </div>
  );

  let controls;
  if (dest === "explore") {
    controls = (
      <>
        {notice("explore")}
        <SearchPanel
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
          <CataloguePanel
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
      </>
    );
  } else if (viewState.kind === "ready" || viewState.kind === "no-valid-pixels") {
    controls = (
      <>
        {viewState.kind === "no-valid-pixels" && notice(dest)}
        {dest === "compare" ? (
          <ComparePanel
            dataset={viewState.dataset.viewer}
            channelStatus={viewState.dataset.channelStatus}
            pol={channel}
            onPolChange={setPol}
            layer={layer}
            onLayerChange={setLayer}
            computing={rendering}
            showAllFootprints={showAllFootprints}
            onToggleFootprints={setShowAllFootprints}
          />
        ) : (
          <StatsPanel
            dataset={viewState.dataset.viewer}
            pol={channel}
            summary={summary}
            ai={ai}
            onExplain={handleExplain}
          />
        )}
      </>
    );
  } else {
    controls = notice(dest);
  }

  return (
    <div className="orbital-theme orb-shell" data-details={detailsOpen ? "open" : "closed"}>
      <MapView
        aoi={aoi}
        scenes={scenes}
        selectedSceneId={selectedSceneId}
        onSelectScene={setSelectedSceneId}
        drawMode={drawMode}
        onAoiDrawn={handleAoiDrawn}
        onPickLocation={handlePickLocation}
        display={display}
        pol={channel}
        saturation={saturation}
        urls={urls}
        fallbackUrl={fallbackUrl}
        overlayBounds={activePair?.bounds ?? null}
        viewer={viewer}
        fitKey={fitKey}
        roleBefore={roleBefore}
        roleAfter={roleAfter}
        showAllFootprints={showAllFootprints}
      />

      <TopBar
        dest={dest}
        onDest={setDest}
        title={title}
        context={context}
        statusLabel={statusLabel}
        statusTone={statusTone}
        statusNote={statusNote}
        canFit={aoi !== null}
        onFit={handleFit}
        controlsOpen={controlsOpen}
        onToggleControls={handleToggleControls}
        detailsOpen={detailsOpen}
        onToggleDetails={handleToggleDetails}
      />

      <Dock
        id="controls"
        className="orb-left"
        eyebrow="Controls"
        title={destLabel}
        collapsed={!controlsOpen}
        onToggle={handleToggleControls}
      >
        {controls}
      </Dock>

      <Dock
        id="observation"
        className="orb-right"
        eyebrow="Details"
        title="Observation"
        collapsed={overlayDetails ? false : !detailsOpen}
        onToggle={handleToggleDetails}
        hidden={overlayDetails && !detailsOpen}
      >
        <ObservationPanel
          viewer={viewer}
          pol={channel}
          beforeScene={beforeScene}
          afterScene={afterScene}
          selectedScene={selectedScene}
          locationLabel={locationLabel}
        />
      </Dock>

      {/* Reserved grid area for the later instrument row (observations table,
          results table, time series). Empty on purpose. */}
      <div className="orb-bottom" aria-hidden />
    </div>
  );
}
