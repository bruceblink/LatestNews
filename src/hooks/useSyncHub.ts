import { useAtom } from "jotai";
import { useRef, useEffect } from "react";
import { colorSchemeAtom } from "~/hooks/useDark";
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
    const loaded = useRef(false);

    useEffect(() => {
        if (!isSyncHubConfigured() || loaded.current) return;
        loaded.current = true;
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
            })
            .catch(() => {
                loaded.current = false;
            });
    }, [setColorScheme, setHistory, setMetadata, setReadingState]);

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
            void uploadFavorites(readingState.favorites).catch(() => undefined);
        }, debounceMs);
        return () => clearTimeout(timer);
    }, [readingState]);

    useEffect(() => {
        if (!loaded.current || !isSyncHubConfigured()) return undefined;
        const timer = setTimeout(() => {
            void uploadPreferences({ colorScheme, metadata }).catch(() => undefined);
        }, debounceMs);
        return () => clearTimeout(timer);
    }, [colorScheme, metadata]);
}
