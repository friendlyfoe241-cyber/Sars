import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronRight, FileJson, FileSpreadsheet, FileText, Maximize2, Minimize2 } from "lucide-react";
import { isAbortError } from "./lib/abort";
import AnalysisPanel, { type AnalysisState } from "./components/AnalysisPanel";
import {
  ANALYSIS_UNREACHABLE,
  AnalysisError,
  analysisBase,
  friendlyServiceMessage,
  prefetchAnalysis,
  submitAnalysis,
  waitForAnalysis,
  type AnalysisRequest,
  type AnalysisResult,
} from "./lib/analysisApi";
import { changeLabel, methodLabel, neutralResult } from "./lib/analysisWording";
import { downloadFile, reportCsv, reportHtml, reportJson, type ReportInput } from "./lib/exportReport";
import { DateFilter, ManualPair, PairSummary, SuggestedPairs } from "./components/Catalogue";
import ComparePanel from "./components/ComparePanel";
import ErrorBoundary from "./components/ErrorBoundary";
import MapStage from "./components/MapStage";
import MapView from "./components/MapView";
import ObservationsTable from "./components/ObservationsTable";
import ResultsTable from "./components/ResultsTable";
import TemporalGraph, { type GraphView } from "./components/TemporalGraph";
import ObservationPanel, { SceneDetails } from "./components/ObservationPanel";
import Panel from "./components/Panel";
import SearchPanel from "./components/SearchPanel";
import StateNotice from "./components/StateNotice";
import StatsPanel, { type AiExplanation, type AiState } from "./components/StatsPanel";
import AppHeader, { type ChipTone } from "./components/AppHeader";
import Hero from "./components/Hero";
import LockedStep from "./components/LockedStep";
import MapLegend from "./components/MapLegend";
import Glass, { LiquidGlassFilter } from "./components/glass/Glass";
import StepIcon from "./components/StepIcon";
import Starfield from "./components/Starfield";
import { DisclosureSection } from "./components/ui";
import { useGlassProximity } from "./hooks/useGlassProximity";
import { MOTION_MS, prefersReducedMotion, usePresence } from "./hooks/usePresence";
import { STEPS, type StepId } from "./lib/steps";
import { usePairStats } from "./lib/usePairStats";
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
  PAIR_LOAD_RETRY_MESSAGE,
  buildPairDataset,
  isTransientFailure,
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
  type DisplayChoice,
  type DisplayMode,
} from "./lib/useChangeLayers";
import {
  IDLE_PAIR,
  deriveViewState,
  selectCurrentPair,
  type PairState,
} from "./lib/viewState";

const IDLE_AI: AiState = { status: "idle" };
const IDLE_ANALYSIS: AnalysisState = { status: "idle" };
type SwapDir = "next" | "prev";
const STEP_IDS = STEPS.map((x) => x.id);
const NEXT_STEP: Record<StepId, StepId | null> = {
  locate: "scenes",
  scenes: "pairs",
  pairs: "change",
  change: "explain",
  explain: null,
};
const EXPLAIN_UNREACHABLE = "The explanation service is not reachable right now. Try again in a moment.";
const METADATA_ONLY_MESSAGE =
  "Quicklook rasters for this pair are not available. Scene metadata is shown instead of a comparison.";

function analysisFacts(result?: AnalysisResult) {
  if (!result) return null;
  return {
    eventType: changeLabel(result),
    acquisitionDates: result.acquisitionDates,
    processing: {
      eventMethod: methodLabel(result.processing.eventMethod),
      methodParameters: result.processing.methodParameters,
      unitsOfResults: result.processing.unitsOfResults,
    },
    statistics: {
      mean_difference_db: result.statistics.mean_difference_db,
      median_difference_db: result.statistics.median_difference_db,
      valid_fraction: result.statistics.valid_fraction,
    },
    areaEstimates: result.areaEstimates,
  };
}

