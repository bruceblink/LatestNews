import type { SourceID } from "@shared/types";

import { atomWithStorage } from "jotai/utils";
import { shouldUseOfflineReadingSnapshot } from "@shared/offline-reading-state";

import {
    isBrowserOffline,
    hasBrowserStorageValue,
    readOfflineReadingSnapshot,
} from "../services/offline-reading-state.service";

export interface HistoryItem {
    /** 新闻条目唯一 id */
    newsId: string | number;
    /** 新闻标题 */
    title: string;
    /** 跳转 URL */
    url: string;
    /** 来源 ID */
    sourceId: SourceID;
    /** 来源名称 */
    sourceName: string;
    /** 阅读时间戳 */
    readAt: number;
}

/** 最多保留 200 条历史 */
export const MAX_HISTORY_SIZE = 200;

const STORAGE_KEY = "reading-history";

/** Restores the backup only for an offline launch that has no primary reading-history value. */
function getInitialHistory(): HistoryItem[] {
    const result = readOfflineReadingSnapshot();
    if (
        !shouldUseOfflineReadingSnapshot({
            isOffline: isBrowserOffline(),
            hasPersistedLiveValue: hasBrowserStorageValue(STORAGE_KEY),
            snapshotState: result.state,
        })
    ) {
        return [];
    }

    return result.snapshot?.history ?? [];
}

export const readingHistoryAtom = atomWithStorage<HistoryItem[]>(STORAGE_KEY, getInitialHistory(), undefined, {
    getOnInit: true,
});
