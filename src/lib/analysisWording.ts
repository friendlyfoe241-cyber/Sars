import type { AnalysisResult } from "./analysisApi";

export function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export function fixed(n: unknown, digits: number): string | null {
  return finite(n) ? n.toFixed(digits) : null;
}

export const NOT_AVAILABLE = "Not available";

export function analysisThreshold(result: AnalysisResult | null | undefined): number | null {
  const v = result?.processing?.methodParameters?.change_db;
  return finite(v) ? v : null;
}

export function analysisDirection(
  result: AnalysisResult | null | undefined,
): "decrease" | "increase" | "both" {
  const d = result?.processing?.methodParameters?.direction;
  return d === "increase" || d === "both" ? d : "decrease";
}

export function directionWord(direction: "decrease" | "increase" | "both"): string {
  return direction === "both" ? "change (decrease or increase)" : direction;
}

export function thresholdText(result: AnalysisResult | null | undefined): string {
  const t = analysisThreshold(result);
  return t === null ? "the chosen threshold" : `${t} dB`;
}

export function changeLabel(result: AnalysisResult | null | undefined): string {
  return `Calibrated gamma-0 backscatter ${directionWord(analysisDirection(result))} of at least ${thresholdText(result)} (cause not determined)`;
}

export function causeNote(result: AnalysisResult | null | undefined): string {
  const direction = analysisDirection(result);
  if (direction === "increase") {
    return "An increase can have several causes, for example vegetation growth, new structures, rougher ground or wetter soil. This analysis cannot tell which, and nothing here is confirmed.";
  }
  if (direction === "both") {
    return "A change like this can have several causes, for example standing water, wetter or rougher ground, vegetation growth or loss, harvest or burning. This analysis cannot tell which, and nothing here is confirmed.";
  }
  return "A decrease can have several causes, for example standing water or wetter or smoother ground, loss of vegetation, harvest or burning. This analysis cannot tell which, and nothing here is confirmed.";
}

export function methodLabel(eventMethod: string | null | undefined): string {
  if (!eventMethod || eventMethod === "deforestation") return "Backscatter-change threshold";
  return eventMethod;
}

export function neutralText(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/\('candidate' disturbance\)/g, "('candidate' change)")
    .replace(/possible vegetation-structure loss/g, "candidate change (cause not determined)");
}

export function neutralResult(result: AnalysisResult): AnalysisResult {
  return {
    ...result,
    eventType: "backscatter-change threshold (cause not determined)",
    processing: result.processing
      ? {
          ...result.processing,
          eventMethod: methodLabel(result.processing.eventMethod),
          methodSummary: neutralText(result.processing.methodSummary),
        }
      : result.processing,
    areaEstimates: result.areaEstimates
      ? { ...result.areaEstimates, note: neutralText(result.areaEstimates.note) }
      : result.areaEstimates,
  };
}
