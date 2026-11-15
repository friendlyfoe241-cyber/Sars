const MINUS = "−";

export function formatSigned(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const r = Math.sign(n) * (Math.round(Math.abs(n) * 10) / 10);
  if (r === 0) return "0.0";
  return `${r > 0 ? "+" : MINUS}${Math.abs(r).toFixed(1)}`;
}

export function formatPlain(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const r = Math.sign(n) * (Math.round(Math.abs(n) * 10) / 10);
  return r === 0 ? "0.0" : `${r < 0 ? MINUS : ""}${Math.abs(r).toFixed(1)}`;
}

export function formatTick(n: number): string {
  if (n === 0) return "0";
  return `${n > 0 ? "+" : MINUS}${Math.abs(n)}`;
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-GB");
}
