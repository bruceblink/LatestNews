export type NewsApiUrlValidator = (value: string) => URL;

/** Parse a persisted desktop API configuration and apply the same URL policy as runtime requests. */
export function parseStoredNewsApiConfig(raw: string, validate: NewsApiUrlValidator): URL | null {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !("url" in parsed)) {
        throw new Error("Invalid desktop news API configuration.");
    }

    if (parsed.url === null || parsed.url === "") return null;
    if (typeof parsed.url !== "string") throw new Error("Invalid desktop news API configuration.");
    return validate(parsed.url);
}

/** Serialize the validated origin, or null when the desktop uses local collection only. */
export function serializeStoredNewsApiConfig(value: string, validate: NewsApiUrlValidator) {
    const trimmed = value.trim();
    if (!trimmed) return `${JSON.stringify({ url: null })}\n`;
    const checked = validate(trimmed);
    return `${JSON.stringify({ url: checked.origin })}\n`;
}
