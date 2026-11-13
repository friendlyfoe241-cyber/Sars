import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, ChevronUp, PanelLeftClose, Pin, PinOff } from "lucide-react";
import { isAbortError } from "./lib/abort";
import CataloguePanel from "./components/CataloguePanel";
import ComparePanel from "./components/ComparePanel";
import InstrumentDock, { type InstrumentTab } from "./components/InstrumentDock";
import MapView from "./components/MapView";
import ObservationsTable from "./components/ObservationsTable";
import ResultsTable from "./components/ResultsTable";
import TemporalGraph, { type GraphView } from "./components/TemporalGraph";
import ObservationPanel from "./components/ObservationPanel";
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
import { usePresence } from "./hooks/usePresence";
import { LAYOUT_EVENT } from "./lib/freeArea";
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
  loadManifest,
  type PreparedDataset,
  type ViewerDataset,
} from "./lib/data";
import { searchNisarGcov, type NisarScene } from "./lib/discovery";
import { formatSigned } from "./lib/format";
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
const PIN_KEY = "vx.panelPinned";
function readPinned(): boolean {
  try {
    return window.localStorage.getItem(PIN_KEY) === "1";
  } catch {
    return false;
  }
}
function writePinned(on: boolean) {
  try {
    window.localStorage.setItem(PIN_KEY, on ? "1" : "0");
  } catch {
    /* storage unavailable: the choice lasts for this visit only */
  }
}
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
  useGlassProximity();
  // The hero is an overlay: the workspace (and its data loading) is mounted
  // underneath from the first render.
  const [heroOpen, setHeroOpen] = useState(true);
  const [heroIntro, setHeroIntro] = useState(true);
  const hero = usePresence(heroOpen);
  const [step, setStep] = useState<StepId>("locate");
  const stepRef = useRef<StepId>("locate");
  // the step auto-advance last put the user on (null once they navigate away)
  const autoRef = useRef<StepId | null>(null);
  const [vw, setVw] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [headerBottom, setHeaderBottom] = useState(88);
  const headerRef = useRef<HTMLDivElement>(null);
  const phone = vw.w < 768;
  // Step panel.  Tucked into a slim edge tab by default; it comes back as a
  // "peek" overlay (edge tab, step rail, hero, auto-advance, a state that
  // needs attention) that tucks again on map interaction or Escape, or stays
  // put while pinned.  Only a pinned panel takes room from the map.  Phones
  // have no pin: the bottom sheet is collapsed to its header bar or peeking.
  const [pinned, setPinned] = useState(readPinned);
  const [peek, setPeek] = useState(false);
  const isPinned = pinned && !phone;
  const panelOpen = isPinned || peek;
  const panel = usePresence(panelOpen);
  // direction of the content slide when the step changes inside an open panel
  const [swapDir, setSwapDir] = useState<"next" | "prev" | null>(null);
  // a request to focus the step heading (user-opened) or the opener (tucked)
  const [focusReq, setFocusReq] = useState<{ n: number; to: "heading" | "opener" }>({ n: 0, to: "heading" });
  const openerRef = useRef<HTMLElement | null>(null);
  const panelOpenRef = useRef(panelOpen);
  panelOpenRef.current = panelOpen;
  const peekOnlyRef = useRef(false);
  peekOnlyRef.current = panelOpen && !isPinned;
  // Instrument dock (observations / results / graph): a glass bar along the
  // bottom of the free map area, collapsed to its tab bar until the user
  // opens it (loading a pair does not open it).
  const [instrChoice, setInstrChoice] = useState<boolean | null>(null);
  const [instrTab, setInstrTab] = useState<InstrumentTab>("observations");
  const [graphView, setGraphView] = useState<GraphView>("date");
  // With a pair loaded only its own footprints are drawn unless restored.
  const [showAllFootprints, setShowAllFootprints] = useState(false);

  // ---- viewer --------------------------------------------------------
  const [pol, setPol] = useState("");
  // The display choice belongs to the loaded pair build: a new pair (or none)
  // starts in Compare again.
  const [layerPick, setLayerPick] = useState<{ instance: number | null; layer: DisplayChoice }>({
    instance: null,
    layer: "compare",
  });
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

  // One set of statistics per channel, shared by the left panel, the results
  // table and the graph.  Other channels are only computed for side by side.
  const [bothChannels, setBothChannels] = useState(false);
  const pairStats = usePairStats(activePair, channel, bothChannels);
  const summary = pairStats?.byChannel[channel]?.change ?? null;

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
  const pairLoaded = viewState.kind === "ready" || viewState.kind === "no-valid-pixels";
  const instrOpen = instrChoice ?? false;
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

  // A map click while a peek is open only tucks the peek: it is consumed and
  // never also moves the area of interest.
  const handlePickLocation = useCallback(
    (lat: number, lon: number) => {
      if (peekOnlyRef.current) {
        setPeek(false);
        return;
      }
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
  const handleToggleInstruments = useCallback(() => {
    setInstrChoice(!instrOpen);
  }, [instrOpen]);
  const handleOpenInstrument = useCallback((tab: InstrumentTab) => {
    setInstrTab(tab);
    setInstrChoice(true);
  }, []);
  const handleShowResults = useCallback(() => {
    setInstrChoice(true);
    setInstrTab("results");
    window.setTimeout(() => {
      const el = document.getElementById("instrument-results");
      el?.scrollIntoView({ block: "nearest" });
      el?.focus({ preventScroll: true });
    }, 60);
  }, []);

  const handleRetryPair = useCallback(() => {
    if (roleBefore && roleAfter) handleLoadPair(roleBefore, roleAfter);
  }, [roleBefore, roleAfter, handleLoadPair]);

  // ---- step navigation ------------------------------------------------
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
        setVw({ w: window.innerWidth, h: window.innerHeight });
      });
    };
    window.addEventListener("resize", onResize);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // The sidebar sits just under the floating header, whatever its height.
  // Layout box, not getBoundingClientRect: the header enters with a transform.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => setHeaderBottom(el.offsetTop + el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /**
   * Show step `id` in the panel.  `user`: the user asked for it (edge tab, step
   * rail, hero, a notice's link): focus moves to the step heading.  Otherwise
   * (auto-advance, a state that needs attention) the panel opens as a peek
   * and focus stays where it is.
   */
  const showStep = useCallback((id: StepId, user: boolean) => {
    const from = stepRef.current;
    const ids = STEPS.map((x) => x.id);
    // slide the content sideways only when the step changes inside an open panel
    setSwapDir(panelOpenRef.current && from !== id ? (ids.indexOf(id) > ids.indexOf(from) ? "next" : "prev") : null);
    stepRef.current = id;
    setStep(id);
    setPeek(true);
    if (user) {
      const ae = document.activeElement;
      if (ae instanceof HTMLElement && !ae.closest("#step-panel")) openerRef.current = ae;
      setFocusReq((f) => ({ n: f.n + 1, to: "heading" }));
    }
  }, []);
  const autoStep = useCallback((id: StepId) => showStep(id, false), [showStep]);
  const goTo = useCallback((id: StepId) => showStep(id, true), [showStep]);
  const handleOpenPanel = useCallback(() => showStep(stepRef.current, true), [showStep]);

  /** Tuck the panel away (unpinning it); focus returns to the opener or edge tab. */
  const tuckPanel = useCallback(
    (restoreFocus: boolean) => {
      // the phone sheet has no pin: collapsing it keeps the desktop choice
      if (!phone) {
        setPinned(false);
        writePinned(false);
      }
      setPeek(false);
      if (restoreFocus) setFocusReq((f) => ({ n: f.n + 1, to: "opener" }));
    },
    [phone],
  );
  const handleTogglePin = useCallback(() => {
    const next = !pinned;
    setPinned(next);
    writePinned(next);
    // unpinning leaves it open as a peek; pinning refits the map beside it
    setPeek(true);
    if (next) setFitKey((k) => k + 1);
  }, [pinned]);
  // Map drag (or the click consumed in handlePickLocation) tucks a peek.
  const handleMapInteract = useCallback(() => {
    if (peekOnlyRef.current) setPeek(false);
  }, []);

  useEffect(() => {
    if (focusReq.n === 0) return;
    const id = requestAnimationFrame(() => {
      if (focusReq.to === "heading") {
        document.getElementById("step-heading")?.focus({ preventScroll: true });
        return;
      }
      const opener = openerRef.current;
      openerRef.current = null;
      const target =
        opener && opener.isConnected && !opener.closest("[inert]")
          ? opener
          : document.getElementById(phone ? "step-heading-toggle" : "step-edge-tab");
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusReq]);

  // Escape tucks a peek (never a pinned panel).
  useEffect(() => {
    if (heroOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || !peekOnlyRef.current) return;
      tuckPanel(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [heroOpen, tuckPanel]);

  // Walk the user forward as the workflow progresses: a search starts ->
  // Scenes; compatible pairs found -> Pairs; a pair is ready -> Change.  Each
  // opens as a peek so the result is seen; map interaction tucks it again.
  const prevSearching = useRef(false);
  useEffect(() => {
    if (searching && !prevSearching.current) {
      autoStep("scenes");
      autoRef.current = "scenes";
    }
    if (!searching && prevSearching.current && !searchError && pairs.length > 0) {
      // only if the user is still where auto-advance left them
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
  // A state that needs attention (failed search, nothing found, pair failed
  // or metadata only) is shown in the panel: never leave it tucked away.
  const attention =
    viewState.kind === "error" || viewState.kind === "no-observations" || viewState.kind === "metadata-only";
  useEffect(() => {
    if (attention) setPeek(true);
  }, [attention, viewState.kind]);

  const enterFromHero = useCallback(
    (id: StepId) => {
      setHeroOpen(false);
      showStep(id, true);
    },
    [showStep],
  );
  const handleGlobe = useCallback(() => {
    setHeroIntro(false);
    setHeroOpen(true);
  }, []);

  // Scenes by role, for the observation panel (stable references).
  const sceneById = useMemo(() => new Map(scenes.map((sc) => [sc.id, sc])), [scenes]);
  const beforeScene = (roleBefore && sceneById.get(roleBefore)) || null;
  const afterScene = (roleAfter && sceneById.get(roleAfter)) || null;
  const selectedScene = (selectedSceneId && sceneById.get(selectedSceneId)) || null;

  // ---- instrument row: derived from the same key-gated active pair ------
  // Scenes known to lack usable rasters: every suggested pair containing the
  // scene is metadata-only, or the selected pair is known unavailable.
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
  const instrSummaries: Record<InstrumentTab, string> = {
    observations: searching
      ? "searching…"
      : scenes.length > 0
        ? `${scenes.length} scene${scenes.length === 1 ? "" : "s"}`
        : searched
          ? "none found"
          : "no search yet",
    results:
      viewState.kind === "ready" && summary
        ? `${channel} median ${formatSigned(summary.median)} ${summary.unit}`
        : viewState.kind === "loading-raster"
          ? "loading…"
          : "no comparison",
    graph:
      viewState.kind === "ready" && pairStats
        ? `${pairStats.acquisitions.length} acquisitions`
        : viewState.kind === "loading-raster"
          ? "loading…"
          : "no comparison",
  };
  // The dock appears with the first search; it is the only way to the tables
  // and the graph on larger screens.  On phones the same content is inline in
  // the Change and Explain steps instead.
  const showDock = !phone && (searched || searching || pairLoaded);
  const rowVisible = showDock && instrOpen;

  // ---- header status reflects the real selection -----------------------
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

  // ---- panel geometry ------------------------------------------------------
  // Desktop: a column under the header along the left edge.  Phone: a bottom
  // sheet whose collapsed state shows only its 64px header bar.
  const SHEET_BAR = 64;
  const sidebarW = phone ? vw.w - 24 : Math.min(400, Math.max(320, Math.round(vw.w * 0.3)));
  const panelTop = phone ? Math.max(headerBottom + 12, vw.h * 0.45) : headerBottom + 12;
  const panelRect = {
    l: phone ? 12 : 16,
    t: panelTop,
    w: sidebarW,
    h: Math.max(phone ? SHEET_BAR : 200, vw.h - panelTop - 16),
  };
  const dockLeft = isPinned ? panelRect.l + panelRect.w + 16 : 16;
  // Tells the map (fit padding, divider range, legend and controls) that a
  // surface moved or changed size without the map seeing a resize.  A peek
  // overlays the map and is not part of it.
  const layoutKey = [
    isPinned ? `${Math.round(panelRect.t)}:${Math.round(panelRect.w)}:${Math.round(panelRect.h)}` : "-",
    Math.round(headerBottom),
    phone ? `p${Math.round(vw.h)}` : "d",
    showDock ? (rowVisible ? "o" : "c") : "-",
  ].join("|");
  useEffect(() => {
    window.dispatchEvent(new Event(LAYOUT_EVENT));
  }, [layoutKey, heroOpen]);

  const stepDef = STEPS.find((x) => x.id === step)!;
  const stepBlurb: Record<StepId, string> = {
    locate: "Pick a place and the area to watch.",
    scenes: "NISAR passes over your area.",
    pairs: "Before and after scenes from the same orbit and track.",
    change: "Flip between before, after and the change between them.",
    explain: "Change statistics and an AI reading of what they may mean.",
  };

  // States worth a notice in the steps that cannot show their content yet.
  const pendingNotice =
    viewState.kind === "searching" ||
    viewState.kind === "loading-raster" ||
    viewState.kind === "error" ||
    viewState.kind === "metadata-only" ||
    viewState.kind === "no-observations" ||
    viewState.kind === "no-compatible-pair";
  const notice = (here: StepId) => (
    <div className="px-5 pt-3 pb-1">
      <StateNotice
        state={viewState}
        here={here}
        onNavigate={goTo}
        onRetrySearch={handleSearchData}
        onRetryPair={handleRetryPair}
        canRetryPair={Boolean(roleBefore && roleAfter)}
      />
    </div>
  );
  const locked = (message: string, cta: { id: StepId; label: string }) => (
    <LockedStep step={step} message={message} ctaLabel={cta.label} onCta={() => goTo(cta.id)} />
  );
  const needPair = (): { id: StepId; label: string } =>
    stepAvailable.pairs
      ? { id: "pairs", label: "Choose a pair" }
      : stepAvailable.scenes
        ? { id: "scenes", label: "View scenes" }
        : { id: "locate", label: "Go to Locate" };

  const catalogueProps = {
    scenes,
    pairs,
    metadataOnlyPairIds,
    status: viewState,
    truncated,
    dateFrom,
    dateTo,
    onApplyDates: handleApplyDates,
    selectedSceneId,
    onSelectScene: setSelectedSceneId,
    roleBefore,
    roleAfter,
    onAssignRole: handleAssignRole,
    onLoadPair: handleLoadPair,
    onLoadSuggested: handleLoadSuggested,
  };
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
  const resultsTable = (
    <ResultsTable
      status={viewState}
      stats={pairStats}
      channel={channel}
      both={bothChannels}
      onBoth={setBothChannels}
    />
  );
  const temporalGraph = (
    <TemporalGraph
      status={viewState}
      stats={pairStats}
      channel={channel}
      view={graphView}
      onView={setGraphView}
    />
  );

  const phoneInstruments = phone && pairLoaded && (
    <div className="px-5 pb-4">
      <h3 className="vx-section__title">Tables and graph</h3>
      <InstrumentDock
        variant="inline"
        open
        onToggle={handleToggleInstruments}
        tab={instrTab}
        onTab={setInstrTab}
        onOpenTab={handleOpenInstrument}
        summaries={instrSummaries}
        observations={observationsTable}
        results={resultsTable}
        graph={temporalGraph}
      />
    </div>
  );

  let stepBody: ReactNode;
  switch (step) {
    case "locate":
      stepBody = (
        <>
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
            onSearchData={handleSearchData}
            searching={searching}
            exampleLabel={example ? `${example.manifest.studyArea.name}` : null}
            onExample={handleExample}
          />
        </>
      );
      break;
    case "scenes":
      stepBody = stepAvailable.scenes ? (
        <>
          {notice("scenes")}
          <CataloguePanel view="scenes" onGoTo={goTo} {...catalogueProps} />
          {selectedScene && (
            <DisclosureSection title="Selected scene">
              <ObservationPanel
                viewer={viewer}
                pol={channel}
                beforeScene={beforeScene}
                afterScene={afterScene}
                selectedScene={selectedScene}
                locationLabel={locationLabel}
              />
            </DisclosureSection>
          )}
        </>
      ) : (
        locked(stepDef.locked, { id: "locate", label: "Go to Locate" })
      );
      break;
    case "pairs":
      stepBody = stepAvailable.pairs ? (
        <>
          {notice("pairs")}
          <CataloguePanel view="pairs" onGoTo={goTo} {...catalogueProps} />
        </>
      ) : stepAvailable.scenes ? (
        // searching, failed, or nothing found: the notice says which
        notice("pairs")
      ) : (
        locked(stepDef.locked, { id: "locate", label: "Go to Locate" })
      );
      break;
    case "change":
      stepBody =
        viewState.kind === "ready" || viewState.kind === "no-valid-pixels" ? (
          <>
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
            />
            {phone && (
              <div className="px-5 pb-4">
                <MapLegend
                  viewer={viewState.dataset.viewer}
                  layer={layer === "compare" ? "compare" : layer}
                  pol={channel}
                  saturation={saturation}
                  variant="inline"
                />
              </div>
            )}
            {phoneInstruments}
          </>
        ) : (
          <>
            {pendingNotice && notice("change")}
            {locked(stepDef.locked, needPair())}
          </>
        );
      break;
    case "explain":
      stepBody =
        viewState.kind === "ready" || viewState.kind === "no-valid-pixels" ? (
          <>
            {viewState.kind === "no-valid-pixels" && notice("explain")}
            <StatsPanel
              dataset={viewState.dataset.viewer}
              pol={channel}
              summary={summary}
              statsInRow={rowVisible}
              onShowResults={handleShowResults}
              ai={ai}
              onExplain={handleExplain}
            />
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
            {phoneInstruments}
          </>
        ) : (
          <>
            {pendingNotice && notice("explain")}
            {locked(stepDef.locked, needPair())}
          </>
        );
      break;
  }

  const sheetCollapsed = phone && !panelOpen;
  const stepHeader = (
    <div className={`flex items-center gap-3 pr-3 pl-5 ${sheetCollapsed ? "min-h-[64px] py-2" : "pt-4 pb-1"}`}>
      <span className="text-app-flare">
        <StepIcon id={step} size={20} />
      </span>
      <div key={step} className="vx-swap min-w-0 flex-1" data-dir={swapDir ?? undefined}>
        <h2 id="step-heading" tabIndex={-1} className="vx-step-heading">{stepDef.label}</h2>
        {!sheetCollapsed && <p className="m-0 text-[12px] leading-[18px] text-app-muted">{stepBlurb[step]}</p>}
      </div>
      {phone ? (
        <button
          type="button"
          id="step-heading-toggle"
          className="vx-button vx-button--ghost vx-button--compact shrink-0 !px-3"
          aria-expanded={!sheetCollapsed}
          aria-controls={sheetCollapsed ? undefined : "step-panel-body"}
          onClick={() => (sheetCollapsed ? handleOpenPanel() : tuckPanel(true))}
          aria-label={sheetCollapsed ? `Show ${stepDef.label} panel` : "Hide panel to see the map"}
        >
          {sheetCollapsed ? <ChevronUp size={18} aria-hidden /> : <ChevronDown size={18} aria-hidden />}
        </button>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="vx-icon-button"
            aria-pressed={isPinned}
            aria-label="Keep panel open"
            title={isPinned ? "Unpin: the panel tucks away when you use the map" : "Pin: keep the panel open beside the map"}
            onClick={handleTogglePin}
          >
            {isPinned ? <PinOff size={18} aria-hidden /> : <Pin size={18} aria-hidden />}
          </button>
          <button
            type="button"
            className="vx-icon-button"
            aria-label="Tuck panel away"
            title="Tuck the panel into the left edge"
            onClick={() => tuckPanel(true)}
          >
            <PanelLeftClose size={18} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
  const panelBody = (
    <div id="step-panel-body" key={step} className="vx-swap" data-dir={swapDir ?? undefined}>
      {stepBody}
    </div>
  );

  return (
    <div
      className="vx-shell relative h-full overflow-hidden bg-black text-app-text"
      data-hero={heroOpen}
      style={{ ["--vx-dock-left" as string]: `${dockLeft}px` }}
    >
      <LiquidGlassFilter animate={heroOpen} />

      {/* deep space behind a full-bleed map */}
      <div className="absolute inset-0" aria-hidden="true">
        <Starfield count={110} animate={false} nebula={false} />
      </div>
      <main className="vx-map-host absolute inset-0" inert={heroOpen}>
        <MapView
          aoi={aoi}
          scenes={scenes}
          selectedSceneId={selectedSceneId}
          onSelectScene={setSelectedSceneId}
          drawMode={drawMode}
          onAoiDrawn={handleAoiDrawn}
          onPickLocation={handlePickLocation}
          onUserInteract={handleMapInteract}
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
          layoutKey={layoutKey}
          roleBefore={roleBefore}
          roleAfter={roleAfter}
          showAllFootprints={showAllFootprints}
          showLegend={!phone}
        />
      </main>

      {/* floating glass header: a centred pill that hugs its contents */}
      <div
        ref={headerRef}
        className="pointer-events-none absolute top-4 right-4 left-4 z-[1001] flex justify-center"
        inert={heroOpen}
      >
        <h1 className="sr-only">NISAR Surface Change</h1>
        <div data-cover="top" className="pointer-events-auto max-w-full min-w-0">
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
      </div>

      {/* What the map measures for the panel: only a pinned panel (desktop)
          or the phone sheet's header bar takes room from the map. */}
      {(isPinned || phone) && (
        <div
          aria-hidden="true"
          data-cover={phone ? "bottom" : "left"}
          style={{
            position: "absolute",
            left: panelRect.l,
            top: phone ? vw.h - 16 - SHEET_BAR : panelRect.t,
            width: panelRect.w,
            height: phone ? SHEET_BAR : panelRect.h,
            visibility: "hidden",
            pointerEvents: "none",
          }}
        />
      )}

      {/* step panel: slides in from the left edge (phones: a bottom sheet) */}
      <div inert={heroOpen}>
        {phone ? (
          <div
            className="vx-sheet absolute z-[1000]"
            style={{
              left: panelRect.l,
              top: panelRect.t,
              width: panelRect.w,
              height: panelRect.h,
              transform: sheetCollapsed ? `translate3d(0, ${panelRect.h - SHEET_BAR}px, 0)` : undefined,
            }}
          >
            <Glass as="aside" id="step-panel" aria-label={`${stepDef.label} panel`} className="lg-panel vx-side vx-in-bottom rounded-[28px]">
              <div className="flex h-full flex-col">
                {stepHeader}
                {!sheetCollapsed && <div className="vx-scroll min-h-0 flex-1">{panelBody}</div>}
              </div>
            </Glass>
          </div>
        ) : panel.mounted ? (
          <Glass
            as="aside"
            id="step-panel"
            aria-label={`${stepDef.label} panel`}
            data-pinned={isPinned || undefined}
            className={`lg-panel vx-side absolute z-[1000] rounded-[28px] ${panel.leaving ? "vx-out-left" : "vx-in-left"}`}
            style={{ left: panelRect.l, top: panelRect.t, width: panelRect.w, height: panelRect.h }}
            inert={panel.leaving}
          >
            <div className="flex h-full flex-col">
              {stepHeader}
              <div className="vx-scroll min-h-0 flex-1">{panelBody}</div>
            </div>
          </Glass>
        ) : null}
        {!phone && !panelOpen && (
          <Glass
            as="button"
            type="button"
            id="step-edge-tab"
            className="lg-panel vx-edge-tab vx-in-left"
            aria-label={`Show ${stepDef.label} panel`}
            aria-expanded={false}
            title={`Show ${stepDef.label}`}
            onClick={handleOpenPanel}
          >
            <span className="flex flex-col items-center gap-2">
              <StepIcon id={step} size={20} />
              <ChevronRight size={16} aria-hidden />
            </span>
          </Glass>
        )}
      </div>

      {showDock && (
        <InstrumentDock
          variant="dock"
          open={instrOpen}
          onToggle={handleToggleInstruments}
          tab={instrTab}
          onTab={setInstrTab}
          onOpenTab={handleOpenInstrument}
          summaries={instrSummaries}
          observations={observationsTable}
          results={resultsTable}
          graph={temporalGraph}
          inert={heroOpen}
        />
      )}

      {hero.mounted && <Hero intro={heroIntro} leaving={hero.leaving} onEnter={enterFromHero} />}
    </div>
  );
}
