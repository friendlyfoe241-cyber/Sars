import { useState } from "react";
import { Crosshair, Maximize2, Search, SquareDashed } from "lucide-react";
import { Section, Spinner } from "./ui";
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
  /** frame the area of interest on the map again */
  onFit: () => void;
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
  onFit,
  onSearchData,
  searching,
  exampleLabel,
  onExample,
}: SearchPanelProps) {
  // Local to the panel: typing re-renders only this component.
  const [query, setQuery] = useState("");
  return (
    <>
      <Section title="Location">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onLocationSearch(query);
          }}
          className="vx-field"
        >
          <label htmlFor="vx-location" className="vx-label !mb-0">
            Place name or coordinates
          </label>
          <div className="flex gap-2">
            <input
              id="vx-location"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Place name or lat, lon"
              aria-label="Location search"
              aria-invalid={locationError ? true : undefined}
              aria-describedby="vx-location-hint"
              className="vx-input"
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={searchingLocation || query.trim().length === 0}
              className="vx-button w-12 shrink-0 !px-0"
              aria-label={searchingLocation ? "Searching for location" : "Go to location"}
            >
              {searchingLocation ? <Spinner /> : <Search size={16} aria-hidden />}
            </button>
          </div>
        </form>
        <p
          id="vx-location-hint"
          className={`vx-note mt-2 ${locationError ? "!text-vx-error" : ""}`}
          role={locationError ? "alert" : undefined}
        >
          {locationError ||
            locationLabel ||
            "Search a place, enter coordinates, click the map, or draw an area."}
        </p>
        {exampleLabel && (
          <button
            type="button"
            onClick={() => {
              setQuery(exampleLabel);
              onExample();
            }}
            className="vx-button vx-button--ghost vx-button--compact mt-2 !h-auto !justify-start !px-2 !py-2 text-left"
          >
            <Crosshair size={14} aria-hidden className="shrink-0" />
            <span>Example: {exampleLabel}</span>
          </button>
        )}
      </Section>

      <Section title="Area of interest">
        <div className="flex items-end gap-2">
          <div className="w-[150px] shrink-0">
            <label htmlFor="vx-aoi-size" className="vx-label">
              Size
            </label>
            <select
              id="vx-aoi-size"
              value={aoiSizeKm}
              onChange={(e) => onAoiSizeChange(Number(e.target.value))}
              aria-label="Area of interest size"
              className="vx-input vx-select"
            >
              {AOI_SIZES_KM.map((km) => (
                <option key={km} value={km}>
                  {km} × {km} km
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={onToggleDraw}
            aria-pressed={drawMode}
            className="vx-button min-w-0 flex-1 !px-2"
          >
            <SquareDashed size={16} aria-hidden />
            {drawMode ? "Cancel drawing" : "Draw AOI"}
          </button>
        </div>
        {aoi && (
          <button type="button" onClick={onFit} className="vx-button vx-button--block mt-2">
            <Maximize2 size={16} aria-hidden />
            Fit map to area
          </button>
        )}
        <p className="vx-note vx-mono mt-2">
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
          className="vx-button vx-button--primary vx-button--block"
        >
          {searching ? <Spinner /> : <Search size={16} aria-hidden />}
          {searching ? "Searching NISAR data…" : "Search NISAR data"}
        </button>
        {!aoi && <p className="vx-note mt-2">Choose an area first.</p>}
      </Section>
    </>
  );
}
