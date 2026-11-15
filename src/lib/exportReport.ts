import type { AnalysisResult } from "./analysisApi";
import { directionWord, analysisDirection, finite, methodLabel, neutralText, thresholdText } from "./analysisWording";
import type { PairStats } from "./usePairStats";

export interface ReportInput {
  title: string;
  areaLabel: string;
  bbox: [number, number, number, number] | null;
  eventLabel: string;
  pairStats: PairStats | null;
  analysis: AnalysisResult | null;
  images: { before?: string; after?: string; change?: string };
  aiText: Record<string, string> | null;
  limitations: string[];
  generatedUtc: string;
}

function csvCell(value: string | number | null): string {
  const s = value === null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function tableToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]);
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((c) => csvCell(row[c] as string | number | null)).join(",")),
  ].join("\n");
}

export function reportCsv(input: ReportInput): string {
  const parts: string[] = [];
  parts.push(`# ${input.title}`);
  parts.push(`# area,${csvCell(input.areaLabel)}`);
  parts.push(`# event,${csvCell(input.eventLabel)}`);
  if (input.pairStats) {
    parts.push("");
    parts.push("# quicklook display-DN change statistics (after - before)");
    parts.push("channel,mean,median,p25,p75,valid_fraction");
    for (const ch of input.pairStats.channels) {
      const c = input.pairStats.byChannel[ch];
      if (!c) continue;
      parts.push([ch, c.change.mean, c.change.median, c.change.p25, c.change.p75,
        c.change.validFraction].join(","));
    }
  }
  if (input.analysis) {
    parts.push("");
    parts.push(`# calibrated analysis ${input.analysis.analysisId},${csvCell(input.eventLabel)}`);
    parts.push(tableToCsv(input.analysis.backscatterComparison));
    parts.push("");
    parts.push(tableToCsv(input.analysis.changeSummary));
    parts.push("");
    parts.push(tableToCsv([input.analysis.areaEstimates as unknown as Record<string, unknown>]));
  }
  return parts.join("\n") + "\n";
}

export function reportJson(input: ReportInput): string {
  return JSON.stringify(
    {
      title: input.title,
      area: input.areaLabel,
      bbox: input.bbox,
      event: input.eventLabel,
      generatedUtc: input.generatedUtc,
      quicklookStatistics: input.pairStats
        ? Object.fromEntries(
            input.pairStats.channels.map((ch) => [ch, input.pairStats!.byChannel[ch]?.change ?? null]),
          )
        : null,
      analysis: input.analysis,
      aiInterpretation: input.aiText
        ? { ...input.aiText, note: "AI-generated interpretation of computed results; not a measurement." }
        : null,
      limitations: input.limitations,
    },
    null,
    2,
  );
}

function htmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function n(value: unknown, digits: number, suffix = ""): string {
  return finite(value) ? `${value.toFixed(digits)}${suffix}` : "Not available";
}

function quicklookTable(input: ReportInput): string {
  const stats = input.pairStats;
  if (!stats || stats.channels.length === 0) return "";
  const unit = htmlEscape(stats.unit);
  const rows = stats.channels
    .map((ch) => {
      const c = stats.byChannel[ch]?.change;
      if (!c) return "";
      return `<tr><td>${htmlEscape(ch)}</td><td>${n(c.mean, 2)}</td><td>${n(c.median, 2)}</td><td>${n(c.p25, 2)} to ${n(c.p75, 2)}</td><td>${n(c.validFraction * 100, 1, "%")}</td></tr>`;
    })
    .join("");
  return `<h2>Quicklook display-DN statistics (after − before, computed in the browser)</h2>
<table class="grid"><tr><th>Channel</th><th>Mean (${unit})</th><th>Median (${unit})</th><th>Interquartile range (${unit})</th><th>Valid pixels</th></tr>${rows}</table>
<p class="note">Differences of 8-bit browse quicklook display values (display DN), not calibrated backscatter. The sign shows darker or brighter; the size is not a calibrated measurement.</p>`;
}

function kvTable(rows: [string, string][]): string {
  return `<table>${rows
    .map(([k, v]) => `<tr><th>${htmlEscape(k)}</th><td>${htmlEscape(v)}</td></tr>`)
    .join("")}</table>`;
}

function statsSourceNote(input: ReportInput): string {
  const parts: string[] = [];
  if (input.pairStats) parts.push("quicklook display-DN statistics computed in the browser from ASF browse images");
  if (input.analysis) parts.push("calibrated gamma-0 (dB) statistics from the nisar_change processing pipeline");
  if (parts.length === 0) return "No statistics were available when this report was generated.";
  const text = parts.join("; and ");
  return `Statistics in this report: ${text}.${input.analysis ? "" : " No calibrated analysis was run, so no calibrated values are included."}`;
}

