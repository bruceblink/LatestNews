import type { QueryKey } from "@tanstack/react-query";

import { hashKey } from "@tanstack/react-query";
import { resolveNewsApiBaseUrl } from "@shared/news-api-url";

export const NEWS_RELOAD_STORAGE_KEY = "latestnews:news-reload-cache:v1";
export const NEWS_RELOAD_MAX_AGE_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 32;
// localStorage stores UTF-16 strings. Keep both the serialized store and each
// entry bounded, leaving quota for existing reading state and offline Feed.
const MAX_STORE_CHARS = 512 * 1024;
const MAX_ENTRY_CHARS = 128 * 1024;

export interface ReloadSnapshot<T = unknown> {
    key: string;
    savedAt: number;
    data: T;
}
export type SnapshotProjection = (data: unknown) => unknown | undefined;

export function isPartialReloadData(data: unknown) {
    return Boolean(
        data &&
        typeof data === "object" &&
        "meta" in data &&
        data.meta &&
        typeof data.meta === "object" &&
        "partial" in data.meta &&
        data.meta.partial === true
    );
}
let cacheGeneration = 0;
export function getBrowserNewsCacheGeneration() {
    return cacheGeneration;
}

/** The desktop renderer shares its origin across configurable API targets.
 * Do not persist Web reload data there until it has a verified endpoint identity. */
export function getBrowserNewsCacheScope() {
    if (
        typeof window === "undefined" ||
        window.latestNewsDesktop ||
        String(import.meta.env.LATESTNEWS_DESKTOP) === "true"
    )
        return undefined;
    try {
        return new URL(resolveNewsApiBaseUrl(import.meta.env.VITE_NEWS_API_URL), window.location.origin).href;
    } catch {
        return undefined;
    }
}

function getStorage() {
    try {
        return typeof window === "undefined" ? undefined : window.localStorage;
    } catch {
        return undefined;
    }
}

/** The key covers every query parameter, including reading/hidden URLs, but
 * only a SHA-256 digest is stored. A digest is not an authentication boundary. */
export async function digestReloadKey(scope: string, kind: string, queryKey: QueryKey) {
    try {
        const bytes = new TextEncoder().encode(hashKey([scope, kind, queryKey]));
        const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
        return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    } catch {
        // An insecure origin or unavailable Web Crypto falls back to normal queries.
        return undefined;
    }
}

function readStore(storage: Storage, now: number): ReloadSnapshot[] {
    try {
        const raw = storage.getItem(NEWS_RELOAD_STORAGE_KEY);
        if (!raw || raw.length > MAX_STORE_CHARS) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length > MAX_ENTRIES) return [];
        return parsed.filter(
            (item): item is ReloadSnapshot =>
                !!item &&
                typeof item === "object" &&
                typeof item.key === "string" &&
                /^[a-f0-9]{64}$/.test(item.key) &&
                typeof item.savedAt === "number" &&
                Number.isSafeInteger(item.savedAt) &&
                item.savedAt <= now &&
                now - item.savedAt <= NEWS_RELOAD_MAX_AGE_MS &&
                Object.hasOwn(item, "data")
        );
    } catch {
        return [];
    }
}

export function readReloadSnapshot<T>(
    key: string,
    project: SnapshotProjection,
    storage = getStorage(),
    now = Date.now()
): ReloadSnapshot<T> | undefined {
    if (!storage) return undefined;
    const snapshot = readStore(storage, now).find((item) => item.key === key);
    try {
        if (!snapshot) return undefined;
        const data = project(snapshot.data);
        return data === undefined ? undefined : { ...snapshot, data: data as T };
    } catch {
        return undefined;
    }
}

export function writeReloadSnapshot(
    key: string,
    data: unknown,
    project: SnapshotProjection,
    storage = getStorage(),
    now = Date.now()
) {
    if (!storage) return false;
    try {
        if (!/^[a-f0-9]{64}$/.test(key)) return false;
        const projected = project(data);
        if (projected === undefined) return false;
        const snapshot: ReloadSnapshot = { key, savedAt: now, data: projected };
        if (JSON.stringify(snapshot).length > MAX_ENTRY_CHARS) return false;
        const existing = readStore(storage, now);
        // Preserve a complete result if a later request only resolved some sources.
        const previous = existing.find((item) => item.key === key);
        if (isPartialReloadData(projected) && previous) {
            const previousData = project(previous.data);
            if (previousData !== undefined && !isPartialReloadData(previousData)) return false;
        }
        const entries = [snapshot, ...existing.filter((item) => item.key !== key)]
            .sort((a, b) => b.savedAt - a.savedAt)
            .slice(0, MAX_ENTRIES);
        let raw = JSON.stringify(entries);
        while (raw.length > MAX_STORE_CHARS && entries.length > 1) {
            entries.pop();
            raw = JSON.stringify(entries);
        }
        storage.setItem(NEWS_RELOAD_STORAGE_KEY, raw);
        return true;
    } catch {
        // Quota, serialization and private-mode failures are not network errors.
        return false;
    }
}

export function clearBrowserNewsReloadCache() {
    cacheGeneration++;
    try {
        getStorage()?.removeItem(NEWS_RELOAD_STORAGE_KEY);
    } catch {
        /* optional cache */
    }
}
