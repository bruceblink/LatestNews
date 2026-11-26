import type { SourceID } from "@shared/types";
import type { SourceMetadataItem, SourceMetadataResponse } from "@shared/source-metadata";

import { atom, getDefaultStore } from "jotai";
import { sourceApi } from "@shared/source-api";
import { parseRuntimeSourceCatalog, registerRuntimeSourceCatalog } from "@shared/runtime-source-catalog";

import { myFetch } from "../utils";
import { getBrowserNewsCacheScope } from "./news-reload-cache.service";

const storageKey = "latestnews:runtime-source-catalog";
const startupWaitMs = 2000;
export const RUNTIME_CATALOG_FRESH_MS = 3 * 60 * 1000;
const MAX_CATALOG_STORAGE_CHARS = 256 * 1024;
type CatalogSide = "remote" | "desktop";
type CatalogSnapshot = Record<CatalogSide | "unassigned", SourceMetadataItem[]>;
type DesktopBridge = NonNullable<Window["latestNewsDesktop"]>;

interface CatalogState {
    snapshot: CatalogSnapshot;
    loaded: Set<CatalogSide>;
    remoteCheckedAt?: number;
    remoteScope?: string;
}

const states = new WeakMap<Window, CatalogState>();
const desktopRequests = new WeakMap<DesktopBridge, Promise<void>>();
export const runtimeCatalogRevisionAtom = atom(0);

function readSnapshot(): Pick<CatalogState, "snapshot" | "remoteCheckedAt" | "remoteScope"> {
    const result: CatalogSnapshot = { remote: [], desktop: [], unassigned: [] };
    let remoteCheckedAt: number | undefined;
    let remoteScope: string | undefined;
    try {
        const raw = window.localStorage.getItem(storageKey) ?? "null";
        if (raw.length > MAX_CATALOG_STORAGE_CHARS) return { snapshot: result };
        const stored: unknown = JSON.parse(raw);
        if (Array.isArray(stored)) result.unassigned = parseRuntimeSourceCatalog(stored);
        else if (stored && typeof stored === "object") {
            const record = stored as Record<string, unknown>;
            const scope = getBrowserNewsCacheScope();
            const sameTarget = typeof record.remoteScope === "string" && record.remoteScope === scope;
            for (const side of ["remote", "desktop", "unassigned"] as const) {
                if (!(side in stored)) continue;
                if (side === "remote" && typeof record.remoteScope === "string" && !sameTarget) continue;
                try {
                    result[side] = parseRuntimeSourceCatalog(record[side]);
                    if (
                        side === "remote" &&
                        sameTarget &&
                        typeof record.remoteCheckedAt === "number" &&
                        Number.isSafeInteger(record.remoteCheckedAt) &&
                        record.remoteCheckedAt <= Date.now() &&
                        record.remoteCheckedAt > 0
                    ) {
                        remoteCheckedAt = record.remoteCheckedAt;
                        remoteScope = scope;
                    }
                } catch {
                    // A damaged snapshot for one side leaves the other side usable.
                }
            }
        }
    } catch {
        // The live directories can replace an unreadable snapshot.
    }
    return { snapshot: result, remoteCheckedAt, remoteScope };
}

function catalogState() {
    let state = states.get(window);
    if (!state) {
        state = { ...readSnapshot(), loaded: new Set() };
        states.set(window, state);
    }
    return state;
}

function registerSnapshot(state: CatalogState) {
    const merged = new Map<SourceID, SourceMetadataItem>();
    const { snapshot } = state;
    for (const sources of [snapshot.unassigned, snapshot.desktop, snapshot.remote]) {
        for (const source of sources) {
            const previous = merged.get(source.id);
            if (!previous || previous.disabled || !source.disabled) merged.set(source.id, source);
        }
    }
    registerRuntimeSourceCatalog([...merged.values()]);
    states.set(window, state);
    getDefaultStore().set(runtimeCatalogRevisionAtom, (revision) => revision + 1);
}