export function reportHtml(input: ReportInput): string {
  const a = input.analysis;
  const sections: string[] = [];
  sections.push(`<h1>${htmlEscape(input.title)}</h1>`);
  sections.push(kvTable([
    ["Area of interest", input.areaLabel],
    ["Bounding box", input.bbox ? input.bbox.map((v) => v.toFixed(4)).join(", ") : "—"],
    ["Change examined", input.eventLabel],
    ["Generated", input.generatedUtc],
  ]));

  if (a) {
    const dates = a.acquisitionDates;
    sections.push("<h2>Observations (live calibrated analysis)</h2>");
    sections.push(kvTable([
      ["Before acquisition", `${dates.before} · ${a.observations.before.id}`],
      ["After acquisition", `${dates.after} · ${a.observations.after.id}`],
      ["Product", `${a.productMetadata.productType} · ${a.productMetadata.processingLevel}`],
      ["Frequency / polarisation", `${a.productMetadata.frequencyBand} · ${a.productMetadata.polarisation}`],
      ["Maturity", a.observations.before.maturity],
      ["Orbit / track / frame",
        `${a.observations.before.orbit_direction.toLowerCase()} / ${a.observations.before.track} / ${a.observations.before.frame}`],
    ]));
    sections.push("<h2>Calibrated results (processing pipeline)</h2>");
    sections.push(kvTable([
      ["Analysis method", methodLabel(a.processing?.eventMethod)],
      ["Threshold / direction", `${thresholdText(a)} · ${directionWord(analysisDirection(a))}`],
      ["Valid analysed area", n(a.areaEstimates?.valid_analysed_area_km2, 3, " km²")],
      ["Candidate changed area",
        `${n(a.areaEstimates?.candidate_changed_area_km2, 4, " km²")} (${n(a.areaEstimates?.candidate_changed_area_hectares, 2, " ha")})`],
      ["Candidate changed (valid area)", n(a.areaEstimates?.candidate_changed_percent_of_valid, 3, "%")],
      ["Valid pixels", finite(a.areaEstimates?.valid_pixels) ? String(a.areaEstimates.valid_pixels) : "Not available"],
      ["Mean change (gamma-0)", n(a.statistics?.mean_difference_db, 3, " dB")],
      ["Median change (gamma-0)", n(a.statistics?.median_difference_db, 3, " dB")],
      ["Quality (valid fraction)",
        finite(a.processing?.quality?.validFraction) ? `${(a.processing.quality.validFraction * 100).toFixed(1)}%` : "Not available"],
    ]));
    sections.push(`<p class="note">${htmlEscape(neutralText(a.areaEstimates?.note))} A change in backscatter can have several causes; this analysis does not identify which, and nothing here is confirmed.</p>`);
  }

  sections.push(quicklookTable(input));

  if (input.images.before || input.images.after || input.images.change) {
    sections.push("<h2>Raster views</h2><div class=\"imgs\">");
    const captions: Record<string, string> = {
      before: "Before · browse quicklook, display DN (not calibrated)",
      after: "After · browse quicklook, display DN (not calibrated)",
      change: "Change (after − before) · display DN difference (not calibrated)",
    };
    for (const [name, src] of Object.entries(input.images)) {
      if (src) {
        const caption = captions[name] ?? name;
        sections.push(`<figure><img src="${htmlEscape(src)}" alt="${htmlEscape(caption)}"/><figcaption>${htmlEscape(caption)}</figcaption></figure>`);
      }
    }
    sections.push("</div>");
    sections.push(
      `<p class="note">These images are browse quicklook renderings in 8-bit display DN, not calibrated backscatter, even when calibrated statistics appear above.</p>`,
    );
  }

  if (input.aiText) {
    sections.push("<h2>AI interpretation (generated by Gemini from the computed results)</h2>");
    sections.push(kvTable(Object.entries(input.aiText)));
    sections.push(`<p class="note">AI-generated; interpretation, not measurement.</p>`);
  }

  sections.push("<h2>Limitations and uncertainty</h2>");
  sections.push(`<ul>${input.limitations.map((l) => `<li>${htmlEscape(l)}</li>`).join("")}</ul>`);
  sections.push(
    `<p class="note">Data sources: NASA/ASF NISAR L2 GCOV products (via ASF Search API, NASA CMR and NASA Harmony). ` +
    `${statsSourceNote(input)}</p>`,
  );

  return `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEscape(input.title)}</title>
<style>
 body{font:14px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:#171717;margin:40px auto;max-width:820px}
 h1{font-size:22px} h2{font-size:15px;margin-top:26px;border-bottom:1px solid #e5e7eb;padding-bottom:4px}
 table{border-collapse:collapse;width:100%;margin:8px 0}
 th{text-align:left;font-weight:600;color:#737373;width:38%;padding:4px 8px 4px 0;vertical-align:top}
 td{padding:4px 0;vertical-align:top}
 .note{color:#737373;font-size:12px}
 .imgs{display:flex;gap:12px;flex-wrap:wrap}
 table.grid th,table.grid td{border-bottom:1px solid #e5e7eb;padding:4px 8px;width:auto}
 figure{margin:0} img{max-width:250px;border:1px solid #e5e7eb} figcaption{font-size:11px;color:#737373}
</style></head><body>${sections.join("\n")}</body></html>`;
}

export function downloadFile(name: string, content: string | Blob, mime: string): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1500);
}
