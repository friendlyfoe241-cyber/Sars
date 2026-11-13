import { memo, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  MapPin,
  SearchX,
  Link2Off,
  Telescope,
  GitCompareArrows,
  Ban,
} from "lucide-react";
import type { ViewState } from "../lib/viewState";
import { Spinner } from "./ui";
import type { Dest } from "../ui/types";

export type NoticeTone = "idle" | "busy" | "ok" | "warn" | "error";

interface Presentation {
  tone: NoticeTone;
  icon: ReactNode;
  title: string;
  text: string;
  /** error and loading states are announced to assistive technology */
  live?: "polite" | "assertive";
}

/** One themed presentation for every ViewState variant. */
export function presentState(state: ViewState): Presentation {
  switch (state.kind) {
    case "choose-location":
      return state.hasAoi
        ? {
            tone: "idle",
            icon: <Telescope size={18} aria-hidden />,
            title: "Area selected",
            text: "Search the NISAR catalogue for observations of this area.",
          }
        : {
            tone: "idle",
            icon: <MapPin size={18} aria-hidden />,
            title: "Choose a location",
            text: "Search a place, enter coordinates, click the map or draw an area.",
          };
    case "searching":
      return {
        tone: "busy",
        icon: <Spinner />,
        title: "Searching NISAR data",
        text: "Searching the NISAR catalogue…",
        live: "polite",
      };
    case "no-observations":
      return {
        tone: "warn",
        icon: <SearchX size={18} aria-hidden />,
        title: "No observations found",
        text: "No NISAR observations found for this area and date range. Try a wider date range or a larger area.",
        live: "polite",
      };
    case "no-compatible-pair":
      return {
        tone: "warn",
        icon: <Link2Off size={18} aria-hidden />,
        title: "No compatible pair",
        text: "Not enough compatible observations for change comparison in this area and date range: at least two acquisitions with matching band, product type, polarisation, orbit and processing are required. Individual observations can still be inspected below.",
        live: "polite",
      };
    case "choose-pair":
      return {
        tone: "idle",
        icon: <GitCompareArrows size={18} aria-hidden />,
        title: "Choose a pair",
        text: "Compare a suggested pair, or assign Before and After from the scene list.",
      };
    case "metadata-only":
      return {
        tone: "warn",
        icon: <Database size={18} aria-hidden />,
        title: "Metadata only",
        text: state.message,
        live: "polite",
      };
    case "loading-raster":
      return {
        tone: "busy",
        icon: <Spinner />,
        title: "Loading comparison",
        text: "Preparing rasters for the selected pair…",
        live: "polite",
      };
    case "no-valid-pixels":
      return {
        tone: "warn",
        icon: <Ban size={18} aria-hidden />,
        title: "No valid pixels",
        text: "No pixel is valid in both observations for this area and channel, so no difference is calculated.",
        live: "polite",
      };
    case "ready":
      return {
        tone: "ok",
        icon: <CheckCircle2 size={18} aria-hidden />,
        title: "Comparison loaded",
        text: "Before and after quicklooks are on the map. Switch layers in Compare.",
        live: "polite",
      };
    case "error":
      return {
        tone: "error",
        icon: <AlertTriangle size={18} aria-hidden />,
        title: state.source === "search" ? "Catalogue search failed" : "Comparison failed",
        text: state.message,
        live: "assertive",
      };
  }
}

interface StateNoticeProps {
  state: ViewState;
  /** destination this notice is rendered in */
  here: Dest;
  onNavigate: (d: Dest) => void;
  onRetrySearch: () => void;
  onRetryPair: () => void;
  canRetryPair: boolean;
}

function StateNotice({ state, here, onNavigate, onRetrySearch, onRetryPair, canRetryPair }: StateNoticeProps) {
  const p = presentState(state);
  let action: { label: string; run: () => void } | null = null;
  if (state.kind === "error" && state.source === "search") {
    action = { label: "Retry search", run: onRetrySearch };
  } else if (state.kind === "error" && canRetryPair) {
    action = { label: "Retry comparison", run: onRetryPair };
  } else if (state.kind === "ready" && here === "explore") {
    action = { label: "Open Compare", run: () => onNavigate("compare") };
  } else if (here !== "explore" && state.kind !== "ready" && state.kind !== "no-valid-pixels") {
    action = { label: "Back to Explore", run: () => onNavigate("explore") };
  }
  return (
    <div
      className="orb-notice"
      data-tone={p.tone}
      role={p.live === "assertive" ? "alert" : p.live ? "status" : undefined}
    >
      <span className="orb-notice__icon">{p.icon}</span>
      <h3>{p.title}</h3>
      <p>{p.text}</p>
      {action && (
        <div className="orb-notice__action">
          <button type="button" className="orb-button orb-button--compact" onClick={action.run}>
            {action.label}
          </button>
        </div>
      )}
    </div>
  );
}

export default memo(StateNotice);
