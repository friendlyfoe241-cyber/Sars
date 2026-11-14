import { memo, useMemo, useState } from "react";
import { Section } from "./ui";
import { formatDate } from "../lib/data";
import type { NisarScene } from "../lib/discovery";
import { compatibilityLabel, pairIssues, type ScenePair } from "../lib/pairing";
import { scenePairId } from "../lib/selection";

/** "25 Oct 2026 · 05:12 UTC · track 12 · frame 34" */
function sceneLabel(s: NisarScene): string {
  return [
    `${formatDate(s.startTime)} ${s.startTime.slice(11, 16)} UTC`,
    s.track !== null ? `track ${s.track}` : "",
    s.frame !== null ? `frame ${s.frame}` : "",
    s.polarisations.join("/"),
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The catalogue date range.  Applying it runs the search again, which clears
 * the scene list, roles, comparison and explanation (App.runSearch).
 */
export function DateFilter({
  dateFrom,
  dateTo,
  searching,
  onApply,
}: {
  dateFrom: string;
  dateTo: string;
  searching: boolean;
  onApply: (from: string, to: string) => void;
}) {
  const [from, setFrom] = useState(dateFrom);
  const [to, setTo] = useState(dateTo);
  return (
    <Section
      title="Date filter"
      right={
        <span className="vx-section__summary">
          {searching ? "searching…" : dateFrom || dateTo ? `${dateFrom || "…"} to ${dateTo || "…"}` : "any date"}
        </span>
      }
    >
      <form
        className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onApply(from, to);
        }}
      >
        <div>
          <label htmlFor="vx-from" className="vx-label">
            From
          </label>
          <input
            id="vx-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
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
            className="vx-input vx-mono !px-2"
          />
        </div>
        <button type="submit" className="vx-button" disabled={searching}>
          Apply and search again
        </button>
      </form>
    </Section>
  );
}

