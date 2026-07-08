import { metadata } from "./metadata";
import dataSources from "./data-sources";
import { normalizeReadingStateUrl } from "./reading-state";
import { parseSourceItemsSince, normalizeSourceItemsLimit } from "./source-items";

import type { ColumnID, NewsItem, SourceID, SourceResponse } from "./types";

export const unifiedFeedScopeIds = ["focus", "hottest", "realtime", "broad"] as const;
export const unifiedFeedSinceIds = ["all", "24h", "3d", "7d"] as const;

export type UnifiedFeedScope = (typeof unifiedFeedScopeIds)[number];
export type UnifiedFeedSince = (typeof unifiedFeedSinceIds)[number];
export type UnifiedFeedCategoryID = ColumnID | "uncategorized";

export interface UnifiedFeedSearch {
    q?: string;
    scope?: UnifiedFeedScope;
    source?: SourceID;
    category?: UnifiedFeedCategoryID;
    since?: UnifiedFeedSince;
}

export interface UnifiedFeedFilters {
    keyword?: string;
    sourceId?: SourceID | "all";
    categoryId?: UnifiedFeedCategoryID | "all";
    since?: number | string;
    limit?: number | string;
    hiddenUrls?: Iterable<string>;
}

export interface NormalizedUnifiedFeedFilters {
    keyword?: string;
    sourceId?: SourceID;
    categoryId?: UnifiedFeedCategoryID;
    since?: number;
    limit?: number;
    hiddenUrls?: string[];
}

export interface UnifiedFeedItem {
    id: string;
    sourceId: SourceID;
    sourceName: string;
    categoryId: UnifiedFeedCategoryID;
    categoryName: string;
    title: string;
    url: string;
    mobileUrl?: string;
    publishedAt?: number;
    responseUpdatedTime?: number;
    item: NewsItem;
}

export interface UnifiedFeedSourceSummary {
    sourceId: SourceID;
    sourceName: string;
    itemCount: number;
    latestPublishedAt?: number;
}

export interface UnifiedFeedCategorySummary {
    categoryId: UnifiedFeedCategoryID;
    categoryName: string;
    itemCount: number;
    sourceCount: number;
    latestPublishedAt?: number;
}

export interface UnifiedFeedView {
    items: UnifiedFeedItem[];
    totalItemCount: number;
    filteredItemCount: number;
    latestPublishedAt?: number;
    activeFilters: NormalizedUnifiedFeedFilters;
    sourceSummaries: UnifiedFeedSourceSummary[];
    categorySummaries: UnifiedFeedCategorySummary[];
}

export function isUnifiedFeedScope(value: unknown): value is UnifiedFeedScope {
    return typeof value === "string" && unifiedFeedScopeIds.includes(value as UnifiedFeedScope);
}

export function isUnifiedFeedSince(value: unknown): value is UnifiedFeedSince {
    return typeof value === "string" && unifiedFeedSinceIds.includes(value as UnifiedFeedSince);
}

export function normalizeUnifiedFeedSearch(search: Record<string, unknown>): UnifiedFeedSearch {
    const q = typeof search.q === "string" ? search.q.trim() : "";
    const scope = isUnifiedFeedScope(search.scope) ? search.scope : undefined;
    const source = typeof search.source === "string" && isSelectableSourceId(search.source) ? search.source : undefined;
    const category =
        typeof search.category === "string" && isUnifiedFeedCategory(search.category) ? search.category : undefined;
    const since = isUnifiedFeedSince(search.since) ? search.since : undefined;

    return {
        ...(q && { q }),
        ...(scope && { scope }),
        ...(source && { source }),
        ...(category && { category }),
        ...(since && { since }),
    };
}

