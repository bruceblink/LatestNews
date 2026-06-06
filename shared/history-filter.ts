import type { SourceID } from "@shared/types";

export interface ReadingHistoryFilterItem {
    title: string;
    sourceName: string;
    sourceId: SourceID;
}

export interface ReadingHistoryFilters {
    keyword?: string;
    sourceId?: SourceID | "";
}

export function hasReadingHistoryFilters(filters: ReadingHistoryFilters) {
    return !!filters.keyword?.trim() || !!filters.sourceId;
}

export function filterReadingHistory<T extends ReadingHistoryFilterItem>(items: T[], filters: ReadingHistoryFilters) {
    const keyword = filters.keyword?.trim().toLowerCase() ?? "";

    return items.filter((item) => {
        const matchesKeyword =
            !keyword || item.title.toLowerCase().includes(keyword) || item.sourceName.toLowerCase().includes(keyword);
        const matchesSource = !filters.sourceId || item.sourceId === filters.sourceId;

        return matchesKeyword && matchesSource;
    });
}
