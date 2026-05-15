import type { SourceID } from "@shared/types";
import type { HistoryItem } from "~/atoms/historyAtom";

import { useAtom } from "jotai";
import { useCallback } from "react";
import dataSources from "@shared/data-sources";
import { MAX_HISTORY_SIZE, readingHistoryAtom } from "~/atoms/historyAtom";

export function useHistory() {
    const [history, setHistory] = useAtom(readingHistoryAtom);

    const addHistory = useCallback(
        (sourceId: SourceID, newsId: string | number, title: string, url: string) => {
            const sourceName = dataSources[sourceId]?.name ?? sourceId;
            setHistory((prev) => {
                // 去重：同 url 已存在则先移除旧记录再插入最新
                const filtered = prev.filter((item) => item.url !== url);
                const newItem: HistoryItem = {
                    newsId,
                    title,
                    url,
                    sourceId,
                    sourceName,
                    readAt: Date.now(),
                };
                return [newItem, ...filtered].slice(0, MAX_HISTORY_SIZE);
            });
        },
        [setHistory]
    );

    const clearHistory = useCallback(() => {
        setHistory([]);
    }, [setHistory]);

    const removeHistory = useCallback(
        (url: string) => {
            setHistory((prev) => prev.filter((item) => item.url !== url));
        },
        [setHistory]
    );

    const clearSourceHistory = useCallback(
        (sourceId: SourceID) => {
            setHistory((prev) => prev.filter((item) => item.sourceId !== sourceId));
        },
        [setHistory]
    );

    return { history, addHistory, clearHistory, clearSourceHistory, removeHistory };
}
