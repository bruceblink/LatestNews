import { isDesktopCollectionMode } from "../shared/desktop-collection-mode";

import type { DesktopCollectionMode } from "../shared/desktop-collection-mode";

export type NewsApiUrlValidator = (value: string) => URL;

export interface StoredNewsApiConfig {
    url: URL | null;
    mode: DesktopCollectionMode;
}

/** Parse persisted URL and mode; older URL-only settings retain the existing auto behavior. */
export function parseStoredNewsApiConfig(raw: string, validate: NewsApiUrlValidator): StoredNewsApiConfig {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !("url" in parsed)) {
        throw new Error("Invalid desktop news API configuration.");
    }

    const config = parsed as { url?: unknown; mode?: unknown };
    const mode = config.mode === undefined ? "auto" : config.mode;
    if (!isDesktopCollectionMode(mode)) throw new Error("Invalid desktop news API mode.");
    let url: URL | null;
    if (config.url === null || config.url === "") {
        url = null;
    } else if (typeof config.url === "string") {
        url = validate(config.url);
    } else {
        throw new Error("Invalid desktop news API configuration.");
    }
    if (mode === "remote" && !url) throw new Error("Remote mode requires a configured news API URL.");
    return { url, mode };
}

/** Serialize a validated origin independently from the selected collection mode. */
export function serializeStoredNewsApiConfig(
    value: string,
    validate: NewsApiUrlValidator,
    mode: DesktopCollectionMode = "auto"
) {
    const trimmed = value.trim();
    if (!isDesktopCollectionMode(mode)) throw new Error("Invalid desktop news API mode.");
    if (!trimmed) {
        if (mode === "remote") throw new Error("Remote mode requires a configured news API URL.");
        return `${JSON.stringify({ url: null, mode })}\n`;
    }
    const checked = validate(trimmed);
    return `${JSON.stringify({ url: checked.origin, mode })}\n`;
}
