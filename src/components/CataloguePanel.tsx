import { memo, useEffect, useMemo, useRef, useState } from "react";
import { DisclosureSection, Section } from "./ui";
import { formatDate } from "../lib/data";
import type { NisarScene } from "../lib/discovery";
import { compatibilityLabel, pairIssues, type ScenePair } from "../lib/pairing";
import { scenePairId } from "../lib/selection";
import type { ViewState } from "../lib/viewState";

interface CataloguePanelProps {
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
    <span className="border border-orb-border px-1 font-mono text-[11px] leading-4 tracking-[0.04em] text-orb-muted uppercase">
      {maturity}
    </span>
  );
}

const ROLE_BTN =
  "orb-button orb-button--compact !min-h-8 !px-2 aria-pressed:!border-orb-text aria-pressed:!bg-orb-text aria-pressed:!text-orb-bg";

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
      className={`cursor-pointer border border-l-[3px] px-3 py-2 transition-colors ${
        isSelected
          ? "border-orb-border border-l-orb-focus bg-orb-hover"
          : "border-orb-border bg-orb-raised/60 hover:bg-orb-hover"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-mono text-[12px] text-orb-text">
          {formatDate(scene.startTime)}
          {time && <span className="text-orb-muted"> {time} UTC</span>}
        </div>
        <MaturityTag maturity={scene.maturity} />
      </div>
      <div className="truncate font-mono text-[11px] leading-[18px] text-orb-subtle" title={scene.id}>
        {scene.id}
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-[12px] leading-[18px] text-orb-muted">
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
    const body = el?.closest<HTMLElement>(".orb-dock__body");
    if (!el || !body || body.scrollHeight <= body.clientHeight) return;
    let top: number | null = null;
    if (kind === "choose-pair") {
      top = body.scrollTop + el.getBoundingClientRect().top - body.getBoundingClientRect().top;
    } else if (kind === "no-observations" || kind === "no-compatible-pair" || kind === "error") {
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

  return (
    <div ref={rootRef}>
      <DisclosureSection
        title="Date filter"
        summary={loading ? "searching…" : dateFrom || dateTo ? `${dateFrom || "…"} to ${dateTo || "…"}` : "any date"}
      >
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="orb-from" className="orb-label">
              From
            </label>
            <input
              id="orb-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="From date"
              className="orb-input font-mono !px-2"
            />
          </div>
          <div>
            <label htmlFor="orb-to" className="orb-label">
              To
            </label>
            <input
              id="orb-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-label="To date"
              className="orb-input font-mono !px-2"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => onApplyDates(from, to)}
          className="orb-button orb-button--block mt-2"
        >
          Apply date filter
        </button>
      </DisclosureSection>

      {!loading && !error && scenes.length > 0 && (
        <>
          {truncated && (
            <div className="orb-section !pb-0">
              <p className="orb-note">
                Results are truncated by the catalogue limit; narrow the date range or area.
              </p>
            </div>
          )}

          {pairs.length > 0 && (
            <Section title="Suggested pairs">
              <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-2 p-0">
                {pairs.slice(0, 3).map((pair) => {
                  const id = scenePairId(pair.before.id, pair.after.id);
                  const metadataOnly = metadataOnlyPairIds.has(id);
                  return (
                    <li
                      key={id}
                      className="flex items-center justify-between gap-3 border border-orb-border bg-orb-raised/60 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-[12px] leading-[18px] text-orb-text">
                          {formatDate(pair.before.startTime)} → {formatDate(pair.after.startTime)}
                        </div>
                        <div className="text-[12px] leading-[18px] text-orb-muted">
                          {pair.baselineDays} d · covers {Math.round(pair.aoiCoverage * 100)}% of AOI
                        </div>
                        <div className="truncate font-mono text-[11px] leading-4 text-orb-subtle">
                          {compatibilityLabel(pair.before)}
                        </div>
                      </div>
                      {metadataOnly ? (
                        <span
                          title="Quicklook rasters are not available for this pair; only scene metadata can be shown."
                          className="shrink-0 border border-dashed border-orb-border px-2 py-1 text-[12px] text-orb-subtle"
                        >
                          Metadata only
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onLoadSuggested(pair)}
                          className="orb-button orb-button--compact shrink-0"
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

          <DisclosureSection title="Scenes" summary={`${scenes.length} · full list`}>
            <ul
              className="m-0 grid max-h-[220px] list-none grid-cols-[minmax(0,1fr)] gap-1 overflow-y-auto p-0 pr-1"
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
          </DisclosureSection>

          {beforeScene && afterScene && (
            <Section title="Comparison pair">
              <div className="font-mono text-[12px] leading-[18px]">
                <div>
                  <span className="text-orb-muted">Before </span>
                  {formatDate(beforeScene.startTime)}
                </div>
                <div>
                  <span className="text-orb-muted">After&nbsp; </span>
                  {formatDate(afterScene.startTime)}
                </div>
              </div>
              {issues.length > 0 ? (
                <p className="orb-note mt-2">
                  Not compatible:{" "}
                  {issues.map((i) => `${i.field} (${i.before} ≠ ${i.after})`).join(", ")}. These two
                  observations cannot be compared for change.
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => onLoadPair(beforeScene.id, afterScene.id)}
                  className="orb-button orb-button--primary orb-button--block mt-3"
                >
                  Load comparison
                </button>
              )}
            </Section>
          )}
        </>
      )}
    </div>
  );
}

export default memo(CataloguePanel);
