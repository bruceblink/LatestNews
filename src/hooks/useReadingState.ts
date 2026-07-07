import type { ReadingStateKind, ReadingStateItemInput } from "@shared/reading-state";

import { useAtom } from "jotai";
import { useMemo, useCallback } from "react";
import { readingStateAtom } from "~/atoms/readingStateAtom";
import {
    isHiddenReadingUrl,
    hasReadingStateItem,
    normalizeReadingState,
    removeReadingStateItem,
    createReadingStateItem,
    toggleReadingStateItem,
} from "@shared/reading-state";

export interface ReadingStateEntry {
    newsId?: string | number;
    title: string;
    url: string;
    sourceId: ReadingStateItemInput["sourceId"];
    sourceName: string;
}

export function useReadingState() {
    const [rawState, setRawState] = useAtom(readingStateAtom);
    const readingState = useMemo(() => normalizeReadingState(rawState), [rawState]);

    const toggleState = useCallback(
        (kind: ReadingStateKind, entry: ReadingStateEntry) => {
            const now = Date.now();
            const item = createReadingStateItem(entry, now);
            setRawState((prev) => toggleReadingStateItem(prev, kind, item, now));
        },
        [setRawState]
    );

    const removeState = useCallback(
        (kind: ReadingStateKind, url: string) => {
            setRawState((prev) => removeReadingStateItem(prev, kind, url));
        },
        [setRawState]
    );

    const hasState = useCallback(
        (kind: ReadingStateKind, url: string) => hasReadingStateItem(readingState, kind, url),
        [readingState]
    );

    const isHiddenUrl = useCallback((url: string) => isHiddenReadingUrl(readingState, url), [readingState]);

    const hiddenUrls = useMemo(() => readingState.hidden.map((item) => item.url), [readingState.hidden]);

    return {
        readingState,
        hiddenUrls,
        toggleLater: (entry: ReadingStateItemInput) => toggleState("later", entry),
        toggleFavorite: (entry: ReadingStateItemInput) => toggleState("favorite", entry),
        toggleHidden: (entry: ReadingStateItemInput) => toggleState("hidden", entry),
        removeState,
        isLaterUrl: (url: string) => hasState("later", url),
        isFavoriteUrl: (url: string) => hasState("favorite", url),
        isHiddenUrl,
    };
}
