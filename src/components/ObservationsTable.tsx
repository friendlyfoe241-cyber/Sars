import { Fragment, memo, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ArrowDown, ArrowUp, MapPin } from "lucide-react";
import { formatAcquisitionTime, formatDate } from "../lib/data";
import type { NisarScene } from "../lib/discovery";
import type { ViewState } from "../lib/viewState";
import { Spinner } from "./ui";

interface ObservationsTableProps {
  status: ViewState;
  scenes: NisarScene[];
  roleBefore: string | null;
  roleAfter: string | null;
  /** scenes known to have no usable quicklook rasters */
  metadataOnlyIds: ReadonlySet<string>;
  selectedSceneId: string | null;
  locationLabel: string;
  onAssignRole: (role: "before" | "after", id: string) => void;
  onSelectScene: (id: string) => void;
}

const PAGE = 25;
const COLS = 6;

function geometry(s: NisarScene): string {
  return (
    [
      s.orbitDirection.toLowerCase(),
      s.track != null ? `track ${s.track}` : "",
      s.frame != null ? `frame ${s.frame}` : "",
      s.orbit != null ? `orbit ${s.orbit}` : "",
    ]
      .filter(Boolean)
      .join(" · ") || "—"
  );
}

function Message({ busy, children }: { busy?: boolean; children: string }) {
  return (
    <p className="vx-instr-empty" role="status">
      {busy && <Spinner />}
      <span>{children}</span>
    </p>
  );
}

