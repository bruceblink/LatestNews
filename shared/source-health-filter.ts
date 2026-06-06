import type { SourceHealthStatus } from "@shared/source-health-types";

export type SourceHealthFilterStatus = "all" | SourceHealthStatus | "cache-degraded";

export interface SourceHealthFilterItem {
    id: string;
    name: string;
    status: SourceHealthStatus;
    cacheDegraded: boolean;
}

export interface SourceHealthFilters {
    keyword?: string;
    status?: SourceHealthFilterStatus;
}

export function filterSourceHealthSnapshots<T extends SourceHealthFilterItem>(
    sources: T[],
    filters: SourceHealthFilters
) {
    const status = filters.status ?? "all";
    const keyword = filters.keyword?.trim().toLowerCase() ?? "";

    return sources.filter((source) => {
        const matchesStatus =
            status === "all" || (status === "cache-degraded" ? source.cacheDegraded : source.status === status);
        const matchesKeyword =
            !keyword || source.name.toLowerCase().includes(keyword) || source.id.toLowerCase().includes(keyword);

        return matchesStatus && matchesKeyword;
    });
}
