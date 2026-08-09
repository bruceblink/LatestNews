import type { SyncHubStatus } from "@shared/synchub-status";

import { atom } from "jotai";
import { latestNewsSyncHubCollections } from "@shared/synchub-contract";
import { syncHubPhases, syncHubTransitionSources, createDefaultSyncHubStatus } from "@shared/synchub-status";

const STORAGE_KEY = "latestnews-synchub-status";

/** Restores only validated, non-sensitive SyncHub status fields from local storage. */
function readStoredSyncHubStatus(): SyncHubStatus {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return createDefaultSyncHubStatus();

        const parsed = JSON.parse(raw) as Partial<SyncHubStatus>;
        if (!parsed.phase || !syncHubPhases.includes(parsed.phase)) return createDefaultSyncHubStatus();

        return {
            phase: parsed.phase,
            pendingCollections: latestNewsSyncHubCollections.filter((collection) =>
                parsed.pendingCollections?.includes(collection)
            ),
            ...(Number.isFinite(parsed.lastAttemptAt) && { lastAttemptAt: parsed.lastAttemptAt }),
            ...(Number.isFinite(parsed.lastSyncedAt) && { lastSyncedAt: parsed.lastSyncedAt }),
            ...(typeof parsed.lastErrorMessage === "string" && { lastErrorMessage: parsed.lastErrorMessage }),
            ...(parsed.lastTransitionSource && syncHubTransitionSources.includes(parsed.lastTransitionSource)
                ? { lastTransitionSource: parsed.lastTransitionSource }
                : {}),
        };
    } catch {
        return createDefaultSyncHubStatus();
    }
}

const baseSyncHubStatusAtom = atom(readStoredSyncHubStatus());

export const syncHubStatusAtom = atom(
    (get) => get(baseSyncHubStatusAtom),
    (get, set, update: SyncHubStatus | ((previous: SyncHubStatus) => SyncHubStatus)) => {
        const current = get(baseSyncHubStatusAtom);
        const next = update instanceof Function ? update(current) : update;
        set(baseSyncHubStatusAtom, next);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
);

/** Incrementing this atom asks the mounted SyncHub hook to retry its failed collections. */
export const syncHubRetryRequestAtom = atom(0);
