import { metadata } from "./metadata";
import dataSources from "./data-sources";
import {
    getInsightSourceWeight,
    type InsightCategoryID,
    getInsightCategoryWeight,
    formatInsightRankingReason,
} from "./source-ranking-policy";

import type { NewsItem, SourceID, ColumnID, SourceResponse } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_HOT_LIMIT = 20;
const DEFAULT_TOPIC_LIMIT = 20;
const DEFAULT_WORD_LIMIT = 40;
const DEFAULT_TREND_LIMIT = 12;
const DEFAULT_MIN_TOPIC_ITEMS = 2;
const TREND_WINDOW_CONFIG = {
    "24h": {
        durationMs: DAY_MS,
        bucketMs: 4 * 60 * 60 * 1000,
    },
    "7d": {
        durationMs: 7 * DAY_MS,
        bucketMs: DAY_MS,
    },
} as const;
const TRACKING_QUERY_PATTERN = /^(utm_|spm$|from$|ref$|source$|share$|fbclid$|gclid$|igshid$|yclid$)/i;

const DEFAULT_STOP_WORDS = new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "that",
    "the",
    "to",
    "with",
    "今日",
    "今天",
    "快讯",
    "新闻",
    "最新",
    "消息",
    "发布",
    "宣布",
    "回应",
    "更新",
    "一个",
    "我们",
    "他们",
    "进行",
    "相关",
]);

export interface NewsInsightOptions {
    generatedAt?: number;
    hotLimit?: number;
    topicLimit?: number;
    wordLimit?: number;
    trendLimit?: number;
    trendWindow?: InsightTrendWindow;
    minTopicItems?: number;
    sourceWeights?: Partial<Record<SourceID, number>>;
    categoryWeights?: Partial<Record<InsightCategoryID, number>>;
    readUrls?: Iterable<string>;
    hiddenUrls?: Iterable<string>;
    stopWords?: Iterable<string>;
}

export type InsightTrendWindow = keyof typeof TREND_WINDOW_CONFIG;

export interface InsightSourceItem {
    id: string;
    sourceId: SourceID;
    sourceName?: string;
    title: string;
    url: string;
    mobileUrl?: string;
    publishedAt?: number;
    responseUpdatedTime?: number;
    canonicalUrl: string;
    terms: string[];
    sourceWeight: number;
    categoryId: InsightCategoryID;
    categoryName: string;
    categoryWeight: number;
    isRead: boolean;
    item: NewsItem;
}

export interface HotNewsSignals {
    sourceCoverage: number;
    duplicateCount: number;
    recencyScore: number;
    sourceWeight: number;
    categoryWeight: number;
    readPenalty: number;
    categoryDistribution: HotNewsCategorySignal[];
    rankingReason: string;
}

export interface HotNewsCategorySignal {
    categoryId: InsightCategoryID;
    categoryName: string;
    itemCount: number;
    sourceCount: number;
}

export interface HotNewsItem {
    rank: number;
    id: string;
    title: string;
    url: string;
    mobileUrl?: string;
    sourceId: SourceID;
    sourceName?: string;
    publishedAt?: number;
    score: number;
    sources: SourceID[];
    sourceNames: string[];
    itemCount: number;
    keywords: string[];
    signals: HotNewsSignals;
}

export interface TopicEventItem {
    id: string;
    sourceId: SourceID;
    sourceName?: string;
    title: string;
    url: string;
    publishedAt?: number;
}

export interface TopicEvent {
    id: string;
    title: string;
    canonicalUrl?: string;
    sources: SourceID[];
    sourceNames: string[];
    itemCount: number;
    firstPublishedAt?: number;
    latestPublishedAt?: number;
    keywords: string[];
    items: TopicEventItem[];
}

export interface WordCloudTerm {
    term: string;
    count: number;
    weight: number;
    sources: SourceID[];
    latestPublishedAt?: number;
}

export interface SourceActivity {
    sourceId: SourceID;
    sourceName?: string;
    itemCount: number;
    latestPublishedAt?: number;
}

