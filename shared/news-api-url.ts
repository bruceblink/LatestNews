/** Resolve the Web API origin while keeping Electron requests on its main-process proxy. */
export function resolveNewsApiBaseUrl(candidate?: string, desktop = false) {
    if (desktop) return "/api";

    const value = candidate?.trim();
    if (!value) return "/api";

    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error("VITE_NEWS_API_URL must be an HTTP(S) origin.");
    }

    const localHttpHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
    const validProtocol = url.protocol === "https:" || (url.protocol === "http:" && localHttpHosts.has(url.hostname));
    if (!validProtocol || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
        throw new Error("VITE_NEWS_API_URL must be a trusted HTTP(S) origin without credentials or a path.");
    }

    return `${url.origin}/api`;
}