export function getUnifiedFeedScopeSources(scope: UnifiedFeedScope, focusSources: SourceID[], limit = 100): SourceID[] {
    const sources =
        scope === "focus"
            ? focusSources
            : scope === "hottest"
              ? metadata.hottest.sources
              : scope === "realtime"
                ? metadata.realtime.sources
                : [
                      ...metadata.hottest.sources.slice(0, 12),
                      ...metadata.realtime.sources.slice(0, 12),
                      ...metadata.tech.sources.slice(0, 10),
                      ...metadata.finance.sources.slice(0, 10),
                      ...metadata.china.sources.slice(0, 6),
                      ...metadata.world.sources.slice(0, 6),
                  ];

    return uniqueSources(sources.map(resolveSelectableSourceId).filter((id): id is SourceID => Boolean(id))).slice(
        0,
        limit
    );
}

export function createUnifiedFeedView(responses: SourceResponse[], filters: UnifiedFeedFilters = {}): UnifiedFeedView {
    const items = collectUnifiedFeedItems(responses);
    const activeFilters = normalizeUnifiedFeedFilters(filters);
    const filteredItems = filterUnifiedFeedItems(items, activeFilters);
    const viewItems = activeFilters.limit ? filteredItems.slice(0, activeFilters.limit) : filteredItems;

    return {
        items: viewItems,
        totalItemCount: items.length,
        filteredItemCount: filteredItems.length,
        latestPublishedAt: maxOptional(filteredItems.map((item) => item.publishedAt ?? item.responseUpdatedTime)),
        activeFilters,
        sourceSummaries: createSourceSummaries(filteredItems),
        categorySummaries: createCategorySummaries(filteredItems),
    };
}

export function collectUnifiedFeedItems(responses: SourceResponse[]): UnifiedFeedItem[] {
    return responses
        .flatMap((response) => {
            const source = dataSources[response.id];
            const sourceName = response.name ?? source?.name ?? response.id;
            const categoryId = source?.column ?? "uncategorized";
            const categoryName = getCategoryName(categoryId);
            const responseUpdatedTime = parseSourceItemsSince(response.updatedTime);

            return response.items
                .map((item): UnifiedFeedItem | undefined => {
                    const title = item.title?.trim();
                    const url = item.url?.trim();
                    if (!title || !url) return undefined;

                    return {
                        id: `${response.id}:${String(item.id)}`,
                        sourceId: response.id,
                        sourceName,
                        categoryId,
                        categoryName,
                        title,
                        url,
                        mobileUrl: item.mobileUrl,
                        publishedAt: parseSourceItemsSince(item.pubDate ?? item.extra?.date),
                        responseUpdatedTime,
                        item,
                    };
                })
                .filter((item): item is UnifiedFeedItem => Boolean(item));
        })
        .sort(
            (a, b) =>
                (b.publishedAt ?? b.responseUpdatedTime ?? 0) - (a.publishedAt ?? a.responseUpdatedTime ?? 0) ||
                a.sourceId.localeCompare(b.sourceId) ||
                a.title.localeCompare(b.title)
        );
}

export function normalizeUnifiedFeedFilters(filters: UnifiedFeedFilters): NormalizedUnifiedFeedFilters {
    const keyword = filters.keyword?.trim();
    const sourceId =
        filters.sourceId && filters.sourceId !== "all" && isSelectableSourceId(filters.sourceId)
            ? filters.sourceId
            : undefined;
    const categoryId =
        filters.categoryId && filters.categoryId !== "all" && isUnifiedFeedCategory(filters.categoryId)
            ? filters.categoryId
            : undefined;
    const since = parseSourceItemsSince(filters.since);
    const limit = normalizeSourceItemsLimit(filters.limit, 300);
    const hiddenUrls = Array.from(filters.hiddenUrls ?? [], normalizeReadingStateUrl).filter(Boolean);

    return {
        ...(keyword && { keyword }),
        ...(sourceId && { sourceId }),
        ...(categoryId && { categoryId }),
        ...(since && { since }),
        ...(limit && { limit }),
        ...(hiddenUrls.length && { hiddenUrls }),
    };
}

