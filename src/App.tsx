import { useCallback, useEffect, useMemo, useState } from "react";
import ControlPanel from "./components/ControlPanel";
import MapView, { type DisplayLayer } from "./components/MapView";
import ObservationInfo, {
  type AiExplanation,
  type AiState,
} from "./components/ObservationInfo";
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
  rasterUrl,
  type Manifest,
} from "./lib/data";
import { loadRaster, renderChange, renderObservation } from "./lib/raster";

interface PolLayers {
  beforeUrl: string;
  afterUrl: string;
  changeUrl: string;
  summary: ChangeSummary;
}

export default function App() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pol, setPol] = useState<string>("");
  const [layer, setLayer] = useState<DisplayLayer>("change");
  const [layers, setLayers] = useState<PolLayers | null>(null);
  const [computing, setComputing] = useState(false);
  const [ai, setAi] = useState<AiState>({ status: "idle" });

  useEffect(() => {
    let cancelled = false;
    loadManifest()
      .then((m) => {
        if (cancelled) return;
        setManifest(m);
        setPol(m.acquisitionPair.polarisations[0] ?? "");
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!manifest || !pol) return;
    let cancelled = false;
    setComputing(true);
    const rasters = manifest.rasters[pol];
    if (!rasters) {
      setLayers(null);
      setComputing(false);
      return;
    }
    (async () => {
      const [before, after] = await Promise.all([
        loadRaster(rasterUrl(rasters.before)),
        loadRaster(rasterUrl(rasters.after)),
      ]);
      const beforeValues = decodeValues(before.red, manifest.encoding);
      const afterValues = decodeValues(after.red, manifest.encoding);
      const diff = computeDifference(beforeValues, afterValues);
      const summary = summarizeChange(diff, manifest.changeScale.unit);
      const next: PolLayers = {
        beforeUrl: renderObservation(before, manifest.encoding),
        afterUrl: renderObservation(after, manifest.encoding),
        changeUrl: renderChange(
          before,
          after,
          manifest.encoding,
          manifest.changeScale.saturation,
        ),
        summary,
      };
      if (!cancelled) {
        setLayers(next);
        setComputing(false);
      }
    })().catch((err: unknown) => {
      if (!cancelled) {
        setComputing(false);
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [manifest, pol]);

  const overlayUrl = useMemo(() => {
    if (!layers) return null;
    return layer === "before"
      ? layers.beforeUrl
      : layer === "after"
        ? layers.afterUrl
        : layers.changeUrl;
  }, [layers, layer]);

  const handleExplain = useCallback(async () => {
    if (!manifest || !layers) return;
    setAi({ status: "loading" });
    try {
      const res = await fetch("/api/explain-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studyArea: {
            name: manifest.studyArea.name,
            country: manifest.studyArea.country,
            phenomenon: manifest.studyArea.phenomenon,
          },
          acquisitionPair: {
            band: manifest.acquisitionPair.band,
            productType: manifest.acquisitionPair.productType,
            polarisation: pol,
            temporalBaselineDays: manifest.acquisitionPair.temporalBaselineDays,
            earlier: manifest.acquisitionPair.earlier.startTime,
            later: manifest.acquisitionPair.later.startTime,
          },
          dataset: {
            status: manifest.dataset.status,
            unit: manifest.encoding.unit,
            limitations: manifest.dataset.limitations,
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
        setAi({ status: "error", message: "Unexpected response from the explanation service." });
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
  }, [manifest, layers, pol]);

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-app-muted">
        {loadError}
      </div>
    );
  }

  if (!manifest) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-app-muted">
        Loading observation data…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-app-border bg-app-bg px-4">
        <div className="text-[13px] font-semibold tracking-[0.01em] text-app-text">
          NISAR <span className="font-normal text-app-muted">| Surface Change</span>
        </div>
        <span
          title={datasetStatusNote(manifest.dataset.status)}
          className="rounded-[3px] border border-app-border bg-white px-2 py-[3px] text-[11px] text-app-muted"
        >
          {datasetStatusLabel(manifest.dataset.status)}
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[336px] shrink-0 flex-col overflow-y-auto border-r border-app-border bg-app-bg">
          <ControlPanel
            manifest={manifest}
            pol={pol}
            onPolChange={setPol}
            layer={layer}
            onLayerChange={setLayer}
            computing={computing}
          />
          <ObservationInfo
            manifest={manifest}
            pol={pol}
            summary={layers?.summary ?? null}
            ai={ai}
            onExplain={handleExplain}
          />
          <div className="mt-auto px-4 py-3 text-[10px] leading-[1.5] text-app-muted">
            {manifest.dataset.limitations[0]}
          </div>
        </aside>

        <main className="relative min-w-0 flex-1">
          <MapView
            manifest={manifest}
            layer={layer}
            pol={pol}
            overlayUrl={overlayUrl}
          />
        </main>
      </div>
    </div>
  );
}