export interface CategoryShare {
    categoryId: ColumnID | "uncategorized";
    categoryName: string;
    itemCount: number;
    sourceCount: number;
    ratio: number;
    latestPublishedAt?: number;
}

export interface InsightTimeBucket {
    startAt: number;
    endAt: number;
    itemCount: number;
    sourceCount: number;
}

export interface KeywordTrend {
    term: string;
    totalCount: number;
    sourceCount: number;
    latestPublishedAt?: number;
    buckets: InsightTimeBucket[];
}

export interface NewsInsights {
    generatedAt: number;
    sourceCount: number;
    itemCount: number;
    hotRankings: HotNewsItem[];
    topicEvents: TopicEvent[];
    wordCloud: WordCloudTerm[];
    sourceActivity: SourceActivity[];
    categoryShares: CategoryShare[];
    updateFrequency: InsightTimeBucket[];
    keywordTrends: KeywordTrend[];
}

interface TopicGroup {
    id: string;
    items: InsightSourceItem[];
}

interface MutableInsightTimeBucket {
    startAt: number;
    endAt: number;
    itemCount: number;
    sourceIds: Set<SourceID>;
}

interface MutableKeywordTrend {
    term: string;
    totalCount: number;
    latestPublishedAt?: number;
    sourceIds: Set<SourceID>;
    buckets: Map<number, { itemCount: number; sourceIds: Set<SourceID> }>;
}

export function createNewsInsights(responses: SourceResponse[], options: NewsInsightOptions = {}): NewsInsights {
    const generatedAt = options.generatedAt ?? Date.now();
    const items = collectInsightItems(responses, { ...options, generatedAt });

    return {
        generatedAt,
        sourceCount: new Set(responses.map((response) => response.id)).size,
        itemCount: items.length,
        hotRankings: rankHotNews(items, { ...options, generatedAt }),
        topicEvents: createTopicEvents(items, { ...options, generatedAt }),
        wordCloud: createWordCloud(items, { ...options, generatedAt }),
        sourceActivity: createSourceActivity(items),
        categoryShares: createCategoryShares(items),
        updateFrequency: createUpdateFrequency(items, { ...options, generatedAt }),
        keywordTrends: createKeywordTrends(items, { ...options, generatedAt }),
    };
}

export function collectInsightItems(
    responses: SourceResponse[],
    options: NewsInsightOptions = {}
): InsightSourceItem[] {
    const generatedAt = options.generatedAt ?? Date.now();
    const sourceWeights = options.sourceWeights ?? {};
    const readUrls = new Set(Array.from(options.readUrls ?? [], normalizeNewsUrl));
    const hiddenUrls = new Set(Array.from(options.hiddenUrls ?? [], normalizeNewsUrl));
    const items: InsightSourceItem[] = [];

    for (const response of responses) {
        const responseUpdatedTime = parseNewsTime(response.updatedTime);
        const sourceWeight = Math.max(0, sourceWeights[response.id] ?? getInsightSourceWeight(response.id));

        for (const item of response.items) {
            const title = item.title?.trim();
            const url = item.url?.trim();
            if (!title || !url) continue;

            const canonicalUrl = normalizeNewsUrl(url);
            if (hiddenUrls.has(canonicalUrl)) continue;

            const publishedAt = parseNewsTime(item.pubDate ?? item.extra?.date);
            const terms = extractInsightTerms(title, options);
            const categoryId = getSourceCategoryId(response.id);
            const fallbackId = `${response.id}:${canonicalUrl || title}:${items.length}`;

            items.push({
                id: String(item.id ?? fallbackId),
                sourceId: response.id,
                sourceName: response.name,
                title,
                url,
                mobileUrl: item.mobileUrl,
                publishedAt,
                responseUpdatedTime: responseUpdatedTime ?? generatedAt,
                canonicalUrl,
                terms,
                sourceWeight,
                categoryId,
                categoryName: getCategoryName(categoryId),
                categoryWeight: Math.max(
                    0,
                    options.categoryWeights?.[categoryId] ?? getInsightCategoryWeight(categoryId)
                ),
                isRead: readUrls.has(canonicalUrl),
                item,
            });
        }
    }

    return items;
}

