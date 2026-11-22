import type { SourceID } from "@shared/types";
import type { SourceMetadataItem, SourceMetadataResponse } from "@shared/source-metadata";

import { atom, getDefaultStore } from "jotai";
import { sourceApi } from "@shared/source-api";
import { parseRuntimeSourceCatalog, registerRuntimeSourceCatalog } from "@shared/runtime-source-catalog";

import { myFetch } from "../utils";

const storageKey = "latestnews:runtime-source-catalog";
const startupWaitMs = 2000;
type CatalogSide = "remote" | "desktop";
type CatalogSnapshot = Record<CatalogSide | "unassigned", SourceMetadataItem[]>;
type DesktopBridge = NonNullable<Window["latestNewsDesktop"]>;

interface CatalogState {
    snapshot: CatalogSnapshot;
    loaded: Set<CatalogSide>;
}

const states = new WeakMap<Window, CatalogState>();
const desktopRequests = new WeakMap<DesktopBridge, Promise<void>>();
export const runtimeCatalogRevisionAtom = atom(0);

function readSnapshot(): CatalogSnapshot {
    const result: CatalogSnapshot = { remote: [], desktop: [], unassigned: [] };
    try {
        const stored: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
        if (Array.isArray(stored)) result.unassigned = parseRuntimeSourceCatalog(stored);
        else if (stored && typeof stored === "object") {
            for (const side of ["remote", "desktop", "unassigned"] as const) {
                if (!(side in stored)) continue;
                try {
                    result[side] = parseRuntimeSourceCatalog((stored as Record<string, unknown>)[side]);
                } catch {
                    // A damaged snapshot for one side leaves the other side usable.
                }
            }
        }
    } catch {
        // The live directories can replace an unreadable snapshot.
    }
    return result;
}

function catalogState() {
    let state = states.get(window);
    if (!state) {
        state = { snapshot: readSnapshot(), loaded: new Set() };
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
    registerSnapshot({ snapshot: next, loaded });
    try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
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