export default function App() {
  const [example, setExample] = useState<PreparedDataset | null>(null);

  const [locationLabel, setLocationLabel] = useState("");
  const [locationError, setLocationError] = useState<string | null>(null);
  const [searchingLocation, setSearchingLocation] = useState(false);
  const [aoi, setAoi] = useState<Aoi | null>(null);
  const [aoiSizeKm, setAoiSizeKm] = useState(DEFAULT_AOI_SIZE_KM);
  const [drawMode, setDrawMode] = useState(false);
  const [fitKey, setFitKey] = useState(0);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [scenes, setScenes] = useState<NisarScene[]>([]);
  const [truncated, setTruncated] = useState(false);

  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [roleBefore, setRoleBefore] = useState<string | null>(null);
  const [roleAfter, setRoleAfter] = useState<string | null>(null);
  const [pairState, setPairState] = useState<PairState>(IDLE_PAIR);
  const [unavailablePairs, setUnavailablePairs] = useState<ReadonlySet<string>>(new Set());

  useGlassProximity();
  const [heroOpen, setHeroOpen] = useState(true);
  const [heroIntro, setHeroIntro] = useState(true);
  const hero = usePresence(heroOpen);
  const [step, setStep] = useState<StepId>("locate");
  const stepRef = useRef<StepId>("locate");
  const autoRef = useRef<StepId | null>(null);
  const [enterDir, setEnterDir] = useState<SwapDir>("next");
  const [leavingPage, setLeavingPage] = useState<{ id: StepId; dir: SwapDir } | null>(null);
  const [focusReq, setFocusReq] = useState(0);
  const [vw, setVw] = useState(() => window.innerWidth);
  const phone = vw < 768;
  const [mapExpanded, setMapExpanded] = useState(false);
  const [graphView, setGraphView] = useState<GraphView>("date");
  const [showAllFootprints, setShowAllFootprints] = useState(false);

  const [pol, setPol] = useState("");
  const [layerPick, setLayerPick] = useState<{ instance: number | null; layer: DisplayChoice }>({
    instance: null,
    layer: "compare",
  });
  const [aiEntry, setAiEntry] = useState<{ key: string; state: AiState } | null>(null);
  const [analysisEntry, setAnalysisEntry] = useState<{
    key: string;
    state: AnalysisState;
  } | null>(null);

  const searchSeq = useRef(0);
  const pairSeq = useRef(0);
  const searchAbort = useRef<AbortController | null>(null);
  const pairAbort = useRef<AbortController | null>(null);
  const aiRequest = useRef<string | null>(null);
  const analysisAbort = useRef<AbortController | null>(null);
  const aoiRef = useRef<Aoi | null>(null);
  const polRef = useRef("");

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
  const activePair = selectCurrentPair(pairState, currentPairKey);
  const viewer: ViewerDataset | null = activePair?.viewer ?? null;
  const readyChannels = activePair
    ? activePair.viewer.polarisations.filter((p) => activePair.channelStatus[p] === "ready")
    : [];
  const channel = readyChannels.includes(pol) ? pol : (readyChannels[0] ?? "");
  const currentSelectionKey = pairBase ? selectionKey({ ...pairBase, channel }) : null;

  polRef.current = pol;

  const pairInstance = activePair ? activePair.instance : null;
  const layer: DisplayChoice =
    pairInstance !== null && layerPick.instance === pairInstance ? layerPick.layer : "compare";
  const handleLayerChange = useCallback(
    (next: DisplayChoice) => setLayerPick({ instance: pairInstance, layer: next }),
    [pairInstance],
  );
  const display = useMemo<DisplayMode>(
    () =>
      layer === "compare"
        ? { mode: "swipe", left: "before", right: "after" }
        : { mode: "single", layer },
    [layer],
  );
  const layerRequest = useMemo(() => layersForDisplay(display), [display]);
  const { urls, fallbackUrl, rendering, saturation } = useChangeLayers(
    activePair,
    channel,
    layerRequest,
  );

  const [bothChannels, setBothChannels] = useState(false);
  const pairStats = usePairStats(activePair, channel, bothChannels);
  const summary = pairStats?.byChannel[channel]?.change ?? null;

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
  const pairLoaded = viewState.kind === "ready" || viewState.kind === "no-valid-pixels";
  const ai: AiState =
    aiEntry && aiEntry.key === currentSelectionKey ? aiEntry.state : IDLE_AI;
  const analysis: AnalysisState =
    analysisEntry && analysisEntry.key === currentSelectionKey
      ? analysisEntry.state
      : IDLE_ANALYSIS;

  const abortPairLoad = useCallback(() => {
    pairSeq.current++;
    pairAbort.current?.abort();
    pairAbort.current = null;
  }, []);

  const clearPair = useCallback(() => {
    abortPairLoad();
    aiRequest.current = null;
    analysisAbort.current?.abort();
    analysisAbort.current = null;
    setPairState(IDLE_PAIR);
    setAiEntry(null);
    setAnalysisEntry(null);
  }, [abortPairLoad]);

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
        analysisAbort.current?.abort();
        analysisAbort.current = null;
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
        setAnalysisEntry(null);
      }
      if (opts.fit) setFitKey((k) => k + 1);
    },
    [abortPairLoad],
  );

  useEffect(() => {
    if (pairState.status !== "idle" && pairState.key !== currentPairKey) clearPair();
  }, [pairState, currentPairKey, clearPair]);

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
        if (!aoiRef.current) commitAoi(m.studyArea.bounds, { fit: true });
        setLocationLabel((current) => current || `${m.studyArea.name}, ${m.studyArea.country}`);
      })
      .catch(() => {
      });
    return () => {
      cancelled = true;
    };
  }, [commitAoi]);

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
    commitAoi(clampAoi(drawn));
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

  const runSearch = useCallback(
    async (bounds: Aoi, from: string, to: string) => {
      const seq = ++searchSeq.current;
      searchAbort.current?.abort();
      const controller = new AbortController();
      searchAbort.current = controller;
      abortPairLoad();
      aiRequest.current = null;
      analysisAbort.current?.abort();
      analysisAbort.current = null;
      setSearching(true);
      setSearchError(null);
      setSearched(true);
      setScenes([]);
      setSelectedSceneId(null);
      setRoleBefore(null);
      setRoleAfter(null);
      setPairState(IDLE_PAIR);
      setAiEntry(null);
      setAnalysisEntry(null);
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
      analysisAbort.current?.abort();
      analysisAbort.current = null;
      setAiEntry(null);
      setAnalysisEntry(null);
      if (pairQuicklookStatus(before, after, example) === "metadata-only") {
        setPairState({ status: "error", key, message: METADATA_ONLY_MESSAGE, metadataOnly: true });
        return;
      }
      const seq = ++pairSeq.current;
      const controller = new AbortController();
      pairAbort.current = controller;
      setPairState({ status: "loading", key });
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
          message: isTransientFailure(err)
            ? PAIR_LOAD_RETRY_MESSAGE
            : err instanceof Error
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

  const handleExplain = useCallback(async () => {
    if (!viewer || !summary || !currentSelectionKey) return;
    const key = currentSelectionKey;
    aiRequest.current = key;
    const settle = (state: AiState) => {
      if (aiRequest.current === key) setAiEntry({ key, state });
    };
    setAiEntry({ key, state: { status: "loading" } });
    try {
      const payload = JSON.stringify({
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
          analysis: analysisFacts(analysis.job?.result),
        });
      let res = await fetch("/api/explain-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      }).catch(() => null);
      if (!res || res.status === 404) {
        res = await fetch(`${analysisBase()}/api/explain-change`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
        });
      }
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const raw = body && typeof body.error === "string" ? body.error : "";
        settle({
          status: "error",
          message: import.meta.env.DEV
            ? raw || `The explanation service returned HTTP ${res.status}. Run \`vercel dev\` instead of \`npm run dev\` for the /api routes.`
            : raw && !/GEMINI|API key|HTTP \d{3}/i.test(raw)
              ? raw
              : EXPLAIN_UNREACHABLE,
        });
        return;
      }
      const exp = body?.explanation as AiExplanation | undefined;
      if (
        !exp ||
        typeof exp !== "object" ||
        !["observedSignal", "possibleIndication", "limitations"].some(
          (k) => typeof (exp as unknown as Record<string, unknown>)[k] === "string",
        )
      ) {
        settle({
          status: "error",
          message: import.meta.env.DEV ? "Unexpected response from the explanation service." : EXPLAIN_UNREACHABLE,
        });
        return;
      }
      settle({
        status: "done",
        explanation: exp,
        model: typeof body?.model === "string" && body.model ? body.model : undefined,
      });
    } catch {
      settle({
        status: "error",
        message: import.meta.env.DEV
          ? "The explanation endpoint is not available. In local development run `vercel dev` instead of `npm run dev`."
          : EXPLAIN_UNREACHABLE,
      });
    }
  }, [viewer, summary, channel, currentSelectionKey, analysis]);

  const buildAnalysisRequest = useCallback((): AnalysisRequest | null => {
    if (!aoi || !viewer || !currentSelectionKey) return null;
    return {
      bbox: [aoi.west, aoi.south, aoi.east, aoi.north],
      eventType: "deforestation",
      beforeDate: viewer.earlier.startTime.slice(0, 10),
      afterDate: viewer.later.startTime.slice(0, 10),
      polarisation: channel,
      thresholdDb: 3,
      direction: "decrease",
    };
  }, [aoi, viewer, channel, currentSelectionKey]);

  const prefetchedKeys = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (step !== "explain" || analysis.status !== "idle") return;
    const request = buildAnalysisRequest();
    if (!request || !currentSelectionKey) return;
    if (prefetchedKeys.current.has(currentSelectionKey)) return;
    prefetchedKeys.current.add(currentSelectionKey);
    void prefetchAnalysis(request);
  }, [step, analysis.status, buildAnalysisRequest, currentSelectionKey]);

  const handleRunAnalysis = useCallback(async () => {
    const request = buildAnalysisRequest();
    if (!request || !currentSelectionKey) return;
    const key = currentSelectionKey;
    analysisAbort.current?.abort();
    const controller = new AbortController();
    analysisAbort.current = controller;
    const settle = (state: AnalysisState) => {
      if (analysisAbort.current === controller) setAnalysisEntry({ key, state });
    };
    settle({ status: "running", job: { analysisId: "", status: "running", progress: "submitting" } });
    try {
      const { analysisId } = await submitAnalysis(request, controller.signal);
      const job = await waitForAnalysis(
        analysisId,
        (j) => settle({ status: "running", job: j }),
        controller.signal,
      );
      if (job.status === "succeeded" && job.result) {
        settle({ status: "done", job });
      } else {
        settle({
          status: "error",
          job,
          message: friendlyServiceMessage(job.error?.code, job.error?.message),
        });
      }
    } catch (err) {
      if (isAbortError(err)) return;
      settle({
        status: "error",
        message:
          err instanceof AnalysisError
            ? err.message
            : import.meta.env.DEV && err instanceof Error
              ? `${ANALYSIS_UNREACHABLE} (${err.message})`
              : ANALYSIS_UNREACHABLE,
      });
    }
  }, [buildAnalysisRequest, currentSelectionKey]);

  const handleExport = useCallback(
    async (kind: "json" | "csv" | "report") => {
      const toDataUrl = async (url?: string) => {
        if (!url) return undefined;
        try {
          const blob = await (await fetch(url)).blob();
          return await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.readAsDataURL(blob);
          });
        } catch {
          return undefined;
        }
      };
      const result = analysis.status === "done" ? (analysis.job?.result ?? null) : null;
      const input: ReportInput = {
        title: "NISAR surface-change investigation",
        areaLabel: locationLabel || (aoi ? formatAoi(aoi) : ""),
        bbox: aoi ? [aoi.west, aoi.south, aoi.east, aoi.north] : null,
        eventLabel: result
          ? changeLabel(result)
          : "Surface change (quicklook comparison, display brightness, not calibrated)",
        pairStats,
        analysis: result ? neutralResult(result) : null,
        images:
          kind === "report"
            ? {
                before: await toDataUrl(urls.before),
                after: await toDataUrl(urls.after),
                change: await toDataUrl(urls.change),
              }
            : {},
        aiText:
          ai.status === "done" && ai.explanation ? { ...ai.explanation } : null,
        limitations: [
          ...(viewer?.limitations ?? []),
          ...(result?.limitations ?? []),
        ],
        generatedUtc: new Date().toISOString(),
      };
      if (kind === "json") {
        downloadFile("nisar-investigation.json", reportJson(input), "application/json");
      } else if (kind === "csv") {
        downloadFile("nisar-investigation.csv", reportCsv(input), "text/csv");
      } else {
        downloadFile("nisar-investigation-report.html", reportHtml(input), "text/html");
      }
    },
    [analysis, aoi, locationLabel, pairStats, urls, ai, viewer],
  );

  const handleToggleDraw = useCallback(() => setDrawMode((d) => !d), []);
  const handleFit = useCallback(() => setFitKey((k) => k + 1), []);

  const handleRetryPair = useCallback(() => {
    if (roleBefore && roleAfter) handleLoadPair(roleBefore, roleAfter);
  }, [roleBefore, roleAfter, handleLoadPair]);

  const stepAvailable: Record<StepId, boolean> = {
    locate: true,
    scenes: searched || searching,
    pairs: searched && !searching && scenes.length > 0,
    change: pairLoaded,
    explain: pairLoaded,
  };

  useEffect(() => {
    let raf = 0;
    const onResize = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setVw(window.innerWidth);
      });
    };
    window.addEventListener("resize", onResize);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const showStep = useCallback((id: StepId, opts: { fromHero?: boolean } = {}) => {
    const from = stepRef.current;
    if (from !== id) {
      const dir: SwapDir = STEP_IDS.indexOf(id) > STEP_IDS.indexOf(from) ? "next" : "prev";
      stepRef.current = id;
      setStep(id);
      setEnterDir(dir);
      setLeavingPage(opts.fromHero || prefersReducedMotion() ? null : { id: from, dir });
      setMapExpanded(false);
      if (id !== "locate") setDrawMode(false);
    }
    setFocusReq((n) => n + 1);
  }, []);
  const goTo = useCallback((id: StepId) => showStep(id), [showStep]);
  const autoStep = goTo;

  useEffect(() => {
    if (!leavingPage) return;
    const t = window.setTimeout(() => setLeavingPage(null), MOTION_MS);
    return () => window.clearTimeout(t);
  }, [leavingPage]);

  useEffect(() => {
    if (focusReq === 0) return;
    const id = requestAnimationFrame(() => {
      document.getElementById("step-heading")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [focusReq]);

  const prevSearching = useRef(false);
  useEffect(() => {
    if (searching && !prevSearching.current) {
      autoStep("scenes");
      autoRef.current = "scenes";
    }
    if (!searching && prevSearching.current && !searchError && pairs.length > 0) {
      if (stepRef.current === autoRef.current) {
        autoStep("pairs");
        autoRef.current = "pairs";
      }
    }
    prevSearching.current = searching;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searching]);
  const prevLoaded = useRef(pairLoaded);
  useEffect(() => {
    if (pairLoaded && !prevLoaded.current && (stepRef.current === autoRef.current || stepRef.current === "pairs")) {
      autoStep("change");
      autoRef.current = "change";
    }
    prevLoaded.current = pairLoaded;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairLoaded]);
  const enterFromHero = useCallback(
    (id: StepId) => {
      setHeroOpen(false);
      showStep(id, { fromHero: true });
    },
    [showStep],
  );
  const handleGlobe = useCallback(() => {
    setHeroIntro(false);
    setHeroOpen(true);
  }, []);

  const sceneById = useMemo(() => new Map(scenes.map((sc) => [sc.id, sc])), [scenes]);
  const beforeScene = (roleBefore && sceneById.get(roleBefore)) || null;
  const afterScene = (roleAfter && sceneById.get(roleAfter)) || null;
  const selectedScene = (selectedSceneId && sceneById.get(selectedSceneId)) || null;

  const metadataOnlySceneIds = useMemo(() => {
    const tally = new Map<string, { total: number; meta: number }>();
    for (const p of pairs) {
      const meta = metadataOnlyPairIds.has(scenePairId(p.before.id, p.after.id)) ? 1 : 0;
      for (const id of [p.before.id, p.after.id]) {
        const t = tally.get(id) ?? { total: 0, meta: 0 };
        t.total++;
        t.meta += meta;
        tally.set(id, t);
      }
    }
    const ids = new Set<string>();
    for (const [id, t] of tally) if (t.meta === t.total) ids.add(id);
    if (roleBefore && roleAfter) {
      const b = sceneById.get(roleBefore);
      const a = sceneById.get(roleAfter);
      if (
        unavailablePairs.has(scenePairId(roleBefore, roleAfter)) ||
        (b && a && pairQuicklookStatus(b, a, example) === "metadata-only")
      ) {
        ids.add(roleBefore);
        ids.add(roleAfter);
      }
    }
    return ids;
  }, [pairs, metadataOnlyPairIds, roleBefore, roleAfter, sceneById, unavailablePairs, example]);

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

  const stepBlurb: Record<StepId, string> = {
    locate: "Pick a place and the area to watch, then search the NISAR catalogue.",
    scenes: "NISAR passes over your area. Mark a Before and an After scene.",
    pairs: "Before and after scenes from the same orbit and track.",
    change: "Flip between before, after and the change between them.",
    explain: "Change statistics and an AI reading of what they may mean.",
  };

  const pendingNotice =
    viewState.kind === "searching" ||
    viewState.kind === "loading-raster" ||
    viewState.kind === "error" ||
    viewState.kind === "metadata-only" ||
    viewState.kind === "no-observations" ||
    viewState.kind === "no-compatible-pair";
  const stateNotice = (here: StepId) => (
    <StateNotice
      state={viewState}
      here={here}
      onNavigate={goTo}
      onRetrySearch={handleSearchData}
      onRetryPair={handleRetryPair}
      canRetryPair={Boolean(roleBefore && roleAfter)}
    />
  );
  const notice = (here: StepId) => <div className="px-5 pt-4 pb-1">{stateNotice(here)}</div>;
  const needPair = (): { id: StepId; label: string } =>
    stepAvailable.pairs
      ? { id: "pairs", label: "Choose a pair" }
      : stepAvailable.scenes
        ? { id: "scenes", label: "View scenes" }
        : { id: "locate", label: "Go to Locate" };

  const observationsTable = (
    <ObservationsTable
      status={viewState}
      scenes={scenes}
      roleBefore={roleBefore}
      roleAfter={roleAfter}
      metadataOnlyIds={metadataOnlySceneIds}
      selectedSceneId={selectedSceneId}
      locationLabel={locationLabel}
      onAssignRole={handleAssignRole}
      onSelectScene={setSelectedSceneId}
    />
  );
  const legendInline =
    viewState.kind === "ready" || viewState.kind === "no-valid-pixels" ? (
      <div className="vx-section">
        <MapLegend
          viewer={viewState.dataset.viewer}
          layer={layer === "compare" ? "compare" : layer}
          pol={channel}
          saturation={saturation}
          variant="inline"
        />
      </div>
    ) : null;

  const hasMap: Record<StepId, boolean> = {
    locate: true,
    scenes: stepAvailable.scenes,
    pairs: stepAvailable.pairs,
    change: pairLoaded,
    explain: pairLoaded,
  };

  const pageBody = (id: StepId): ReactNode => {
    const def = STEPS.find((x) => x.id === id)!;
    if (!hasMap[id]) {
      let title = "No comparison loaded";
      let cta = needPair();
      let withNotice = pendingNotice;
      if (id === "scenes") {
        title = "No scenes yet";
        cta = { id: "locate", label: "Go to Locate" };
        withNotice = false;
      } else if (id === "pairs") {
        title = "No pairs yet";
        cta = stepAvailable.scenes ? { id: "scenes", label: "View scenes" } : { id: "locate", label: "Go to Locate" };
        withNotice = stepAvailable.scenes && pendingNotice;
      }
      return (
        <div className="vx-page__content">
          <LockedStep
            step={id}
            title={title}
            message={def.locked}
            notice={withNotice ? stateNotice(id) : undefined}
            ctaLabel={cta.label}
            onCta={() => goTo(cta.id)}
          />
        </div>
      );
    }
    switch (id) {
      case "locate":
        return (
          <div className="vx-page__content">
            <Panel area="side">
              {notice("locate")}
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
                onFit={handleFit}
                dateFrom={dateFrom}
                dateTo={dateTo}
                onSearchData={handleApplyDates}
                searching={searching}
                exampleLabel={example ? `${example.manifest.studyArea.name}` : null}
                onExample={handleExample}
              />
            </Panel>
          </div>
        );
      case "scenes":
        return (
          <div className="vx-page__content">
            <Panel area="info">
              {notice("scenes")}
              <DateFilter dateFrom={dateFrom} dateTo={dateTo} searching={searching} onApply={handleApplyDates} />
              {truncated && (
                <div className="vx-section">
                  <p className="vx-note">
                    Results are truncated by the catalogue limit; narrow the date range or area.
                  </p>
                </div>
              )}
              <PairSummary
                scenes={scenes}
                roleBefore={roleBefore}
                roleAfter={roleAfter}
                onLoadPair={handleLoadPair}
                pairCount={pairs.length}
                onSeePairs={() => goTo("pairs")}
              />
              {selectedScene && <SceneDetails scene={selectedScene} />}
            </Panel>
            <Panel
              area="table"
              title="Observations"
              scroll={false}
              className="vx-panel--table"
              right={<span className="vx-panel__meta">{searching ? "searching…" : `${scenes.length} found`}</span>}
            >
              {observationsTable}
            </Panel>
          </div>
        );
      case "pairs":
        return (
          <div className="vx-page__content">
            <div className="vx-col" style={{ gridArea: "list" }}>
              <Panel
                title="Suggested pairs"
                className="vx-panel--grow"
                right={<span className="vx-panel__meta">{pairs.length} compatible</span>}
              >
                <div className="px-4 pt-1 pb-3">{stateNotice("pairs")}</div>
                <SuggestedPairs
                  pairs={pairs}
                  metadataOnlyPairIds={metadataOnlyPairIds}
                  roleBefore={roleBefore}
                  roleAfter={roleAfter}
                  onLoadSuggested={handleLoadSuggested}
                />
              </Panel>
              <Panel
                title="Choose Before and After"
                right={
                  <button type="button" className="vx-button vx-button--ghost vx-button--compact" onClick={() => goTo("scenes")}>
                    Scene table
                  </button>
                }
              >
                <ManualPair
                  scenes={scenes}
                  roleBefore={roleBefore}
                  roleAfter={roleAfter}
                  onAssignRole={handleAssignRole}
                  onLoadPair={handleLoadPair}
                />
              </Panel>
            </div>
          </div>
        );
      case "change":
        return viewState.kind === "ready" || viewState.kind === "no-valid-pixels" ? (
          <div className="vx-page__content">
            <Panel area="side">
              {viewState.kind === "no-valid-pixels" && notice("change")}
              <ComparePanel
                dataset={viewState.dataset.viewer}
                channelStatus={viewState.dataset.channelStatus}
                pol={channel}
                onPolChange={setPol}
                layer={layer}
                onLayerChange={handleLayerChange}
                canCompare={channel !== ""}
                computing={rendering}
                showAllFootprints={showAllFootprints}
                onToggleFootprints={setShowAllFootprints}
                onFit={handleFit}
                legend={legendInline}
              />
            </Panel>
          </div>
        ) : null;
      case "explain":
        return viewState.kind === "ready" || viewState.kind === "no-valid-pixels" ? (
          <div className="vx-page__content">
            <Panel area="ai">
              {viewState.kind === "no-valid-pixels" && notice("explain")}
              <ErrorBoundary key={currentSelectionKey ?? "none"} compact title="The calibrated analysis could not be shown">
                <AnalysisPanel
                  state={analysis}
                  polarisation={channel}
                  beforeDate={formatDate(viewState.dataset.viewer.earlier.startTime)}
                  afterDate={formatDate(viewState.dataset.viewer.later.startTime)}
                  onRun={handleRunAnalysis}
                />
              </ErrorBoundary>
              <StatsPanel
                dataset={viewState.dataset.viewer}
                pol={channel}
                summary={summary}
                ai={ai}
                onExplain={handleExplain}
              />
              {legendInline}
              {viewState.dataset.viewer.limitations[0] && (
                <p className="vx-note px-5 py-3">{viewState.dataset.viewer.limitations[0]}</p>
              )}
              <DisclosureSection title="Observation details">
                <ObservationPanel
                  viewer={viewer}
                  pol={channel}
                  beforeScene={beforeScene}
                  afterScene={afterScene}
                  selectedScene={selectedScene}
                  locationLabel={locationLabel}
                />
              </DisclosureSection>
              <DisclosureSection title="Export results" summary="JSON · CSV · report">
                <div className="flex flex-wrap gap-2 px-1 pb-2">
                  <button
                    type="button"
                    className="vx-button vx-button--ghost vx-button--compact"
                    onClick={() => void handleExport("json")}
                  >
                    <FileJson size={14} aria-hidden /> JSON
                  </button>
                  <button
                    type="button"
                    className="vx-button vx-button--ghost vx-button--compact"
                    onClick={() => void handleExport("csv")}
                  >
                    <FileSpreadsheet size={14} aria-hidden /> CSV
                  </button>
                  <button
                    type="button"
                    className="vx-button vx-button--ghost vx-button--compact"
                    onClick={() => void handleExport("report")}
                  >
                    <FileText size={14} aria-hidden /> Report (print to PDF)
                  </button>
                </div>
                <p className="vx-note px-1">
                  Exports contain the displayed statistics, the calibrated analysis results when
                  one has run, and the AI interpretation clearly labelled as generated.
                </p>
              </DisclosureSection>
            </Panel>
            <Panel area="results" title="Results" scroll={false} className="vx-panel--table">
              <ResultsTable
                status={viewState}
                stats={pairStats}
                channel={channel}
                both={bothChannels}
                onBoth={setBothChannels}
              />
            </Panel>
            <Panel area="graph" title="Graph" scroll={false} className="vx-panel--graph">
              <TemporalGraph
                status={viewState}
                stats={pairStats}
                channel={channel}
                view={graphView}
                onView={setGraphView}
              />
            </Panel>
          </div>
        ) : null;
    }
  };

  const renderPage = (id: StepId, current: boolean, dir: SwapDir) => {
    const def = STEPS.find((x) => x.id === id)!;
    const next = NEXT_STEP[id];
    const map = hasMap[id];
    return (
      <div
        key={id}
        className="vx-page"
        data-step={id}
        data-locked={map ? undefined : ""}
        data-enter={current ? dir : undefined}
        data-leave={current ? undefined : dir}
        data-map-expanded={current && map && mapExpanded ? "" : undefined}
        inert={!current}
        aria-hidden={current ? undefined : true}
      >
        <div className="vx-page__head">
          <span className="vx-page__icon">
            <StepIcon id={id} size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={current ? "step-heading" : undefined} tabIndex={-1} className="vx-step-heading">
              {def.label}
            </h2>
            <p className="vx-page__blurb">{stepBlurb[id]}</p>
          </div>
          {next && stepAvailable[next] && (
            <button type="button" className="vx-button vx-button--compact shrink-0" onClick={() => goTo(next)}>
              <span className="hidden sm:inline">Next:</span> {STEPS.find((x) => x.id === next)!.label}
              <ChevronRight size={16} aria-hidden />
            </button>
          )}
        </div>
        {map && <div className="vx-page__map" data-map-slot={current ? "" : undefined} />}
        <ErrorBoundary key={id}>{pageBody(id)}</ErrorBoundary>
      </div>
    );
  };

  return (
    <div className="vx-shell relative h-full overflow-hidden bg-black text-app-text" data-hero={heroOpen}>
      <LiquidGlassFilter animate={heroOpen} />

      <div className="absolute inset-0" aria-hidden="true">
        <Starfield count={110} animate={false} />
      </div>

      <div className="vx-frame" inert={heroOpen}>
        <header className="vx-frame__head">
          <h1 className="sr-only">NISAR Surface Change</h1>
          <div className="max-w-full min-w-0">
            <AppHeader
              active={step}
              available={stepAvailable}
              onPick={goTo}
              statusLabel={statusLabel}
              statusTone={statusTone}
              statusNote={statusNote}
              onGlobe={handleGlobe}
            />
          </div>
        </header>

        <main className="vx-frame__body">
          {leavingPage && renderPage(leavingPage.id, false, leavingPage.dir)}
          {renderPage(step, true, enterDir)}
          <MapStage slotKey={`${step}|${hasMap[step]}|${mapExpanded}`} heroOpen={heroOpen}>
            <MapView
              aoi={aoi}
              scenes={scenes}
              selectedSceneId={selectedSceneId}
              onSelectScene={setSelectedSceneId}
              drawMode={drawMode}
              onAoiDrawn={handleAoiDrawn}
              onPickLocation={handlePickLocation}
              pickEnabled={step === "locate"}
              display={display}
              pol={channel}
              saturation={saturation}
              urls={urls}
              pairInstance={pairInstance}
              rendering={rendering}
              fallbackUrl={fallbackUrl}
              overlayBounds={activePair?.bounds ?? null}
              viewer={viewer}
              fitKey={fitKey}
              roleBefore={roleBefore}
              roleAfter={roleAfter}
              showAllFootprints={showAllFootprints}
              showLegend={!phone && step !== "change" && step !== "explain"}
            />
            {phone && hasMap[step] && (
              <Glass
                as="button"
                type="button"
                className="lg-panel vx-stage__expand"
                aria-pressed={mapExpanded}
                aria-label="Full-height map"
                title={mapExpanded ? "Show the page below the map" : "Expand the map to full height"}
                onClick={() => setMapExpanded((v) => !v)}
              >
                {mapExpanded ? <Minimize2 size={18} aria-hidden /> : <Maximize2 size={18} aria-hidden />}
              </Glass>
            )}
          </MapStage>
        </main>
      </div>

      {hero.mounted && <Hero intro={heroIntro} leaving={hero.leaving} onEnter={enterFromHero} />}
    </div>
  );
}
