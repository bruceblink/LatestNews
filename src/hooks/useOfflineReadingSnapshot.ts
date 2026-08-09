import type { OfflineReadingSnapshotReadResult } from "~/services/offline-reading-state.service";

import { useAtomValue } from "jotai";
import { focusSourcesAtom } from "~/atoms";
import { readingHistoryAtom } from "~/atoms/historyAtom";
import { readingStateAtom } from "~/atoms/readingStateAtom";
import { useRef, useState, useEffect, useContext, createContext } from "react";
import { readOfflineReadingSnapshot, saveOfflineReadingSnapshot } from "~/services/offline-reading-state.service";

export interface OfflineReadingSnapshotPersistenceOptions {
    isInitialSyncComplete: boolean;
    isOffline: boolean;
}

export const OfflineReadingSnapshotContext = createContext<OfflineReadingSnapshotReadResult>({ state: "missing" });

/** Exposes the latest backup status to routes without letting routes write storage themselves. */
export function useOfflineReadingSnapshotStatus() {
    return useContext(OfflineReadingSnapshotContext);
}

/**
 * Saves a backup after the initial SyncHub merge, then after each local reading-state change.
 * An offline first launch reads the existing backup first so an empty atom cannot overwrite it.
 */
export function usePersistOfflineReadingSnapshot({
    isInitialSyncComplete,
    isOffline,
}: OfflineReadingSnapshotPersistenceOptions) {
    const history = useAtomValue(readingHistoryAtom);
    const readingState = useAtomValue(readingStateAtom);
    const focusSources = useAtomValue(focusSourcesAtom);
    const [status, setStatus] = useState<OfflineReadingSnapshotReadResult>(() => readOfflineReadingSnapshot());
    const initializedRef = useRef(false);

    useEffect(() => {
        if (!isInitialSyncComplete) return;

        if (!initializedRef.current) {
            initializedRef.current = true;
            if (isOffline) {
                setStatus(readOfflineReadingSnapshot());
                return;
            }
        }

        const snapshot = saveOfflineReadingSnapshot({
            history,
            favorites: readingState.favorites,
            focusSources,
        });
        setStatus(snapshot ? { state: "fresh", snapshot } : readOfflineReadingSnapshot());
    }, [focusSources, history, isInitialSyncComplete, isOffline, readingState.favorites]);

    return status;
}