export function rankHotNews(items: InsightSourceItem[], options: NewsInsightOptions = {}): HotNewsItem[] {
    const generatedAt = options.generatedAt ?? Date.now();
    const groups = createTopicGroups(items);

    return groups
        .map((group) => createHotNewsItem(group, generatedAt))
        .sort(
            (a, b) => b.score - a.score || (b.publishedAt ?? 0) - (a.publishedAt ?? 0) || a.title.localeCompare(b.title)
        )
        .slice(0, options.hotLimit ?? DEFAULT_HOT_LIMIT)
        .map((item, index) => ({ ...item, rank: index + 1 }));
}

export function createTopicEvents(items: InsightSourceItem[], options: NewsInsightOptions = {}): TopicEvent[] {
    const minTopicItems = options.minTopicItems ?? DEFAULT_MIN_TOPIC_ITEMS;

    return createTopicGroups(items)
        .filter((group) => group.items.length >= minTopicItems || uniqueSourceIds(group.items).length > 1)
        .map(createTopicEvent)
        .sort(
            (a, b) =>
                (b.latestPublishedAt ?? 0) - (a.latestPublishedAt ?? 0) ||
                b.itemCount - a.itemCount ||
                a.title.localeCompare(b.title)
        )
        .slice(0, options.topicLimit ?? DEFAULT_TOPIC_LIMIT);
}

export function createWordCloud(items: InsightSourceItem[], options: NewsInsightOptions = {}): WordCloudTerm[] {
    const generatedAt = options.generatedAt ?? Date.now();
    const terms = new Map<string, WordCloudTerm>();

    for (const item of items) {
        for (const term of new Set(item.terms)) {
            const current = terms.get(term) ?? {
                term,
                count: 0,
                weight: 0,
                sources: [],
                latestPublishedAt: undefined,
            };
            const recencyScore = getRecencyScore(item.publishedAt ?? item.responseUpdatedTime, generatedAt);

            current.count += 1;
            current.weight = roundScore(current.weight + item.sourceWeight * (1 + recencyScore));
            current.latestPublishedAt = maxOptional(current.latestPublishedAt, item.publishedAt);
            current.sources = addUniqueSource(current.sources, item.sourceId);
            terms.set(term, current);
        }
    }

    return [...terms.values()]
        .sort(
            (a, b) =>
                b.weight - a.weight ||
                b.count - a.count ||
                (b.latestPublishedAt ?? 0) - (a.latestPublishedAt ?? 0) ||
                a.term.localeCompare(b.term)
        )
        .slice(0, options.wordLimit ?? DEFAULT_WORD_LIMIT);
}

export function createSourceActivity(items: InsightSourceItem[]): SourceActivity[] {
    const activity = new Map<SourceID, SourceActivity>();

    for (const item of items) {
        const current = activity.get(item.sourceId) ?? {
            sourceId: item.sourceId,
            sourceName: item.sourceName,
            itemCount: 0,
            latestPublishedAt: undefined,
        };

        current.itemCount += 1;
        current.latestPublishedAt = maxOptional(current.latestPublishedAt, item.publishedAt);
        activity.set(item.sourceId, current);
    }

    return [...activity.values()].sort(
        (a, b) =>
            b.itemCount - a.itemCount ||
            (b.latestPublishedAt ?? 0) - (a.latestPublishedAt ?? 0) ||
            a.sourceId.localeCompare(b.sourceId)
    );
}

