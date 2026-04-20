import type { SourceID } from "@shared/types";

import { atomWithStorage } from "jotai/utils";

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

export const readingHistoryAtom = atomWithStorage<HistoryItem[]>("reading-history", []);
