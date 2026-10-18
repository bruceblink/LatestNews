/** Reproduce LatestNews' deployed URL hash IDs while migrating existing source adapters. */
export async function createLegacyUrlHashId(value: string, length = 32) {
    const normalizedUrl = normalizeLegacyUrl(value);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizedUrl));
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return hash.slice(0, length);
}

function normalizeLegacyUrl(value: string) {
    try {
        const url = new URL(value);
        url.protocol = url.protocol.toLowerCase();
        url.hostname = url.hostname.toLowerCase();
        url.pathname = url.pathname.replace(/\/$/, "");
        url.searchParams.sort();
        for (const parameter of [
            "utm_source",
            "utm_medium",
            "utm_campaign",
            "utm_term",
            "utm_content",
            "fbclid",
            "gclid",
        ]) {
            url.searchParams.delete(parameter);
        }
        return url.toString();
    } catch {
        return value;
    }
}
