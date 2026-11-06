import type { SourceAdapterKind } from "@shared/source-adapter";
import type { SourceHealthStatus } from "@shared/source-health-types";

export type SourceHealthFilterStatus = "all" | SourceHealthStatus | "cache-degraded";
export type SourceHealthFilterAdapterKind = "all" | SourceAdapterKind;

export interface SourceHealthFilterItem {
    id: string;
    name: string;
    status: SourceHealthStatus;
    cacheDegraded: boolean;
    adapterKind?: SourceAdapterKind;
}

export interface SourceHealthFilters {
    keyword?: string;
    status?: SourceHealthFilterStatus;
    adapterKind?: SourceHealthFilterAdapterKind;
}

export function hasSourceHealthFilters(filters: SourceHealthFilters) {
    return !!filters.keyword?.trim() || (filters.status ?? "all") !== "all" || (filters.adapterKind ?? "all") !== "all";
}

export function filterSourceHealthSnapshots<T extends SourceHealthFilterItem>(
    sources: T[],
    filters: SourceHealthFilters
) {
    const status = filters.status ?? "all";
    const adapterKind = filters.adapterKind ?? "all";
    const keyword = filters.keyword?.trim().toLowerCase() ?? "";

    return sources.filter((source) => {
        const matchesStatus =
            status === "all" || (status === "cache-degraded" ? source.cacheDegraded : source.status === status);
        const matchesAdapterKind = adapterKind === "all" || source.adapterKind === adapterKind;
        const matchesKeyword =
            !keyword || source.name.toLowerCase().includes(keyword) || source.id.toLowerCase().includes(keyword);

        return matchesStatus && matchesAdapterKind && matchesKeyword;
    });
}