export function createCategoryShares(items: InsightSourceItem[]): CategoryShare[] {
    const total = items.length;
    const categories = new Map<string, { itemCount: number; latestPublishedAt?: number; sources: Set<SourceID> }>();

    for (const item of items) {
        const categoryId = getSourceCategoryId(item.sourceId);
        const current = categories.get(categoryId) ?? {
            itemCount: 0,
            latestPublishedAt: undefined,
            sources: new Set<SourceID>(),
        };

        current.itemCount += 1;
        current.latestPublishedAt = maxOptional(current.latestPublishedAt, item.publishedAt);
        current.sources.add(item.sourceId);
        categories.set(categoryId, current);
    }

    return [...categories.entries()]
        .map(([categoryId, category]) => ({
            categoryId: categoryId as CategoryShare["categoryId"],
            categoryName: getCategoryName(categoryId),
            itemCount: category.itemCount,
            sourceCount: category.sources.size,
            ratio: total ? roundScore(category.itemCount / total) : 0,
            latestPublishedAt: category.latestPublishedAt,
        }))
        .sort(
            (a, b) =>
                b.itemCount - a.itemCount ||
                (b.latestPublishedAt ?? 0) - (a.latestPublishedAt ?? 0) ||
                a.categoryName.localeCompare(b.categoryName)
        );
}

/** Builds deterministic time buckets for items with a valid publication timestamp. */
export function createUpdateFrequency(
    items: InsightSourceItem[],
    options: Pick<NewsInsightOptions, "generatedAt" | "trendWindow"> = {}
): InsightTimeBucket[] {
    const generatedAt = options.generatedAt ?? Date.now();
    const config = TREND_WINDOW_CONFIG[options.trendWindow ?? "24h"];
    const firstBucketStart = Math.floor((generatedAt - config.durationMs) / config.bucketMs) * config.bucketMs;
    const lastBucketStart = Math.floor(generatedAt / config.bucketMs) * config.bucketMs;
    const buckets = createEmptyBuckets(firstBucketStart, lastBucketStart, config.bucketMs);

    for (const item of items) {
        const publishedAt = item.publishedAt;
        if (publishedAt === undefined || publishedAt < generatedAt - config.durationMs || publishedAt > generatedAt) {
            continue;
        }

        const bucketIndex = getBucketIndex(buckets, publishedAt);
        if (bucketIndex === -1) continue;

        const bucket = buckets[bucketIndex];
        bucket.itemCount += 1;
        bucket.sourceIds.add(item.sourceId);
    }

    return buckets.map(toInsightTimeBucket);
}

/** Aggregates top keywords into the same deterministic buckets used by update frequency. */
export function createKeywordTrends(
    items: InsightSourceItem[],
    options: Pick<NewsInsightOptions, "generatedAt" | "trendLimit" | "trendWindow"> = {}
): KeywordTrend[] {
    const generatedAt = options.generatedAt ?? Date.now();
    const config = TREND_WINDOW_CONFIG[options.trendWindow ?? "24h"];
    const firstBucketStart = Math.floor((generatedAt - config.durationMs) / config.bucketMs) * config.bucketMs;
    const lastBucketStart = Math.floor(generatedAt / config.bucketMs) * config.bucketMs;
    const buckets = createEmptyBuckets(firstBucketStart, lastBucketStart, config.bucketMs);
    const trends = new Map<string, MutableKeywordTrend>();

    for (const item of items) {
        const publishedAt = item.publishedAt;
        if (publishedAt === undefined || publishedAt < generatedAt - config.durationMs || publishedAt > generatedAt) {
            continue;
        }

        const bucketIndex = getBucketIndex(buckets, publishedAt);
        if (bucketIndex === -1) continue;

        for (const term of new Set(item.terms)) {
            const current = trends.get(term) ?? {
                term,
                totalCount: 0,
                latestPublishedAt: undefined,
                sourceIds: new Set<SourceID>(),
                buckets: new Map(),
            };
            const bucket = current.buckets.get(bucketIndex) ?? {
                itemCount: 0,
                sourceIds: new Set<SourceID>(),
            };

            current.totalCount += 1;
            current.sourceIds.add(item.sourceId);
            current.latestPublishedAt = maxOptional(current.latestPublishedAt, publishedAt);
            bucket.itemCount += 1;
            bucket.sourceIds.add(item.sourceId);
            current.buckets.set(bucketIndex, bucket);
            trends.set(term, current);
        }
    }

    return [...trends.values()]
        .sort(
            (a, b) =>
                b.totalCount - a.totalCount ||
                b.sourceIds.size - a.sourceIds.size ||
                (b.latestPublishedAt ?? 0) - (a.latestPublishedAt ?? 0) ||
                a.term.localeCompare(b.term)
        )
        .slice(0, options.trendLimit ?? DEFAULT_TREND_LIMIT)
        .map(({ sourceIds, buckets: trendBuckets, ...trend }) => ({
            ...trend,
            sourceCount: sourceIds.size,
            buckets: buckets.map((bucket, index) => {
                const trendBucket = trendBuckets.get(index);
                return {
                    ...toInsightTimeBucket(bucket),
                    itemCount: trendBucket?.itemCount ?? 0,
                    sourceCount: trendBucket?.sourceIds.size ?? 0,
                };
            }),
        }));
}

