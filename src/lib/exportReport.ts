import type { AnalysisResult } from "./analysisApi";
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
    parts.push(`# calibrated analysis ${input.analysis.analysisId} (${input.analysis.eventType})`);
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
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function kvTable(rows: [string, string][]): string {
  return `<table>${rows
    .map(([k, v]) => `<tr><th>${htmlEscape(k)}</th><td>${htmlEscape(v)}</td></tr>`)
    .join("")}</table>`;
}

export function reportHtml(input: ReportInput): string {
  const a = input.analysis;
  const sections: string[] = [];
  sections.push(`<h1>${htmlEscape(input.title)}</h1>`);
  sections.push(kvTable([
    ["Area of interest", input.areaLabel],
    ["Bounding box", input.bbox ? input.bbox.map((v) => v.toFixed(4)).join(", ") : "—"],
    ["Event type", input.eventLabel],
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
    sections.push("<h2>Calculated results</h2>");
    sections.push(kvTable([
      ["Analysis method", a.processing.eventMethod],
      ["Threshold / direction",
        `${a.processing.methodParameters.change_db} dB · ${a.processing.methodParameters.direction}`],
      ["Valid analysed area", `${a.areaEstimates.valid_analysed_area_km2} km²`],
      ["Candidate changed area",
        `${a.areaEstimates.candidate_changed_area_km2} km² (${a.areaEstimates.candidate_changed_area_hectares} ha)`],
      ["Candidate changed (valid area)",
        `${a.areaEstimates.candidate_changed_percent_of_valid}%`],
      ["Valid pixels", String(a.areaEstimates.valid_pixels)],
      ["Mean change", `${a.statistics.mean_difference_db?.toFixed(3)} dB`],
      ["Median change", `${a.statistics.median_difference_db?.toFixed(3)} dB`],
      ["Quality (valid fraction)",
        `${(a.processing.quality.validFraction * 100).toFixed(1)}%`],
    ]));
    sections.push(`<p class="note">${htmlEscape(a.areaEstimates.note)}</p>`);
  }

  if (input.images.before || input.images.after || input.images.change) {
    sections.push("<h2>Raster views</h2><div class=\"imgs\">");
    for (const [name, src] of Object.entries(input.images)) {
      if (src) sections.push(`<figure><img src="${src}" alt="${name}"/><figcaption>${name}</figcaption></figure>`);
    }
    sections.push("</div>");
    if (!a) {
      sections.push(
        `<p class="note">Raster views are ASF browse quicklook renderings (display DN), not calibrated backscatter.</p>`,
      );
    }
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
    `Statistics computed by the nisar_change processing pipeline.</p>`,
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
 figure{margin:0} img{max-width:250px;border:1px solid #e5e7eb} figcaption{font-size:11px;color:#737373}
</style></head><body>${sections.join("\n")}</body></html>`;
}

export function downloadFile(name: string, content: string | Blob, mime: string): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
