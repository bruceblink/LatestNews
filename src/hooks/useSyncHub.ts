import { useAtom } from "jotai";
import { colorSchemeAtom } from "~/hooks/useDark";
import { useRef, useState, useEffect } from "react";
import { readingHistoryAtom } from "~/atoms/historyAtom";
import { readingStateAtom } from "~/atoms/readingStateAtom";
import { mergeSyncHubBootstrapState } from "@shared/synchub-merge";
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
    const historyRef = useRef(history);
    const readingStateRef = useRef(readingState);
    const metadataRef = useRef(metadata);
    const colorSchemeRef = useRef(colorScheme);

    historyRef.current = history;
    readingStateRef.current = readingState;
    metadataRef.current = metadata;
    colorSchemeRef.current = colorScheme;

    useEffect(() => {
        if (!isSyncHubConfigured() || loading.current || ready) return undefined;
        loading.current = true;
        let active = true;

        const bootstrap = async () => {
            const [historyResult, favoritesResult, preferencesResult] = await Promise.allSettled([
                downloadReadingHistory(),
                downloadFavorites(),
                downloadPreferences(),
            ]);
            if (!active) return;

            const merged = mergeSyncHubBootstrapState(
                {
                    history: historyRef.current,
                    favorites: readingStateRef.current.favorites,
                    preferences: {
                        colorScheme: colorSchemeRef.current,
                        metadata: metadataRef.current,
                    },
                },
                {
                    history: historyResult.status === "fulfilled" ? historyResult.value : undefined,
                    favorites: favoritesResult.status === "fulfilled" ? favoritesResult.value : undefined,
                    preferences: preferencesResult.status === "fulfilled" ? preferencesResult.value : undefined,
                },
                {
                    history: historyResult.status === "fulfilled",
                    favorites: favoritesResult.status === "fulfilled",
                    preferences: preferencesResult.status === "fulfilled",
                }
            );

            if (merged.upload.history) setHistory(merged.state.history);
            if (merged.upload.favorites) {
                setReadingState((current) => ({ ...current, favorites: merged.state.favorites }));
            }
            if (merged.upload.preferences) {
                setColorScheme(merged.state.preferences.colorScheme);
                setMetadata(preprocessMetadata(merged.state.preferences.metadata));
            }

            setReady(true);
            loading.current = false;
        };

        void bootstrap().catch(() => {
            if (active) {
                loading.current = false;
                setReady(true);
            }
        });

        return () => {
            active = false;
        };
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
            void uploadPreferences({ colorScheme, metadata, updatedAt: Date.now() }).catch(() => undefined);
        }, debounceMs);
        return () => clearTimeout(timer);
    }, [colorScheme, metadata, ready]);
}
