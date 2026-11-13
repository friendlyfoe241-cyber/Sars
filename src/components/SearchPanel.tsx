import { useState } from "react";
import { Section } from "./ui";
import { formatAoi, formatLatLon, type Aoi } from "../lib/aoi";

export const AOI_SIZES_KM = [25, 50, 100, 200];

interface SearchPanelProps {
  onLocationSearch: (query: string) => void;
  searchingLocation: boolean;
  locationLabel: string;
  locationError: string | null;
  aoi: Aoi | null;
  aoiSizeKm: number;
  onAoiSizeChange: (km: number) => void;
  drawMode: boolean;
  onToggleDraw: () => void;
  onSearchData: () => void;
  searching: boolean;
  exampleLabel: string | null;
  onExample: () => void;
}

export default function SearchPanel({
  onLocationSearch,
  searchingLocation,
  locationLabel,
  locationError,
  aoi,
  aoiSizeKm,
  onAoiSizeChange,
  drawMode,
  onToggleDraw,
  onSearchData,
  searching,
  exampleLabel,
  onExample,
}: SearchPanelProps) {
  // Local to the panel: typing re-renders only this component.
  const [query, setQuery] = useState("");
  return (
    <div>
      <Section title="Location">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onLocationSearch(query);
          }}
          className="flex gap-1.5"
        >
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Place name or lat, lon"
            aria-label="Location search"
            className="min-w-0 flex-1 rounded-[3px] border border-app-border bg-white px-2 py-1.5 text-[13px] text-app-text placeholder:text-app-muted focus:border-app-accent focus:outline-none"
          />
          <button
            type="submit"
            disabled={searchingLocation || query.trim().length === 0}
            className="rounded-[3px] border border-app-border bg-white px-2.5 py-1.5 text-[12px] text-app-text hover:bg-app-subtle disabled:opacity-60"
          >
            {searchingLocation ? "…" : "Go"}
          </button>
        </form>
        {locationError ? (
          <p className="mt-1.5 text-[11px] text-app-muted">{locationError}</p>
        ) : (
          <p className="mt-1.5 text-[11px] leading-[1.5] text-app-muted">
            {locationLabel ||
              "Search a place, enter coordinates, click the map, or draw an area."}
          </p>
        )}
        {exampleLabel && (
          <button
            type="button"
            onClick={() => {
              setQuery(exampleLabel);
              onExample();
            }}
            className="mt-1.5 text-[11px] text-app-accent underline decoration-app-border underline-offset-2 hover:decoration-app-accent"
          >
            Example: {exampleLabel}
          </button>
        )}
      </Section>

      <Section title="Area of interest">
        <div className="flex items-center gap-1.5">
          <select
            value={aoiSizeKm}
            onChange={(e) => onAoiSizeChange(Number(e.target.value))}
            aria-label="Area of interest size"
            className="rounded-[3px] border border-app-border bg-white px-2 py-1.5 text-[12px] text-app-text focus:border-app-accent focus:outline-none"
          >
            {AOI_SIZES_KM.map((km) => (
              <option key={km} value={km}>
                {km} × {km} km
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onToggleDraw}
            className={`flex-1 rounded-[3px] border px-2 py-1.5 text-[12px] ${
              drawMode
                ? "border-app-accent bg-app-accent text-white"
                : "border-app-border bg-white text-app-text hover:bg-app-subtle"
            }`}
          >
            {drawMode ? "Drawing… (click to cancel)" : "Draw AOI"}
          </button>
        </div>
        <p className="mt-1.5 text-[11px] leading-[1.5] text-app-muted">
          {aoi ? (
            <>
              {formatAoi(aoi)}
              <br />
              {formatLatLon(aoi.south, aoi.west)} → {formatLatLon(aoi.north, aoi.east)}
            </>
          ) : (
            "No area selected."
          )}
        </p>
      </Section>

      <Section title="Catalogue search">
        <button
          type="button"
          onClick={onSearchData}
          disabled={!aoi || searching}
          className="w-full rounded-[3px] border border-app-accent bg-app-accent px-3 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          {searching ? "Searching NISAR data…" : "Search NISAR data"}
        </button>
      </Section>
    </div>
  );
}
