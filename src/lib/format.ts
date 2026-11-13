// Number formatting shared by the instrument row.  True minus sign, explicit
// plus for positive values, and zero is a real value: it prints as "0.0".

const MINUS = "−";

/** One-decimal signed value: "+8.0", "−13.0", "0.0". Non-finite: "—". */
export function formatSigned(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const r = Math.round(n * 10) / 10;
  if (r === 0) return "0.0";
  return `${r > 0 ? "+" : MINUS}${Math.abs(r).toFixed(1)}`;
}

/** One-decimal unsigned value. */
export function formatPlain(n: number): string {
  return Number.isFinite(n) ? n.toFixed(1) : "—";
}

/** Signed integer label for axis ticks: "+20", "−20", "0". */
export function formatTick(n: number): string {
  if (n === 0) return "0";
  return `${n > 0 ? "+" : MINUS}${Math.abs(n)}`;
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-GB");
}
