import type { ReadingState } from "@shared/reading-state";

import { atomWithStorage } from "jotai/utils";
import { createDefaultReadingState } from "@shared/reading-state";
import { shouldUseOfflineReadingSnapshot } from "@shared/offline-reading-state";

import {
    isBrowserOffline,
    hasBrowserStorageValue,
    readOfflineReadingSnapshot,
} from "../services/offline-reading-state.service";

const STORAGE_KEY = "reading-state";

/** Keeps the normal local state primary, using snapshot favorites only for an offline first launch. */
function getInitialReadingState(): ReadingState {
    const initialState = createDefaultReadingState();
    const result = readOfflineReadingSnapshot();
    if (
        !shouldUseOfflineReadingSnapshot({
            isOffline: isBrowserOffline(),
            hasPersistedLiveValue: hasBrowserStorageValue(STORAGE_KEY),
            snapshotState: result.state,
        })
    ) {
        return initialState;
    }

    return {
        ...initialState,
        favorites: result.snapshot?.favorites ?? [],
    };
}

export const readingStateAtom = atomWithStorage<ReadingState>(STORAGE_KEY, getInitialReadingState(), undefined, {
    getOnInit: true,
});
