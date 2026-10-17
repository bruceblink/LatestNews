import type { HistoryItem } from "~/atoms/historyAtom";
import type { ReadingState } from "@shared/reading-state";
import type { SyncHubPreferences } from "@shared/synchub-merge";
import type { LatestNewsSyncHubCollection } from "@shared/synchub-contract";

import {
    syncHubHeaders,
    latestNewsSyncHubURL,
    defaultSyncHubEndpoint,
    normalizeSyncHubEndpoint,
    verifyLatestNewsSyncHubConnection,
} from "@shared/synchub-contract";

export { defaultSyncHubEndpoint } from "@shared/synchub-contract";

export type UserPreferences = SyncHubPreferences;

export interface SyncHubConfig {
    endpoint: string;
    apiKey: string;
}

const storageKey = "latestnews-synchub-sync";
const desktopKeyPresentKey = "latestnews-synchub-key-present";
const isDesktop = import.meta.env.LATESTNEWS_DESKTOP === true;
let legacyKeyMigration: Promise<void> | null = null;

function readStoredConfig(): SyncHubConfig {
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

/** Move older plaintext desktop credentials into Windows encrypted storage before use. */
function migrateLegacyDesktopKey() {
    if (!isDesktop || !window.latestNewsDesktop) return Promise.resolve();
    if (legacyKeyMigration) return legacyKeyMigration;

    const stored = readStoredConfig();
    if (!stored.apiKey) return Promise.resolve();

    legacyKeyMigration = window.latestNewsDesktop
        .setSyncHubApiKey(stored.apiKey)
        .then(() => {
            localStorage.setItem(storageKey, JSON.stringify({ endpoint: stored.endpoint, apiKey: "" }));
            localStorage.setItem(desktopKeyPresentKey, "true");
        })
        .finally(() => {
            legacyKeyMigration = null;
        });

    return legacyKeyMigration;
}

function hasSavedDesktopKey() {
    const legacyKey = readStoredConfig().apiKey;
    return localStorage.getItem(desktopKeyPresentKey) === "true" || legacyKey.startsWith("shk_");
}

export function getSyncHubConfig(): SyncHubConfig {
    const config = readStoredConfig();
    if (!isDesktop) return config;

    void migrateLegacyDesktopKey().catch((error: unknown) => {
        console.warn("Could not migrate the saved SyncHub key to secure storage.", error);
    });
    return { endpoint: config.endpoint, apiKey: "" };
}

export async function saveSyncHubConfig(config: SyncHubConfig) {
    const endpoint = normalizeSyncHubEndpoint(config.endpoint);
    const apiKey = config.apiKey.trim();

    if (isDesktop) {
        if (!window.latestNewsDesktop) throw new Error("Desktop secure storage is unavailable.");
        await migrateLegacyDesktopKey();
        if (apiKey) {
            await window.latestNewsDesktop.setSyncHubApiKey(apiKey);
            localStorage.setItem(desktopKeyPresentKey, "true");
        }
        localStorage.setItem(storageKey, JSON.stringify({ endpoint, apiKey: "" }));
        return;
    }

    localStorage.setItem(storageKey, JSON.stringify({ endpoint, apiKey }));
}

export async function clearSyncHubConfig() {
    if (isDesktop) {
        if (!window.latestNewsDesktop) throw new Error("Desktop secure storage is unavailable.");
        await window.latestNewsDesktop.clearSyncHubApiKey();
    }
    localStorage.removeItem(storageKey);
    localStorage.removeItem(desktopKeyPresentKey);
}

export function isSyncHubConfigured(config = getSyncHubConfig()) {
    const hasApiKey = isDesktop ? hasSavedDesktopKey() : config.apiKey.startsWith("shk_");
    return /^https?:\/\//i.test(config.endpoint) && hasApiKey;
}

export async function verifySyncHubConnection(endpoint: string, apiKey: string) {
    if (!isDesktop) return verifyLatestNewsSyncHubConnection(endpoint, apiKey);
    if (!window.latestNewsDesktop) return { ok: false, message: "桌面安全存储不可用" } as const;

    try {
        await migrateLegacyDesktopKey();
        const enteredApiKey = apiKey.trim();
        if (enteredApiKey && !enteredApiKey.startsWith("shk_"))
            return { ok: false, message: "请输入有效的 LatestNews API Key" } as const;

        const result = await window.latestNewsDesktop.verifySyncHub(endpoint, enteredApiKey || undefined);
        const payload = result.bodyText
            ? (JSON.parse(result.bodyText) as { code?: number | string; message?: string })
            : {};
        if ((result.status >= 200 && result.status < 300) || (result.status === 404 && payload.code === "NOT_FOUND")) {
            return { ok: true, message: "连接成功，API Key 可用于 LatestNews 同步" } as const;
        }
        return { ok: false, message: payload.message || `连接失败（HTTP ${result.status}）` } as const;
    } catch (error) {
        if (
            error instanceof Error &&
            (error.message.includes("SyncHub 地址已更改") || error.message.includes("没有已保存的 SyncHub API Key"))
        ) {
            return { ok: false, message: error.message } as const;
        }
        return { ok: false, message: "无法连接 SyncHub，请检查服务地址和网络" } as const;
    }
}

async function request<T>(collection: LatestNewsSyncHubCollection, init?: RequestInit): Promise<T | null> {
    const config = getSyncHubConfig();
    if (!isSyncHubConfigured(config)) return null;

    if (isDesktop) {
        if (!window.latestNewsDesktop) throw new Error("Desktop secure storage is unavailable.");
        await migrateLegacyDesktopKey();
        const response = await window.latestNewsDesktop.requestSyncHub(
            collection,
            init?.method ?? "GET",
            typeof init?.body === "string" ? init.body : undefined
        );
        const result = JSON.parse(response.bodyText) as {
            code: number;
            message?: string;
            data?: { payload: T | null };
        };
        if (response.status < 200 || response.status >= 300 || result.code !== 0) {
            throw new Error(result.message || "SyncHub request failed");
        }
        return result.data?.payload ?? null;
    }

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
