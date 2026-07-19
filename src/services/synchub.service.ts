import type { ColorScheme } from "~/hooks/useDark";
import type { HistoryItem } from "~/atoms/historyAtom";
import type { PrimitiveMetadata } from "@shared/types";
import type { ReadingState } from "@shared/reading-state";
import type { LatestNewsSyncHubCollection } from "@shared/synchub-contract";

import {
    syncHubHeaders,
    latestNewsSyncHubURL,
    defaultSyncHubEndpoint,
    normalizeSyncHubEndpoint,
} from "@shared/synchub-contract";

export { defaultSyncHubEndpoint } from "@shared/synchub-contract";

export interface UserPreferences {
    colorScheme: ColorScheme;
    metadata: PrimitiveMetadata;
}

export interface SyncHubConfig {
    endpoint: string;
    apiKey: string;
}

const storageKey = "latestnews-synchub-sync";

export function getSyncHubConfig(): SyncHubConfig {
    try {
        const raw = localStorage.getItem(storageKey);
        const value = raw ? (JSON.parse(raw) as Partial<SyncHubConfig>) : {};
        return {
            endpoint:
                typeof value.endpoint === "string" && value.endpoint.trim()
                    ? normalizeSyncHubEndpoint(value.endpoint)
                    : defaultSyncHubEndpoint,
            apiKey: typeof value.apiKey === "string" ? value.apiKey.trim() : "",
        };
    } catch {
        return { endpoint: defaultSyncHubEndpoint, apiKey: "" };
    }
}

export function saveSyncHubConfig(config: SyncHubConfig) {
    localStorage.setItem(
        storageKey,
        JSON.stringify({
            endpoint: normalizeSyncHubEndpoint(config.endpoint),
            apiKey: config.apiKey.trim(),
        })
    );
}
export function clearSyncHubConfig() {
    localStorage.removeItem(storageKey);
}
export function isSyncHubConfigured(config = getSyncHubConfig()) {
    return /^https?:\/\//i.test(config.endpoint) && config.apiKey.startsWith("shk_");
}

async function request<T>(collection: LatestNewsSyncHubCollection, init?: RequestInit): Promise<T | null> {
    const config = getSyncHubConfig();
    if (!isSyncHubConfigured(config)) return null;
    const response = await fetch(latestNewsSyncHubURL(config.endpoint, collection), {
        ...init,
        headers: { ...syncHubHeaders(config.apiKey), ...init?.headers },
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
export const downloadPreferences = () => request<UserPreferences>("preferences");
export const uploadPreferences = (preferences: UserPreferences) =>
    request("preferences", { method: "PUT", body: JSON.stringify({ payload: preferences }) });
