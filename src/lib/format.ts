/**
 * Number coercion at the display boundary.
 *
 * The local API and the published state row are both loosely typed — a field
 * declared as a number can arrive as a numeric string, null, or an object.
 * Calling `.toFixed()` on those crashes the whole route, so every formatted
 * figure goes through here first.
 */

export function toNum(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed.replace(/[$,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Safe `.toFixed()`. Returns `fallback` when the value is not a real number. */
export function fixed(value: unknown, digits = 2, fallback = "—"): string {
  const parsed = toNum(value);
  return parsed === null ? fallback : parsed.toFixed(digits);
}

/** Safe locale integer formatting. */
export function count(value: unknown, fallback = "—"): string {
  const parsed = toNum(value);
  return parsed === null ? fallback : parsed.toLocaleString();
}
