import type { SyncHubTransitionSource } from "@shared/synchub-status";
import type { LatestNewsSyncHubCollection } from "@shared/synchub-contract";

import { useAtom, useAtomValue } from "jotai";
import { colorSchemeAtom } from "~/hooks/useDark";
import { readingHistoryAtom } from "~/atoms/historyAtom";
import { readingStateAtom } from "~/atoms/readingStateAtom";
import { useRef, useState, useEffect, useCallback } from "react";
import { SyncHubUploadQueue } from "@shared/synchub-upload-queue";
import { mergeSyncHubBootstrapState } from "@shared/synchub-merge";
import { latestNewsSyncHubCollections } from "@shared/synchub-contract";
import { syncHubStatusAtom, syncHubRetryRequestAtom } from "~/atoms/syncHubStatusAtom";
import { preprocessMetadata, primitiveMetadataAtom } from "~/atoms/primitiveMetadataAtom";
import { toSyncHubPendingStatus, toSyncHubSyncingStatus, toSyncHubUploadResultStatus } from "@shared/synchub-status";
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
    const [syncHubStatus, setSyncHubStatus] = useAtom(syncHubStatusAtom);
    const retryRequest = useAtomValue(syncHubRetryRequestAtom);
    const loading = useRef(false);
    const [ready, setReady] = useState(false);
    const historyRef = useRef(history);
    const readingStateRef = useRef(readingState);
    const metadataRef = useRef(metadata);
    const colorSchemeRef = useRef(colorScheme);
    const syncHubStatusRef = useRef(syncHubStatus);
    const uploadQueueRef = useRef<SyncHubUploadQueue | undefined>(undefined);
    const observedReadyCollectionsRef = useRef(new Set<LatestNewsSyncHubCollection>());
    const bootstrapUploadCollectionsRef = useRef(new Set<LatestNewsSyncHubCollection>());
    const handledRetryRequestRef = useRef(retryRequest);

    historyRef.current = history;
    readingStateRef.current = readingState;
    metadataRef.current = metadata;
    colorSchemeRef.current = colorScheme;
    syncHubStatusRef.current = syncHubStatus;

    const uploadCollection = useCallback(async (collection: LatestNewsSyncHubCollection) => {
        if (collection === "reading-history") return uploadReadingHistory(historyRef.current);
        if (collection === "favorites") return uploadFavorites(readingStateRef.current.favorites);
        return uploadPreferences({
            colorScheme: colorSchemeRef.current,
            metadata: metadataRef.current,
            updatedAt: Date.now(),
        });
    }, []);

    if (!uploadQueueRef.current) {
        uploadQueueRef.current = new SyncHubUploadQueue({
            debounceMs,
            run: async (collections) => {
                const results = await Promise.allSettled(collections.map(uploadCollection));
                const failed = collections.filter((_, index) => results[index].status === "rejected");
                const firstFailure = results.find((result) => result.status === "rejected");

                return {
                    failed,
                    error: firstFailure?.status === "rejected" ? firstFailure.reason : undefined,
                };
            },
            onQueued: (pendingCollections, source) => {
                setSyncHubStatus((previous) => toSyncHubPendingStatus(previous, pendingCollections, source));
            },
            onStart: (collections, source) => {
                setSyncHubStatus((previous) => toSyncHubSyncingStatus(previous, collections, source));
            },
            onResult: ({ attempted, failed, queuedDuringUpload, source, error }) => {
                setSyncHubStatus((previous) => {
                    const result = toSyncHubUploadResultStatus(previous, attempted, failed, source, error);
                    return queuedDuringUpload.length > 0
                        ? toSyncHubPendingStatus(result, queuedDuringUpload, "auto-upload")
                        : result;
                });
            },
        });
    }

    /** Adds changed collections to one shared debounce window so rapid edits produce one batch. */
    const queueUploads = useCallback(
        (
            collections: LatestNewsSyncHubCollection[],
            source: SyncHubTransitionSource = "auto-upload",
            delay = debounceMs
        ) => {
            uploadQueueRef.current?.enqueue(collections, source, delay);
        },
        []
    );

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

            bootstrapUploadCollectionsRef.current = new Set(
                latestNewsSyncHubCollections.filter((collection) => {
                    if (collection === "reading-history") return merged.upload.history;
                    if (collection === "favorites") return merged.upload.favorites;
                    return merged.upload.preferences;
                })
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
                bootstrapUploadCollectionsRef.current = new Set();
                setReady(true);
            }
        });

        return () => {
            active = false;
        };
    }, [ready, setColorScheme, setHistory, setMetadata, setReadingState]);

    useEffect(() => {
        if (!ready || !isSyncHubConfigured()) return undefined;
        const collection = "reading-history" as const;
        const firstReadyRun = !observedReadyCollectionsRef.current.has(collection);
        observedReadyCollectionsRef.current.add(collection);
        if (firstReadyRun && !bootstrapUploadCollectionsRef.current.has(collection)) return undefined;

        queueUploads([collection]);
        return undefined;
    }, [history, queueUploads, ready]);

    useEffect(() => {
        if (!ready || !isSyncHubConfigured()) return undefined;
        const collection = "favorites" as const;
        const firstReadyRun = !observedReadyCollectionsRef.current.has(collection);
        observedReadyCollectionsRef.current.add(collection);
        if (firstReadyRun && !bootstrapUploadCollectionsRef.current.has(collection)) return undefined;

        queueUploads([collection]);
        return undefined;
    }, [queueUploads, readingState.favorites, ready]);

    useEffect(() => {
        if (!ready || !isSyncHubConfigured()) return undefined;
        const collection = "preferences" as const;
        const firstReadyRun = !observedReadyCollectionsRef.current.has(collection);
        observedReadyCollectionsRef.current.add(collection);
        if (firstReadyRun && !bootstrapUploadCollectionsRef.current.has(collection)) return undefined;

        queueUploads([collection]);
        return undefined;
    }, [colorScheme, metadata, queueUploads, ready]);

    useEffect(() => {
        if (!ready || retryRequest === handledRetryRequestRef.current || !isSyncHubConfigured()) return;
        handledRetryRequestRef.current = retryRequest;

        const collections = syncHubStatusRef.current.pendingCollections;
        if (collections.length > 0) queueUploads(collections, "retry-upload", 0);
    }, [queueUploads, ready, retryRequest]);

    useEffect(
        () => () => {
            uploadQueueRef.current?.dispose();
        },
        []
    );
}
