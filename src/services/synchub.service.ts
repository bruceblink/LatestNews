import type { HistoryItem } from "~/atoms/historyAtom";
import type { ReadingState } from "@shared/reading-state";

export interface SyncHubConfig {
    endpoint: string;
    apiKey: string;
}
const storageKey = "latestnews-synchub-sync";

function endpoint(value: string) {
    return value.trim().replace(/\/+$/, "");
}

export function getSyncHubConfig(): SyncHubConfig {
    try {
        const raw = localStorage.getItem(storageKey);
        const value = raw ? (JSON.parse(raw) as Partial<SyncHubConfig>) : {};
        return {
            endpoint: typeof value.endpoint === "string" ? endpoint(value.endpoint) : "",
            apiKey: typeof value.apiKey === "string" ? value.apiKey.trim() : "",
        };
    } catch {
        return { endpoint: "", apiKey: "" };
    }
}

export function saveSyncHubConfig(config: SyncHubConfig) {
    localStorage.setItem(
        storageKey,
        JSON.stringify({ endpoint: endpoint(config.endpoint), apiKey: config.apiKey.trim() })
    );
}
export function clearSyncHubConfig() {
    localStorage.removeItem(storageKey);
}
export function isSyncHubConfigured(config = getSyncHubConfig()) {
    return /^https?:\/\//i.test(config.endpoint) && config.apiKey.startsWith("shk_");
}

async function request<T>(collection: "reading-history" | "favorites", init?: RequestInit): Promise<T | null> {
    const config = getSyncHubConfig();
    if (!isSyncHubConfigured(config)) return null;
    const response = await fetch(`${config.endpoint}/api/v1/metadata/latestnews/${collection}`, {
        ...init,
        headers: { "Content-Type": "application/json", "X-API-Key": config.apiKey, ...init?.headers },
    });
    const result = (await response.json()) as { code: number; message?: string; data?: { payload: T | null } };
    if (!response.ok || result.code !== 0) throw new Error(result.message || "SyncHub request failed");
    return result.data?.payload ?? null;
}

export const downloadReadingHistory = () => request<HistoryItem[]>("reading-history");
export const uploadReadingHistory = (history: HistoryItem[]) =>
    request("reading-history", { method: "PUT", body: JSON.stringify({ payload: history }) });
export const downloadFavorites = () => request<ReadingState["favorites"]>("favorites");
export const uploadFavorites = (favorites: ReadingState["favorites"]) =>
    request("favorites", { method: "PUT", body: JSON.stringify({ payload: favorites }) });
