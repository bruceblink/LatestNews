import { useAtom } from "jotai";
import { colorSchemeAtom } from "~/hooks/useDark";
import { useRef, useState, useEffect } from "react";
import { readingHistoryAtom } from "~/atoms/historyAtom";
import { readingStateAtom } from "~/atoms/readingStateAtom";
import { preprocessMetadata, primitiveMetadataAtom } from "~/atoms/primitiveMetadataAtom";
import {
    uploadFavorites,
    downloadFavorites,
    uploadPreferences,
    isSyncHubConfigured,
    downloadPreferences,
    uploadReadingHistory,
    downloadReadingHistory,
} from "~/services/synchub.service";

const debounceMs = 3000;

export function useSyncHub() {
    const [history, setHistory] = useAtom(readingHistoryAtom);
    const [readingState, setReadingState] = useAtom(readingStateAtom);
    const [metadata, setMetadata] = useAtom(primitiveMetadataAtom);
    const [colorScheme, setColorScheme] = useAtom(colorSchemeAtom);
    const loading = useRef(false);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        if (!isSyncHubConfigured() || loading.current || ready) return;
        loading.current = true;
        void Promise.all([downloadReadingHistory(), downloadFavorites(), downloadPreferences()])
            .then(([remoteHistory, remoteState, remotePreferences]) => {
                if (Array.isArray(remoteHistory)) setHistory(remoteHistory);
                if (Array.isArray(remoteState)) {
                    setReadingState((current) => ({ ...current, favorites: remoteState }));
                }
                if (remotePreferences) {
                    if (["dark", "light", "auto"].includes(remotePreferences.colorScheme)) {
                        setColorScheme(remotePreferences.colorScheme);
                    }
                    if (remotePreferences.metadata) {
                        setMetadata(preprocessMetadata(remotePreferences.metadata));
                    }
                }
                setReady(true);
            })
            .catch(() => {
                loading.current = false;
            });
    }, [ready, setColorScheme, setHistory, setMetadata, setReadingState]);

    useEffect(() => {
        if (!ready || !isSyncHubConfigured()) return undefined;
        const timer = setTimeout(() => {
            void uploadReadingHistory(history).catch(() => undefined);
        }, debounceMs);
        return () => clearTimeout(timer);
    }, [history, ready]);

    useEffect(() => {
        if (!ready || !isSyncHubConfigured()) return undefined;
        const timer = setTimeout(() => {
            void uploadFavorites(readingState.favorites).catch(() => undefined);
        }, debounceMs);
        return () => clearTimeout(timer);
    }, [readingState, ready]);

    useEffect(() => {
        if (!ready || !isSyncHubConfigured()) return undefined;
        const timer = setTimeout(() => {
            void uploadPreferences({ colorScheme, metadata }).catch(() => undefined);
        }, debounceMs);
        return () => clearTimeout(timer);
    }, [colorScheme, metadata, ready]);
}
