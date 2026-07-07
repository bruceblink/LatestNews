import { metadata } from "./metadata";
import dataSources from "./data-sources";

import type { NewsItem, SourceID, ColumnID, SourceResponse } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_HOT_LIMIT = 20;
const DEFAULT_TOPIC_LIMIT = 20;
const DEFAULT_WORD_LIMIT = 40;
const DEFAULT_MIN_TOPIC_ITEMS = 2;
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
    minTopicItems?: number;
    sourceWeights?: Partial<Record<SourceID, number>>;
    readUrls?: Iterable<string>;
    hiddenUrls?: Iterable<string>;
    stopWords?: Iterable<string>;
}

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
    isRead: boolean;
    item: NewsItem;
}

export interface HotNewsSignals {
    sourceCoverage: number;
    duplicateCount: number;
    recencyScore: number;
    sourceWeight: number;
    readPenalty: number;
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

export interface NewsInsights {
    generatedAt: number;
    sourceCount: number;
    itemCount: number;
    hotRankings: HotNewsItem[];
    topicEvents: TopicEvent[];
    wordCloud: WordCloudTerm[];
    sourceActivity: SourceActivity[];
    categoryShares: CategoryShare[];
}

interface TopicGroup {
    id: string;
    items: InsightSourceItem[];
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
        const sourceWeight = Math.max(0, sourceWeights[response.id] ?? 1);

        for (const item of response.items) {
            const title = item.title?.trim();
            const url = item.url?.trim();
            if (!title || !url) continue;

            const canonicalUrl = normalizeNewsUrl(url);
            if (hiddenUrls.has(canonicalUrl)) continue;

            const publishedAt = parseNewsTime(item.pubDate ?? item.extra?.date ?? responseUpdatedTime);
            const terms = extractInsightTerms(title, options);
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
    const readPenalty = group.items.every((item) => item.isRead) ? 20 : 0;
    const signals: HotNewsSignals = {
        sourceCoverage: sources.length,
        duplicateCount: group.items.length,
        recencyScore,
        sourceWeight: roundScore(sourceWeight),
        readPenalty,
    };
    const score = roundScore(
        signals.sourceCoverage * 40 +
            Math.log1p(signals.duplicateCount) * 20 +
            recencyScore * 30 +
            sourceWeight * 10 -
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
        signals,
    };
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
