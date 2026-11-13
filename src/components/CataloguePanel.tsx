import { memo, useMemo, useState, type ReactNode } from "react";
import { Section } from "./ui";
import { formatDate, formatAcquisitionTime } from "../lib/data";
import type { NisarScene } from "../lib/discovery";
import { compatibilityLabel, pairIssues, type ScenePair } from "../lib/pairing";
import { scenePairId } from "../lib/selection";
import type { ViewState } from "../lib/viewState";

interface ResultsPanelProps {
  scenes: NisarScene[];
  pairs: ScenePair[];
  /** suggested pairs (by scenePairId) whose rasters are known to be unavailable */
  metadataOnlyPairIds: ReadonlySet<string>;
  status: ViewState;
  truncated: boolean;
  dateFrom: string;
  dateTo: string;
  onApplyDates: (from: string, to: string) => void;
  selectedSceneId: string | null;
  onSelectScene: (id: string) => void;
  roleBefore: string | null;
  roleAfter: string | null;
  onAssignRole: (role: "before" | "after", id: string) => void;
  onLoadPair: (beforeId: string, afterId: string) => void;
  onLoadSuggested: (pair: ScenePair) => void;
}

function MaturityTag({ maturity }: { maturity: string }) {
  const strong = maturity === "VALIDATED";
  return (
    <span
      className={`rounded-[2px] border px-1 py-px text-[9px] tracking-[0.04em] uppercase ${
        strong
          ? "border-app-accent/50 text-app-accent"
          : "border-app-border text-app-muted"
      }`}
    >
      {maturity}
    </span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_1fr] items-start gap-x-3 py-1">
      <div className="text-[11px] leading-[1.6] text-app-muted">{label}</div>
      <div className="min-w-0 text-[11px] leading-[1.6] text-app-text">
        {children}
      </div>
    </div>
  );
}

/**
 * One row of the scene list.  Memoised: with up to 300 results, only rows
 * whose selection or role actually changed re-render.
 */
const SceneRow = memo(function SceneRow({
  scene,
  isSelected,
  isBefore,
  isAfter,
  onSelectScene,
  onAssignRole,
}: {
  scene: NisarScene;
  isSelected: boolean;
  isBefore: boolean;
  isAfter: boolean;
  onSelectScene: (id: string) => void;
  onAssignRole: (role: "before" | "after", id: string) => void;
}) {
  const time = scene.startTime.slice(11, 16);
  const roleButton = (role: "before" | "after", label: string, active: boolean) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onAssignRole(role, scene.id);
      }}
      className={`rounded-[2px] border px-1.5 py-px text-[9px] ${
        active
          ? "border-app-accent bg-app-accent text-white"
          : "border-app-border text-app-muted hover:text-app-text"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div
      onClick={() => onSelectScene(scene.id)}
      className={`cursor-pointer rounded-[3px] border px-2 py-1.5 ${
        isSelected
          ? "border-app-accent bg-app-subtle"
          : "border-app-border bg-white hover:bg-app-subtle"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[11px] text-app-text">
          {formatDate(scene.startTime)}
          {time && <span className="text-app-muted"> {time} UTC</span>}
        </div>
        <MaturityTag maturity={scene.maturity} />
      </div>
      <div className="truncate font-mono text-[9px] leading-[1.5] text-app-muted">
        {scene.id}
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <div className="truncate text-[10px] text-app-muted">
          {scene.band} · {scene.polarisations.join("/")} ·{" "}
          {scene.orbitDirection.toLowerCase()} ·{" "}
          {scene.track !== null ? `track ${scene.track}` : "track ?"}{" "}
          {scene.frame !== null ? `· frame ${scene.frame}` : ""}
        </div>
        <div className="flex shrink-0 gap-1">
          {roleButton("before", "Before", isBefore)}
          {roleButton("after", "After", isAfter)}
        </div>
      </div>
    </div>
  );
});

