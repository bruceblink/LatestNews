/**
 * Normalize publication times to integral UTC milliseconds. Numeric values below
 * 1e11 are seconds, matching the existing API convention. Do not interpret
 * timezone-less clock strings using the host timezone.
 */
export function articleTimestamp(value: unknown): number | null {
    if (typeof value !== "number" && typeof value !== "string") return null;
    const input = typeof value === "string" ? value.trim() : value;
    if (input === "") return null;
    const numeric = typeof input === "number" ? input : /^\d+(?:\.\d+)?$/.test(input) ? Number(input) : NaN;
    let timestamp: number;
    if (Number.isFinite(numeric)) {
        timestamp = numeric < 100_000_000_000 ? numeric * 1000 : numeric;
    } else if (typeof input === "string") {
        if (/^\d{4}-\d{2}-\d{2}$/.test(input)) timestamp = Date.parse(input + "T00:00:00Z");
        else if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(input) || /(?:GMT|UTC|[+-]\d{4})$/i.test(input))
            timestamp = Date.parse(input);
        else return null;
    } else return null;
    return Number.isFinite(timestamp) && timestamp > 0 && timestamp <= 8_640_000_000_000_000
        ? Math.trunc(timestamp)
        : null;
}