export function extractInsightTerms(title: string, options: Pick<NewsInsightOptions, "stopWords"> = {}): string[] {
    const stopWords = new Set([
        ...DEFAULT_STOP_WORDS,
        ...Array.from(options.stopWords ?? [], (word) => word.toLowerCase()),
    ]);
    const terms = new Set<string>();
    const normalized = title.toLowerCase();

    for (const match of normalized.matchAll(/[a-z0-9][a-z0-9+#.-]{1,}/g)) {
        addTerm(terms, match[0], stopWords);
    }

    for (const match of title.matchAll(/[\p{Script=Han}]{2,}/gu)) {
        for (const term of splitCjkTerm(match[0])) {
            addTerm(terms, term, stopWords);
        }
    }

    return [...terms];
}

export function normalizeNewsUrl(url: string): string {
    const trimmed = url.trim();
    if (!trimmed) return "";

    try {
        const parsed = new URL(trimmed);
        parsed.hash = "";
        parsed.hostname = parsed.hostname
            .toLowerCase()
            .replace(/^m\./, "")
            .replace(/^www\./, "");

        for (const key of [...parsed.searchParams.keys()]) {
            if (TRACKING_QUERY_PATTERN.test(key)) parsed.searchParams.delete(key);
        }

        const normalized = parsed.toString();
        return normalized.endsWith("/") && parsed.pathname !== "/" ? normalized.slice(0, -1) : normalized;
    } catch {
        return trimmed.replace(/[?#].*$/, "").replace(/\/$/, "");
    }
}

function createTopicGroups(items: InsightSourceItem[]): TopicGroup[] {
    if (!items.length) return [];

    const parents = items.map((_, index) => index);
    const keyIndex = new Map<string, number>();

    items.forEach((item, index) => {
        for (const key of createTopicKeys(item)) {
            const existing = keyIndex.get(key);
            if (existing === undefined) keyIndex.set(key, index);
            else union(parents, existing, index);
        }
    });

    const groups = new Map<number, InsightSourceItem[]>();
    items.forEach((item, index) => {
        const root = find(parents, index);
        groups.set(root, [...(groups.get(root) ?? []), item]);
    });

    return [...groups.values()].map((groupItems) => ({
        id: `topic-${hashString(
            groupItems
                .map((item) => item.canonicalUrl || item.title)
                .sort()
                .join("|")
        )}`,
        items: groupItems.sort(
            (a, b) =>
                (b.publishedAt ?? b.responseUpdatedTime ?? 0) - (a.publishedAt ?? a.responseUpdatedTime ?? 0) ||
                a.title.localeCompare(b.title)
        ),
    }));
}

function createTopicKeys(item: InsightSourceItem) {
    const keys = new Set<string>();
    if (item.canonicalUrl) keys.add(`url:${item.canonicalUrl}`);

    const importantTerms = item.terms
        .filter((term) => term.length > 1)
        .sort((a, b) => b.length - a.length || a.localeCompare(b))
        .slice(0, 6);

    if (importantTerms.length === 1) keys.add(`term:${importantTerms[0]}`);
    for (let i = 0; i < importantTerms.length; i += 1) {
        for (let j = i + 1; j < importantTerms.length; j += 1) {
            keys.add(`terms:${[importantTerms[i], importantTerms[j]].sort().join("|")}`);
        }
    }

    return keys;
}

function createHotNewsItem(group: TopicGroup, generatedAt: number): HotNewsItem {
    const representative = group.items[0];
    const sources = uniqueSourceIds(group.items);
    const sourceNames = uniqueSourceNames(group.items);
    const latestPublishedAt = maxDefined(group.items.map((item) => item.publishedAt ?? item.responseUpdatedTime));
    const recencyScore = getRecencyScore(latestPublishedAt, generatedAt);
    const sourceWeight = average(group.items.map((item) => item.sourceWeight));
    const categoryDistribution = createHotNewsCategoryDistribution(group.items);
    const categoryWeight = average(group.items.map((item) => item.categoryWeight));
    const readPenalty = group.items.every((item) => item.isRead) ? 20 : 0;
    const signals: HotNewsSignals = {
        sourceCoverage: sources.length,
        duplicateCount: group.items.length,
        recencyScore,
        sourceWeight: roundScore(sourceWeight),
        categoryWeight: roundScore(categoryWeight),
        readPenalty,
        categoryDistribution,
        rankingReason: formatInsightRankingReason({
            sourceCoverage: sources.length,
            recencyScore,
            sourceWeight: roundScore(sourceWeight),
            categoryWeight: roundScore(categoryWeight),
            readPenalty,
        }),
    };
    const score = roundScore(
        signals.sourceCoverage * 40 +
            Math.log1p(signals.duplicateCount) * 20 +
            recencyScore * 30 +
            sourceWeight * 10 +
            categoryWeight * 10 -
            readPenalty
    );

    return {
        rank: 0,
        id: group.id,
        title: representative.title,
        url: representative.url,
        mobileUrl: representative.mobileUrl,
        sourceId: representative.sourceId,
        sourceName: representative.sourceName,
        publishedAt: representative.publishedAt,
        score,
        sources,
        sourceNames,
        itemCount: group.items.length,
        keywords: topTerms(group.items, 4),
        signals,
    };
}

/** Summarizes the category mix behind one grouped hot item for ranking explanations. */
function createHotNewsCategoryDistribution(items: InsightSourceItem[]): HotNewsCategorySignal[] {
    const categories = new Map<
        InsightCategoryID,
        { categoryName: string; itemCount: number; sources: Set<SourceID> }
    >();

    for (const item of items) {
        const current = categories.get(item.categoryId) ?? {
            categoryName: item.categoryName,
            itemCount: 0,
            sources: new Set<SourceID>(),
        };
        current.itemCount += 1;
        current.sources.add(item.sourceId);
        categories.set(item.categoryId, current);
    }

    return [...categories.entries()]
        .map(([categoryId, category]) => ({
            categoryId,
            categoryName: category.categoryName,
            itemCount: category.itemCount,
            sourceCount: category.sources.size,
        }))
        .sort(
            (left, right) =>
                right.itemCount - left.itemCount ||
                right.sourceCount - left.sourceCount ||
                left.categoryName.localeCompare(right.categoryName)
        );
}

function createTopicEvent(group: TopicGroup): TopicEvent {
    const representative = group.items[0];
    const publishedTimes = group.items
        .map((item) => item.publishedAt ?? item.responseUpdatedTime)
        .filter((time): time is number => typeof time === "number");

    return {
        id: group.id,
        title: representative.title,
        canonicalUrl: representative.canonicalUrl || undefined,
        sources: uniqueSourceIds(group.items),
        sourceNames: uniqueSourceNames(group.items),
        itemCount: group.items.length,
        firstPublishedAt: publishedTimes.length ? Math.min(...publishedTimes) : undefined,
        latestPublishedAt: publishedTimes.length ? Math.max(...publishedTimes) : undefined,
        keywords: topTerms(group.items, 6),
        items: group.items.map((item) => ({
            id: item.id,
            sourceId: item.sourceId,
            sourceName: item.sourceName,
            title: item.title,
            url: item.url,
            publishedAt: item.publishedAt,
        })),
    };
}

function topTerms(items: InsightSourceItem[], limit: number) {
    const counts = new Map<string, number>();

    for (const item of items) {
        for (const term of new Set(item.terms)) {
            counts.set(term, (counts.get(term) ?? 0) + 1);
        }
    }

    return [...counts]
        .sort(
            ([aTerm, aCount], [bTerm, bCount]) =>
                bCount - aCount || bTerm.length - aTerm.length || aTerm.localeCompare(bTerm)
        )
        .slice(0, limit)
        .map(([term]) => term);
}

function splitCjkTerm(term: string) {
    if (term.length <= 3) return [term];

    const terms = [term];
    for (let index = 0; index + 1 < term.length; index += 2) {
        terms.push(term.slice(index, index + 2));
    }

    return terms;
}

function addTerm(terms: Set<string>, term: string, stopWords: Set<string>) {
    const normalized = term.toLowerCase().trim();
    if (normalized.length < 2 || stopWords.has(normalized)) return;
    terms.add(normalized);
}

function parseNewsTime(value: number | string | undefined): number | undefined {
    if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : undefined;
    if (!value) return undefined;

    const numericValue = Number(value);
    if (Number.isFinite(numericValue) && numericValue > 0) return numericValue;

    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function getRecencyScore(time: number | undefined, generatedAt: number) {
    if (!time) return 0;

    const age = Math.max(0, generatedAt - time);
    return roundScore(Math.max(0, 1 - age / DAY_MS));
}

function uniqueSourceIds(items: InsightSourceItem[]) {
    return [...new Set(items.map((item) => item.sourceId))];
}

function uniqueSourceNames(items: InsightSourceItem[]) {
    return [...new Set(items.map((item) => item.sourceName).filter((name): name is string => Boolean(name)))];
}

function addUniqueSource(sources: SourceID[], sourceId: SourceID) {
    return sources.includes(sourceId) ? sources : [...sources, sourceId];
}

function getSourceCategoryId(sourceId: SourceID): CategoryShare["categoryId"] {
    return dataSources[sourceId]?.column ?? "uncategorized";
}

function getCategoryName(categoryId: string) {
    if (categoryId === "uncategorized") return "未分类";
    return metadata[categoryId as ColumnID]?.name ?? categoryId;
}

function maxOptional(current: number | undefined, next: number | undefined) {
    if (current === undefined) return next;
    if (next === undefined) return current;
    return Math.max(current, next);
}

function maxDefined(values: Array<number | undefined>) {
    const definedValues = values.filter((value): value is number => typeof value === "number");
    return definedValues.length ? Math.max(...definedValues) : undefined;
}

function createEmptyBuckets(firstBucketStart: number, lastBucketStart: number, bucketMs: number) {
    const buckets: MutableInsightTimeBucket[] = [];
    for (let startAt = firstBucketStart; startAt <= lastBucketStart; startAt += bucketMs) {
        buckets.push({
            startAt,
            endAt: startAt + bucketMs,
            itemCount: 0,
            sourceIds: new Set<SourceID>(),
        });
    }
    return buckets;
}

function getBucketIndex(buckets: MutableInsightTimeBucket[], publishedAt: number) {
    const index = buckets.findIndex((bucket) => publishedAt >= bucket.startAt && publishedAt < bucket.endAt);
    return index;
}

function toInsightTimeBucket({ sourceIds, ...bucket }: MutableInsightTimeBucket): InsightTimeBucket {
    return {
        ...bucket,
        sourceCount: sourceIds.size,
    };
}

function average(values: number[]) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundScore(value: number) {
    return Math.round(value * 100) / 100;
}

function find(parents: number[], index: number): number {
    if (parents[index] !== index) parents[index] = find(parents, parents[index]);
    return parents[index];
}

function union(parents: number[], a: number, b: number) {
    const rootA = find(parents, a);
    const rootB = find(parents, b);
    if (rootA !== rootB) parents[rootB] = rootA;
}

function hashString(value: string) {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
        hash = (hash * 31 + value.charCodeAt(index)) % 4294967296;
    }
    return hash.toString(36);
}