function ResultsPanel({
  scenes,
  pairs,
  metadataOnlyPairIds,
  status,
  truncated,
  dateFrom,
  dateTo,
  onApplyDates,
  selectedSceneId,
  onSelectScene,
  roleBefore,
  roleAfter,
  onAssignRole,
  onLoadPair,
  onLoadSuggested,
}: ResultsPanelProps) {
  const loading = status.kind === "searching";
  const error = status.kind === "error" && status.source === "search" ? status.message : null;
  const [from, setFrom] = useState(dateFrom);
  const [to, setTo] = useState(dateTo);

  const byId = useMemo(() => new Map(scenes.map((s) => [s.id, s])), [scenes]);
  const lookup = (id: string | null) => (id ? (byId.get(id) ?? null) : null);
  const selected = lookup(selectedSceneId);
  const beforeScene = lookup(roleBefore);
  const afterScene = lookup(roleAfter);
  const issues = useMemo(
    () => (beforeScene && afterScene ? pairIssues(beforeScene, afterScene) : []),
    [beforeScene, afterScene],
  );

  return (
    <Section
      title="Search results"
      right={
        <span className="text-[10px] text-app-muted">
          {loading ? "searching…" : `${scenes.length} scenes`}
        </span>
      }
    >
      {/* date-range filter */}
      <div className="flex items-center gap-1.5">
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          aria-label="From date"
          className="min-w-0 flex-1 rounded-[3px] border border-app-border bg-white px-1.5 py-1 text-[11px] text-app-text focus:border-app-accent focus:outline-none"
        />
        <span className="text-[10px] text-app-muted">to</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          aria-label="To date"
          className="min-w-0 flex-1 rounded-[3px] border border-app-border bg-white px-1.5 py-1 text-[11px] text-app-text focus:border-app-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={() => onApplyDates(from, to)}
          className="rounded-[3px] border border-app-border bg-white px-2 py-1 text-[11px] text-app-text hover:bg-app-subtle"
        >
          Apply
        </button>
      </div>

      {loading && (
        <p className="mt-2 text-[11px] text-app-muted">
          Searching the NISAR catalogue…
        </p>
      )}
      {error && <p className="mt-2 text-[11px] text-app-text">{error}</p>}

      {status.kind === "no-observations" && (
        <p className="mt-2 text-[11px] leading-[1.5] text-app-muted">
          No NISAR observations found for this area and date range.
        </p>
      )}

      {!loading && !error && scenes.length > 0 && (
        <>
          {truncated && (
            <p className="mt-2 text-[10px] text-app-muted">
              Results are truncated by the catalogue limit; narrow the date
              range or area.
            </p>
          )}

          {/* suggested compatible pairs */}
          {pairs.length > 0 && (
            <div className="mt-2.5">
              <div className="text-[10px] font-medium tracking-[0.04em] text-app-muted uppercase">
                Suggested pairs
              </div>
              <div className="mt-1 space-y-1">
                {pairs.slice(0, 3).map((pair) => {
                  const id = scenePairId(pair.before.id, pair.after.id);
                  const metadataOnly = metadataOnlyPairIds.has(id);
                  return (
                  <div
                    key={id}
                    className="flex items-center justify-between gap-2 rounded-[3px] border border-app-border px-2 py-1.5"
                  >
                    <div className="min-w-0">
                      <div className="text-[11px] text-app-text">
                        {formatDate(pair.before.startTime)} →{" "}
                        {formatDate(pair.after.startTime)}
                        <span className="text-app-muted">
                          {" "}
                          · {pair.baselineDays} d · covers{" "}
                          {Math.round(pair.aoiCoverage * 100)}% of AOI
                        </span>
                      </div>
                      <div className="truncate text-[9px] text-app-muted">
                        {compatibilityLabel(pair.before)}
                      </div>
                    </div>
                    {metadataOnly ? (
                      <span
                        title="Quicklook rasters are not available for this pair; only scene metadata can be shown."
                        className="shrink-0 rounded-[3px] border border-app-border px-2 py-1 text-[11px] text-app-muted"
                      >
                        Metadata only
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onLoadSuggested(pair)}
                        className="shrink-0 rounded-[3px] border border-app-border bg-white px-2 py-1 text-[11px] text-app-accent hover:bg-app-subtle"
                      >
                        Compare
                      </button>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          )}

          {status.kind === "no-compatible-pair" && (
            <p className="mt-2.5 text-[11px] leading-[1.5] text-app-muted">
              Not enough compatible observations for change comparison in this
              area and date range — at least two acquisitions with matching
              band, product type, polarisation, orbit and processing are
              required. Individual observations can still be inspected below.
            </p>
          )}

          {/* scene list */}
          <div className="mt-2.5 max-h-[236px] space-y-1 overflow-y-auto pr-0.5">
            {scenes.map((scene) => (
              <SceneRow
                key={scene.id}
                scene={scene}
                isSelected={scene.id === selectedSceneId}
                isBefore={scene.id === roleBefore}
                isAfter={scene.id === roleAfter}
                onSelectScene={onSelectScene}
                onAssignRole={onAssignRole}
              />
            ))}
          </div>

          {/* pair assembly */}
          {beforeScene && afterScene && (
            <div className="mt-2.5 rounded-[3px] border border-app-border px-2 py-2">
              <div className="text-[10px] font-medium tracking-[0.04em] text-app-muted uppercase">
                Comparison pair
              </div>
              <div className="mt-1 text-[11px] leading-[1.5] text-app-text">
                Before: {formatDate(beforeScene.startTime)}
                <br />
                After: {formatDate(afterScene.startTime)}
              </div>
              {issues.length > 0 ? (
                <div className="mt-1.5 text-[10px] leading-[1.5] text-app-muted">
                  Not compatible:{" "}
                  {issues
                    .map((i) => `${i.field} (${i.before} ≠ ${i.after})`)
                    .join(", ")}
                  . These two observations cannot be compared for change.
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onLoadPair(beforeScene.id, afterScene.id)}
                  className="mt-1.5 w-full rounded-[3px] border border-app-accent bg-app-accent px-2 py-1.5 text-[12px] text-white hover:opacity-90"
                >
                  Load comparison
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* selected scene metadata */}
      {selected && (
        <div className="mt-2.5 border-t border-app-border pt-2">
          <div className="text-[10px] font-medium tracking-[0.04em] text-app-muted uppercase">
            Scene metadata
          </div>
          <div className="mt-1">
            <Row label="Product ID">{selected.id}</Row>
            <Row label="Acquired">
              {formatAcquisitionTime(selected.startTime)} –{" "}
              {selected.stopTime.slice(11, 16)} UTC
            </Row>
            <Row label="Sensor band">
              {selected.band} · {selected.productType} ·{" "}
              {selected.polarisations.join("/")}
            </Row>
            <Row label="Processing">
              {selected.collection} · {selected.maturity}
              {selected.crid ? ` · CRID ${selected.crid}` : ""}
              {selected.pgeVersion ? ` · ${selected.pgeVersion}` : ""}
            </Row>
            <Row label="Geometry">
              {selected.orbitDirection.toLowerCase()}
              {selected.orbit !== null ? ` · orbit ${selected.orbit}` : ""}
              {selected.track !== null ? ` · track ${selected.track}` : ""}
              {selected.frame !== null ? ` · frame ${selected.frame}` : ""}
            </Row>
            <Row label="Raster">
              Metadata and quicklook browse available; calibrated raster not
              prepared for this scene
            </Row>
            {selected.downloadUrl && (
              <Row label="Access">
                <a
                  href={selected.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-app-accent underline decoration-app-border underline-offset-2 hover:decoration-app-accent"
                >
                  Product download (Earthdata login required)
                </a>
              </Row>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

export default memo(ResultsPanel);