export function filterUnifiedFeedItems(
    items: UnifiedFeedItem[],
    filters: NormalizedUnifiedFeedFilters
): UnifiedFeedItem[] {
    const keyword = filters.keyword?.toLowerCase();
    const hiddenUrls = filters.hiddenUrls?.length ? new Set(filters.hiddenUrls) : undefined;

    return items.filter((item) => {
        if (filters.sourceId && item.sourceId !== filters.sourceId) return false;
        if (filters.categoryId && item.categoryId !== filters.categoryId) return false;
        if (filters.since && (item.publishedAt ?? item.responseUpdatedTime ?? 0) < filters.since) return false;
        if (hiddenUrls?.has(normalizeReadingStateUrl(item.url))) return false;
        if (!keyword) return true;

        return [item.title, item.sourceName, item.sourceId, item.categoryName]
            .filter(Boolean)
            .some((value) => value.toLowerCase().includes(keyword));
    });
}

function createSourceSummaries(items: UnifiedFeedItem[]): UnifiedFeedSourceSummary[] {
    const summaries = new Map<SourceID, UnifiedFeedSourceSummary>();

    for (const item of items) {
        const current = summaries.get(item.sourceId) ?? {
            sourceId: item.sourceId,
            sourceName: item.sourceName,
            itemCount: 0,
            latestPublishedAt: undefined,
        };

        current.itemCount += 1;
        current.latestPublishedAt = maxPair(current.latestPublishedAt, item.publishedAt ?? item.responseUpdatedTime);
        summaries.set(item.sourceId, current);
    }

    return [...summaries.values()].sort(
        (a, b) =>
            b.itemCount - a.itemCount ||
            (b.latestPublishedAt ?? 0) - (a.latestPublishedAt ?? 0) ||
            a.sourceName.localeCompare(b.sourceName)
    );
}

function createCategorySummaries(items: UnifiedFeedItem[]): UnifiedFeedCategorySummary[] {
    const summaries = new Map<
        UnifiedFeedCategoryID,
        { categoryName: string; itemCount: number; latestPublishedAt?: number; sources: Set<SourceID> }
    >();

    for (const item of items) {
        const current = summaries.get(item.categoryId) ?? {
            categoryName: item.categoryName,
            itemCount: 0,
            latestPublishedAt: undefined,
            sources: new Set<SourceID>(),
        };

        current.itemCount += 1;
        current.latestPublishedAt = maxPair(current.latestPublishedAt, item.publishedAt ?? item.responseUpdatedTime);
        current.sources.add(item.sourceId);
        summaries.set(item.categoryId, current);
    }

    return [...summaries.entries()]
        .map(([categoryId, summary]) => ({
            categoryId,
            categoryName: summary.categoryName,
            itemCount: summary.itemCount,
            sourceCount: summary.sources.size,
            latestPublishedAt: summary.latestPublishedAt,
        }))
        .sort(
            (a, b) =>
                b.itemCount - a.itemCount ||
                (b.latestPublishedAt ?? 0) - (a.latestPublishedAt ?? 0) ||
                a.categoryName.localeCompare(b.categoryName)
        );
}

function isUnifiedFeedCategory(value: string): value is UnifiedFeedCategoryID {
    return value === "uncategorized" || value in metadata;
}

function isSelectableSourceId(id: string): id is SourceID {
    const source = dataSources[id as SourceID];
    return Boolean(source && !source.redirect);
}

function resolveSelectableSourceId(id: SourceID): SourceID | undefined {
    const redirectId = dataSources[id]?.redirect;
    const resolvedId = redirectId ?? id;
    return isSelectableSourceId(resolvedId) ? resolvedId : undefined;
}

function getCategoryName(categoryId: UnifiedFeedCategoryID) {
    if (categoryId === "uncategorized") return "未分类";
    return metadata[categoryId]?.name ?? categoryId;
}

function uniqueSources(sources: SourceID[]) {
    return Array.from(new Set(sources));
}

function maxOptional(values: Array<number | undefined>) {
    const definedValues = values.filter((value): value is number => typeof value === "number");
    return definedValues.length ? Math.max(...definedValues) : undefined;
}

function maxPair(current: number | undefined, next: number | undefined) {
    if (current === undefined) return next;
    if (next === undefined) return current;
    return Math.max(current, next);
}
