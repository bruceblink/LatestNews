import type { MetadataSyncStatus } from "@shared/metadata-sync-types";

import { atom } from "jotai";
import { metadataSyncPhases, createDefaultMetadataSyncStatus } from "@shared/metadata-sync-types";

const STORAGE_KEY = "metadata-sync-status";

function readStoredSyncStatus(): MetadataSyncStatus {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultMetadataSyncStatus();

    try {
        const parsed = JSON.parse(raw) as MetadataSyncStatus;
        if (!metadataSyncPhases.includes(parsed.phase)) {
            return createDefaultMetadataSyncStatus();
        }

        return parsed;
    } catch {
        return createDefaultMetadataSyncStatus();
    }
}

const baseSyncStatusAtom = atom(readStoredSyncStatus());

export const metadataSyncStatusAtom = atom(
    (get) => get(baseSyncStatusAtom),
    (get, set, update: MetadataSyncStatus | ((prev: MetadataSyncStatus) => MetadataSyncStatus)) => {
        const current = get(baseSyncStatusAtom);
        const nextValue = update instanceof Function ? update(current) : update;

        set(baseSyncStatusAtom, nextValue);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextValue));
    }
);