function ObservationsTable({
  status,
  scenes,
  roleBefore,
  roleAfter,
  metadataOnlyIds,
  selectedSceneId,
  locationLabel,
  onAssignRole,
  onSelectScene,
}: ObservationsTableProps) {
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const rows = useMemo(() => {
    const sign = dir === "asc" ? 1 : -1;
    const byTime = (a: NisarScene, b: NisarScene) =>
      sign * (Date.parse(a.startTime) - Date.parse(b.startTime));
    // assigned rows stay first as soon as a role is set (not only once the pair
    // has loaded), so rows do not jump later under the pointer
    const isPair = (s: NisarScene) => s.id === roleBefore || s.id === roleAfter;
    const first = scenes.filter(isPair).sort(byTime);
    const rest = scenes.filter((s) => !isPair(s)).sort(byTime);
    return [...first, ...rest];
  }, [scenes, dir, roleBefore, roleAfter]);

  if (status.kind === "choose-location") {
    return <Message>Search the catalogue to list observations</Message>;
  }
  if (status.kind === "searching") return <Message busy>Searching the NISAR catalogue…</Message>;
  if (status.kind === "error" && status.source === "search") {
    return <Message>The catalogue search failed, so no observations are listed. Retry it from Explore.</Message>;
  }
  if (status.kind === "no-observations" || scenes.length === 0) {
    return <Message>No observations found for this area and date range</Message>;
  }

  const shown = showAll ? rows : rows.slice(0, PAGE);
  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const SortIcon = dir === "asc" ? ArrowUp : ArrowDown;

  return (
    <>
      <div
        className="vx-instr-scroll"
        role="region"
        aria-label="Observations table, scrollable"
        tabIndex={0}
      >
        <table className="vx-itable vx-itable--obs">
          <colgroup>
            <col className="vx-col-expand" />
            <col className="vx-col-when" />
            <col className="vx-col-place" />
            <col className="vx-col-channels" />
            <col className="vx-col-maturity" />
            <col className="vx-col-role" />
          </colgroup>
          <caption>
            {rows.length} observation{rows.length === 1 ? "" : "s"} · UTC · {dir === "asc" ? "oldest" : "newest"} first
            {rows.length > PAGE && (
              <>
                {" "}
                · {shown.length} of {rows.length}
                <button
                  type="button"
                  className="vx-itable__link"
                  aria-expanded={showAll}
                  onClick={() => setShowAll((v) => !v)}
                >
                  {showAll ? `Show first ${PAGE}` : `Show all ${rows.length}`}
                </button>
              </>
            )}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="vx-itable__narrow">
                <span className="sr-only">Details</span>
              </th>
              <th scope="col" aria-sort={dir === "asc" ? "ascending" : "descending"}>
                <button
                  type="button"
                  className="vx-itable__sort"
                  onClick={() => setDir((d) => (d === "asc" ? "desc" : "asc"))}
                >
                  Acquisition
                  <SortIcon size={14} aria-hidden />
                  <span className="sr-only">
                    , sorted {dir === "asc" ? "oldest first" : "newest first"}; activate to reverse
                  </span>
                </button>
              </th>
              <th scope="col">Location</th>
              <th scope="col">Channels</th>
              <th scope="col" className="vx-col-maturity">Maturity</th>
              <th scope="col">Role</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => {
              const role = s.id === roleBefore ? "Before" : s.id === roleAfter ? "After" : null;
              const metaOnly = metadataOnlyIds.has(s.id);
              const expanded = open.has(s.id);
              const when = formatAcquisitionTime(s.startTime);
              const detailId = `obs-detail-${s.id}`;
              return (
                <Fragment key={s.id}>
                  <tr data-selected={s.id === selectedSceneId || undefined} data-role={role ?? undefined}>
                    <td className="vx-itable__narrow">
                      <button
                        type="button"
                        className="vx-itable__expand"
                        aria-expanded={expanded}
                        aria-controls={detailId}
                        aria-label={`Details for ${when}`}
                        onClick={() => toggle(s.id)}
                      >
                        {expanded ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
                      </button>
                    </td>
                    <th scope="row" className="vx-itable__time">
                      <span title={when}>{formatDate(s.startTime)}</span>
                      <span className="vx-itable__sub">{s.startTime.slice(11, 16)} UTC</span>
                    </th>
                    <td>
                      <span className="vx-itable__place" title={locationLabel}>
                        {locationLabel || "—"}
                      </span>
                      <span className="vx-itable__sub vx-itable__trunc" title={geometry(s)}>
                        {geometry(s)}
                      </span>
                    </td>
                    <td className="vx-itable__mono">
                      <span className="vx-itable__trunc" title={s.polarisations.join(" · ")}>
                        {s.polarisations.join(" · ")}
                      </span>
                      {metaOnly && <span className="vx-itable__sub vx-itable__warn">Metadata only</span>}
                    </td>
                    <td className="vx-itable__mono vx-col-maturity">
                      <span className="vx-itable__trunc" title={s.maturity}>
                        {s.maturity}
                      </span>
                    </td>
                    <td>
                      <span className="sr-only">{role ?? "Not selected"}</span>
                      <span className="vx-itable__actions" role="group" aria-label={`Role of ${when}`}>
                        <button
                          type="button"
                          className="vx-button vx-button--compact"
                          aria-pressed={role === "Before"}
                          aria-label={`Use ${when} as Before`}
                          onClick={() => onAssignRole("before", s.id)}
                        >
                          Before
                        </button>
                        <button
                          type="button"
                          className="vx-button vx-button--compact"
                          aria-pressed={role === "After"}
                          aria-label={`Use ${when} as After`}
                          onClick={() => onAssignRole("after", s.id)}
                        >
                          After
                        </button>
                        <button
                          type="button"
                          className="vx-button vx-button--compact vx-itable__icon"
                          aria-pressed={s.id === selectedSceneId}
                          aria-label={`Highlight footprint of ${when} on the map`}
                          title="Highlight footprint on the map"
                          onClick={() => onSelectScene(s.id)}
                        >
                          <MapPin size={14} aria-hidden />
                        </button>
                      </span>
                    </td>
                  </tr>
                  {expanded && (
                    <tr id={detailId} className="vx-itable__detail">
                      <td />
                      <td colSpan={COLS - 1}>
                        <dl>
                          <div>
                            <dt>Product ID</dt>
                            <dd>{s.id}</dd>
                          </div>
                          <div>
                            <dt>Processing</dt>
                            <dd>
                              CRID {s.crid ?? "—"} · {s.pgeVersion ?? "PGE —"}
                              {s.productionCode ? ` · variant ${s.productionCode}` : ""}
                            </dd>
                          </div>
                          <div>
                            <dt>Collection</dt>
                            <dd>{s.collection}</dd>
                          </div>
                          <div>
                            <dt>Product type</dt>
                            <dd>
                              {s.band} · {s.productType} · ends {s.stopTime.slice(11, 16)} UTC
                            </dd>
                          </div>
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default memo(ObservationsTable);
