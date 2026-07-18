import { useAtom } from "jotai";
import { useRef, useEffect } from "react";
import { readingHistoryAtom } from "~/atoms/historyAtom";
import { readingStateAtom } from "~/atoms/readingStateAtom";
import { normalizeReadingState } from "@shared/reading-state";
import {
    uploadFavorites,
    downloadFavorites,
    isSyncHubConfigured,
    uploadReadingHistory,
    downloadReadingHistory,
} from "~/services/synchub.service";

const debounceMs = 3000;

export function useSyncHub() {
    const [history, setHistory] = useAtom(readingHistoryAtom);
    const [readingState, setReadingState] = useAtom(readingStateAtom);
    const loaded = useRef(false);

    useEffect(() => {
        if (!isSyncHubConfigured() || loaded.current) return;
        loaded.current = true;
        void Promise.all([downloadReadingHistory(), downloadFavorites()])
            .then(([remoteHistory, remoteState]) => {
                if (Array.isArray(remoteHistory)) setHistory(remoteHistory);
                if (remoteState) setReadingState(normalizeReadingState(remoteState));
            })
            .catch(() => {
                loaded.current = false;
            });
    }, [setHistory, setReadingState]);

    useEffect(() => {
        if (!loaded.current || !isSyncHubConfigured()) return undefined;
        const timer = setTimeout(() => {
            void uploadReadingHistory(history).catch(() => undefined);
        }, debounceMs);
        return () => clearTimeout(timer);
    }, [history]);

    useEffect(() => {
        if (!loaded.current || !isSyncHubConfigured()) return undefined;
        const timer = setTimeout(() => {
            void uploadFavorites(readingState).catch(() => undefined);
        }, debounceMs);
        return () => clearTimeout(timer);
    }, [readingState]);
}
