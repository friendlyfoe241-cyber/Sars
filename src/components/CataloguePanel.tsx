import { memo, useEffect, useMemo, useRef, useState } from "react";
import { DisclosureSection, Section } from "./ui";
import { formatDate } from "../lib/data";
import type { NisarScene } from "../lib/discovery";
import { compatibilityLabel, pairIssues, type ScenePair } from "../lib/pairing";
import { scenePairId } from "../lib/selection";
import type { ViewState } from "../lib/viewState";

interface CataloguePanelProps {
  /** Scenes step: date filter, scene list, Before / After roles.
   *  Pairs step: suggested pairs and the assigned comparison pair. */
  view: "scenes" | "pairs";
  /** jump to the other step */
  onGoTo: (step: "scenes" | "pairs") => void;
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
  return (
    <span className="rounded-full bg-white/10 px-2 font-mono text-[11px] leading-5 tracking-[0.04em] text-vx-muted uppercase">
      {maturity}
    </span>
  );
}

const ROLE_BTN = "vx-button vx-button--compact !px-3";

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
  return (
    <li
      onClick={() => onSelectScene(scene.id)}
      aria-current={isSelected ? "true" : undefined}
      className={`cursor-pointer rounded-2xl px-3 py-2 transition-colors ${
        isSelected
          ? "bg-vx-hover shadow-[inset_0_0_0_1.5px_var(--vx-flare)]"
          : "bg-white/[0.06] hover:bg-vx-hover"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="vx-mono text-[12px] text-vx-text">
          {formatDate(scene.startTime)}
          {time && <span className="text-vx-muted"> {time} UTC</span>}
        </div>
        <MaturityTag maturity={scene.maturity} />
      </div>
      <div className="truncate font-mono text-[11px] leading-[18px] text-vx-subtle" title={scene.id}>
        {scene.id}
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-[12px] leading-[18px] text-vx-muted">
          {scene.band} · {scene.polarisations.join("/")} · {scene.orbitDirection.toLowerCase()} ·{" "}
          {scene.track !== null ? `track ${scene.track}` : "track ?"}
          {scene.frame !== null ? ` · frame ${scene.frame}` : ""}
        </div>
        <div className="flex shrink-0 gap-1" role="group" aria-label="Assign role">
          <button
            type="button"
            className={ROLE_BTN}
            aria-pressed={isBefore}
            onClick={(e) => {
              e.stopPropagation();
              onAssignRole("before", scene.id);
            }}
          >
            Before
          </button>
          <button
            type="button"
            className={ROLE_BTN}
            aria-pressed={isAfter}
            onClick={(e) => {
              e.stopPropagation();
              onAssignRole("after", scene.id);
            }}
          >
            After
          </button>
        </div>
      </div>
    </li>
  );
});

function CataloguePanel({
  view,
  onGoTo,
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
}: CataloguePanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  // When a search settles, bring the relevant part of the scrolling dock into
  // view: the catalogue when there are pairs to pick, the status notice (top)
  // when there is nothing to pick or the search failed.
  const kind = status.kind;
  useEffect(() => {
    const el = rootRef.current;
    const body = el?.closest<HTMLElement>(".vx-scroll");
    if (!el || !body || body.scrollHeight <= body.clientHeight) return;
    // The sidebar is one step per view now, so the notice and the list start
    // at the top: bring that into view when a search settles.
    let top: number | null = null;
    if (kind === "choose-pair" || kind === "no-observations" || kind === "no-compatible-pair" || kind === "error") {
      top = 0;
    }
    if (top === null) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    body.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
  }, [kind]);
  const loading = status.kind === "searching";
  const error = status.kind === "error" && status.source === "search";
  const [from, setFrom] = useState(dateFrom);
  const [to, setTo] = useState(dateTo);

  const byId = useMemo(() => new Map(scenes.map((s) => [s.id, s])), [scenes]);
  const lookup = (id: string | null) => (id ? (byId.get(id) ?? null) : null);
  const beforeScene = lookup(roleBefore);
  const afterScene = lookup(roleAfter);
  const issues = useMemo(
    () => (beforeScene && afterScene ? pairIssues(beforeScene, afterScene) : []),
    [beforeScene, afterScene],
  );

  const filter = (
    <DisclosureSection
      title="Date filter"
      summary={loading ? "searching…" : dateFrom || dateTo ? `${dateFrom || "…"} to ${dateTo || "…"}` : "any date"}
    >
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="vx-from" className="vx-label">
            From
          </label>
          <input
            id="vx-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="From date"
            className="vx-input vx-mono !px-2"
          />
        </div>
        <div>
          <label htmlFor="vx-to" className="vx-label">
            To
          </label>
          <input
            id="vx-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="To date"
            className="vx-input vx-mono !px-2"
          />
        </div>
      </div>
      <button type="button" onClick={() => onApplyDates(from, to)} className="vx-button vx-button--block mt-2">
        Apply date filter
      </button>
    </DisclosureSection>
  );

  const comparison =
    beforeScene && afterScene ? (
      <Section title="Comparison pair">
        <div className="vx-mono text-[12px] leading-[18px]">
          <div>
            <span className="text-vx-muted">Before </span>
            {formatDate(beforeScene.startTime)}
          </div>
          <div>
            <span className="text-vx-muted">After&nbsp; </span>
            {formatDate(afterScene.startTime)}
          </div>
        </div>
        {issues.length > 0 ? (
          <p className="vx-note mt-2">
            Not compatible: {issues.map((i) => `${i.field} (${i.before} ≠ ${i.after})`).join(", ")}. These two
            observations cannot be compared for change.
          </p>
        ) : (
          <button
            type="button"
            onClick={() => onLoadPair(beforeScene.id, afterScene.id)}
            className="vx-button vx-button--primary vx-button--block mt-3"
          >
            Load comparison
          </button>
        )}
      </Section>
    ) : null;

  const hasScenes = !loading && !error && scenes.length > 0;

  return (
    <div ref={rootRef}>
      {view === "scenes" && filter}

      {hasScenes && view === "scenes" && (
        <>
          {truncated && (
            <div className="vx-section !pb-0">
              <p className="vx-note">
                Results are truncated by the catalogue limit; narrow the date range or area.
              </p>
            </div>
          )}
          <Section title={`Scenes · ${scenes.length}`}>
            <p className="vx-note mb-2">Mark one scene as Before and a later one as After, then load the comparison.</p>
            <ul
              className="m-0 grid max-h-[min(46vh,380px)] list-none grid-cols-[minmax(0,1fr)] gap-1.5 overflow-y-auto p-0 pr-1"
              aria-label="Catalogue scenes"
            >
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
            </ul>
          </Section>
          {comparison}
          {pairs.length > 0 && (
            <div className="vx-section">
              <button type="button" className="vx-button vx-button--block" onClick={() => onGoTo("pairs")}>
                See {Math.min(pairs.length, 3)} suggested pair{pairs.length === 1 ? "" : "s"}
              </button>
            </div>
          )}
        </>
      )}

      {hasScenes && view === "pairs" && (
        <>
          {pairs.length > 0 && (
            <Section title="Suggested pairs">
              <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-2 p-0">
                {pairs.slice(0, 3).map((pair) => {
                  const id = scenePairId(pair.before.id, pair.after.id);
                  const metadataOnly = metadataOnlyPairIds.has(id);
                  return (
                    <li
                      key={id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/[0.06] px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="vx-mono text-[12px] leading-[18px] text-vx-text">
                          {formatDate(pair.before.startTime)} → {formatDate(pair.after.startTime)}
                        </div>
                        <div className="text-[12px] leading-[18px] text-vx-muted">
                          {pair.baselineDays} d · covers {Math.round(pair.aoiCoverage * 100)}% of AOI
                        </div>
                        <div className="truncate font-mono text-[11px] leading-4 text-vx-subtle">
                          {compatibilityLabel(pair.before)}
                        </div>
                      </div>
                      {metadataOnly ? (
                        <span
                          title="Quicklook rasters are not available for this pair; only scene metadata can be shown."
                          className="shrink-0 rounded-full border border-dashed border-vx-control px-3 py-1 text-[12px] text-vx-muted"
                        >
                          Metadata only
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onLoadSuggested(pair)}
                                        className="vx-button vx-button--compact shrink-0"
                        >
                          Compare
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}
          {comparison}
          <div className="vx-section">
            <p className="vx-note mb-2">Prefer other dates? Choose Before and After yourself.</p>
            <button type="button" className="vx-button vx-button--block" onClick={() => onGoTo("scenes")}>
              Pick scenes manually
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default memo(CataloguePanel);
