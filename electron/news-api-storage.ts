export type NewsApiUrlValidator = (value: string) => URL;

/** Parse a persisted desktop API configuration and apply the same URL policy as runtime requests. */
export function parseStoredNewsApiConfig(raw: string, validate: NewsApiUrlValidator) {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !("url" in parsed) || typeof parsed.url !== "string") {
        throw new Error("Invalid desktop news API configuration.");
    }

    return validate(parsed.url);
}

/** Serialize only the validated origin so persisted settings cannot retain a path or query override. */
export function serializeStoredNewsApiConfig(value: string, validate: NewsApiUrlValidator) {
    const checked = validate(value.trim());
    return `${JSON.stringify({ url: checked.origin })}\n`;
}