function replaceCatalog(side: CatalogSide, input: unknown) {
    const current = catalogState();
    const sources = new Map(parseRuntimeSourceCatalog(input).map((source) => [source.id, source]));
    for (const source of current.snapshot[side]) {
        if (!sources.has(source.id)) sources.set(source.id, { ...source, disabled: true, disableReason: "manual" });
    }
    const loaded = new Set([...current.loaded, side]);
    const reconcileUnassigned =
        loaded.has("remote") && (!window.latestNewsDesktop?.listCrawlerSourceMetadata || loaded.has("desktop"));
    const next = { ...current.snapshot, [side]: [...sources.values()] };
    next.unassigned = next.unassigned
        .filter(({ id }) => !sources.has(id))
        .map((source) => (reconcileUnassigned ? { ...source, disabled: true, disableReason: "manual" } : source));
    const remoteScope = side === "remote" ? getBrowserNewsCacheScope() : current.remoteScope;
    const remoteCheckedAt = side === "remote" && remoteScope ? Date.now() : current.remoteCheckedAt;
    registerSnapshot({ snapshot: next, loaded, remoteScope, remoteCheckedAt });
    try {
        const raw = JSON.stringify({ ...next, remoteScope, remoteCheckedAt });
        if (raw.length <= MAX_CATALOG_STORAGE_CHARS) window.localStorage.setItem(storageKey, raw);
    } catch {
        // Keep the current session usable when storage is unavailable.
    }
}

/** Use a single IPC request for startup and data access. A failed IPC call may be retried. */
export function loadDesktopRuntimeSourceCatalog(bridge: DesktopBridge) {
    if (!bridge.listCrawlerSourceMetadata) return Promise.resolve();
    const pending = desktopRequests.get(bridge);
    if (pending) return pending;
    const request = bridge
        .listCrawlerSourceMetadata()
        .then((sources) => replaceCatalog("desktop", sources))
        .catch((error: unknown) => {
            desktopRequests.delete(bridge);
            throw error;
        });
    desktopRequests.set(bridge, request);
    return request;
}

export function isDesktopOnlyRuntimeSource(id: SourceID) {
    const {
        loaded,
        snapshot: { desktop, remote },
    } = catalogState();
    return (
        loaded.has("remote") &&
        desktop.some((source) => source.id === id && !source.disabled) &&
        !remote.some((source) => source.id === id && !source.disabled)
    );
}

// Let requests finish after the first render so a slow directory can still update discovery.
export async function waitForRuntimeCatalog(pending: Promise<unknown>) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, startupWaitMs);
    });
    try {
        await Promise.race([pending, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

export async function bootstrapRuntimeSourceCatalog() {
    try {
        registerSnapshot(catalogState());
    } catch (error) {
        console.warn("Could not load the saved source catalog.", error);
    }
    const bridge = window.latestNewsDesktop;
    const cached = catalogState();
    const scope = getBrowserNewsCacheScope();
    if (scope && cached.remoteScope === scope && cached.remoteCheckedAt !== undefined) {
        if (Date.now() - cached.remoteCheckedAt < RUNTIME_CATALOG_FRESH_MS) {
            // A successfully loaded empty dynamic catalog is also a valid snapshot.
            cached.loaded.add("remote");
            return;
        }
        // Known Web catalog: render now, reconcile in the background. Cold and
        // legacy snapshots retain the original bounded startup behavior.
        void loadRemoteCatalog().catch(() => {});
        return;
    }
    const remote = bridge?.getNewsApiUrl
        ? bridge
              .getNewsApiUrl()
              .catch(() => undefined)
              .then((settings) =>
                  settings && (settings.mode === "local" || !settings.url.trim()) ? undefined : loadRemoteCatalog()
              )
        : loadRemoteCatalog();
    await waitForRuntimeCatalog(
        Promise.allSettled([remote, bridge ? loadDesktopRuntimeSourceCatalog(bridge) : Promise.resolve()])
    );
}

async function loadRemoteCatalog() {
    const response = await myFetch<SourceMetadataResponse>(sourceApi.sourcesV1);
    replaceCatalog("remote", response.data.sources);
}