/** Suggested compatible pairs, as a grid of cards with a Compare action. */
export const SuggestedPairs = memo(function SuggestedPairs({
  pairs,
  metadataOnlyPairIds,
  roleBefore,
  roleAfter,
  onLoadSuggested,
}: {
  pairs: ScenePair[];
  metadataOnlyPairIds: ReadonlySet<string>;
  roleBefore: string | null;
  roleAfter: string | null;
  onLoadSuggested: (pair: ScenePair) => void;
}) {
  const [all, setAll] = useState(false);
  const FIRST = 6;
  const shown = all ? pairs : pairs.slice(0, FIRST);
  if (pairs.length === 0) {
    return (
      <p className="vx-note px-5 py-4">
        No compatible pair was suggested. Choose Before and After yourself below.
      </p>
    );
  }
  return (
    <div className="px-4 pt-1 pb-4">
      <ul className="vx-pair-grid m-0 list-none p-0" aria-label="Suggested pairs">
        {shown.map((pair) => {
          const id = scenePairId(pair.before.id, pair.after.id);
          const metadataOnly = metadataOnlyPairIds.has(id);
          const current = pair.before.id === roleBefore && pair.after.id === roleAfter;
          return (
            <li key={id} className="vx-pair-card" aria-current={current ? "true" : undefined}>
              <div className="min-w-0">
                <div className="vx-mono text-[13px] leading-5 text-vx-text">
                  {formatDate(pair.before.startTime)} → {formatDate(pair.after.startTime)}
                </div>
                <div className="text-[12px] leading-[18px] text-vx-muted">
                  {pair.baselineDays} d apart · covers {Math.round(pair.aoiCoverage * 100)}% of the area
                </div>
                <div className="truncate font-mono text-[11px] leading-4 text-vx-subtle" title={compatibilityLabel(pair.before)}>
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
                  className="vx-button vx-button--primary vx-button--compact shrink-0"
                  aria-label={`Compare ${formatDate(pair.before.startTime)} with ${formatDate(pair.after.startTime)}`}
                >
                  Compare
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {pairs.length > FIRST && (
        <button type="button" className="vx-button vx-button--ghost mt-2" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? `Show the first ${FIRST}` : `Show all ${pairs.length} pairs`}
        </button>
      )}
    </div>
  );
});

/**
 * Manual Before / After choice from the scene list, with the compatibility
 * check and the Compare action.
 */
export function ManualPair({
  scenes,
  roleBefore,
  roleAfter,
  onAssignRole,
  onLoadPair,
}: {
  scenes: NisarScene[];
  roleBefore: string | null;
  roleAfter: string | null;
  onAssignRole: (role: "before" | "after", id: string) => void;
  onLoadPair: (beforeId: string, afterId: string) => void;
}) {
  const sorted = useMemo(
    () => [...scenes].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime)),
    [scenes],
  );
  const byId = useMemo(() => new Map(scenes.map((s) => [s.id, s])), [scenes]);
  const before = roleBefore ? (byId.get(roleBefore) ?? null) : null;
  const after = roleAfter ? (byId.get(roleAfter) ?? null) : null;
  const issues = useMemo(() => (before && after ? pairIssues(before, after) : []), [before, after]);

  const select = (role: "before" | "after", value: string | null) => (
    <div className="min-w-0">
      <label htmlFor={`vx-manual-${role}`} className="vx-label">
        {role === "before" ? "Before (earlier scene)" : "After (later scene)"}
      </label>
      <select
        id={`vx-manual-${role}`}
        className="vx-input vx-select"
        value={value ?? ""}
        onChange={(e) => e.target.value && onAssignRole(role, e.target.value)}
      >
        <option value="" disabled>
          Choose a scene
        </option>
        {sorted.map((s) => (
          <option key={s.id} value={s.id}>
            {sceneLabel(s)}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="px-5 pt-1 pb-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
        {select("before", roleBefore)}
        {select("after", roleAfter)}
      </div>
      {before && after && issues.length > 0 && (
        <p className="vx-note mt-3" role="status">
          Not compatible: {issues.map((i) => `${i.field} (${i.before} ≠ ${i.after})`).join(", ")}. These two
          observations cannot be compared for change.
        </p>
      )}
      <button
        type="button"
        onClick={() => before && after && onLoadPair(before.id, after.id)}
        disabled={!before || !after || issues.length > 0}
        className="vx-button vx-button--primary mt-3"
      >
        Compare these scenes
      </button>
      {(!before || !after) && <p className="vx-note mt-2">Choose both scenes to compare them.</p>}
    </div>
  );
}

/**
 * The Before / After assigned from the observations table, with the Compare
 * action (Scenes page).
 */
export function PairSummary({
  scenes,
  roleBefore,
  roleAfter,
  onLoadPair,
  pairCount,
  onSeePairs,
}: {
  scenes: NisarScene[];
  roleBefore: string | null;
  roleAfter: string | null;
  onLoadPair: (beforeId: string, afterId: string) => void;
  /** number of suggested pairs (0: no link to them) */
  pairCount: number;
  onSeePairs: () => void;
}) {
  const byId = useMemo(() => new Map(scenes.map((s) => [s.id, s])), [scenes]);
  const before = roleBefore ? (byId.get(roleBefore) ?? null) : null;
  const after = roleAfter ? (byId.get(roleAfter) ?? null) : null;
  const issues = useMemo(() => (before && after ? pairIssues(before, after) : []), [before, after]);
  if (scenes.length === 0) return null;
  return (
    <Section title="Comparison pair">
      <dl className="vx-mono m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 text-[12px] leading-5">
        <dt className="text-vx-muted">Before</dt>
        <dd className="m-0">{before ? formatDate(before.startTime) : "not chosen"}</dd>
        <dt className="text-vx-muted">After</dt>
        <dd className="m-0">{after ? formatDate(after.startTime) : "not chosen"}</dd>
      </dl>
      {before && after && issues.length > 0 ? (
        <p className="vx-note mt-2" role="status">
          Not compatible: {issues.map((i) => `${i.field} (${i.before} ≠ ${i.after})`).join(", ")}. These two
          observations cannot be compared for change.
        </p>
      ) : before && after ? (
        <button
          type="button"
          onClick={() => onLoadPair(before.id, after.id)}
          className="vx-button vx-button--primary vx-button--block mt-3"
        >
          Compare
        </button>
      ) : (
        <p className="vx-note mt-2">Mark one scene as Before and a later one as After in the table.</p>
      )}
      {pairCount > 0 && (
        <button type="button" className="vx-button vx-button--block mt-2" onClick={onSeePairs}>
          See {pairCount} suggested pair{pairCount === 1 ? "" : "s"}
        </button>
      )}
    </Section>
  );
}
