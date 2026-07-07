import type { SourceID } from "./types";

const MAX_READING_STATE_ITEMS = 300;
const TRACKING_QUERY_PATTERN = /^(utm_|spm$|from$|ref$|source$|share$|fbclid$|gclid$|igshid$|yclid$)/i;

export const readingStateKinds = ["later", "favorite", "hidden"] as const;

export type ReadingStateKind = (typeof readingStateKinds)[number];

export interface ReadingStateItem {
    newsId?: string | number;
    title: string;
    url: string;
    sourceId: SourceID;
    sourceName: string;
    updatedAt: number;
}

export interface ReadingState {
    later: ReadingStateItem[];
    favorites: ReadingStateItem[];
    hidden: ReadingStateItem[];
}

export type ReadingStateItemInput = Omit<ReadingStateItem, "updatedAt"> & {
    updatedAt?: number;
};

export function createDefaultReadingState(): ReadingState {
    return {
        later: [],
        favorites: [],
        hidden: [],
    };
}

export function normalizeReadingState(value: Partial<ReadingState> | undefined): ReadingState {
    return {
        later: normalizeReadingStateItems(value?.later),
        favorites: normalizeReadingStateItems(value?.favorites),
        hidden: normalizeReadingStateItems(value?.hidden),
    };
}

export function createReadingStateItem(input: ReadingStateItemInput, now = Date.now()): ReadingStateItem {
    return {
        newsId: input.newsId,
        title: input.title.trim(),
        url: input.url.trim(),
        sourceId: input.sourceId,
        sourceName: input.sourceName.trim() || input.sourceId,
        updatedAt: input.updatedAt ?? now,
    };
}

export function toggleReadingStateItem(
    state: Partial<ReadingState> | undefined,
    kind: ReadingStateKind,
    input: ReadingStateItemInput,
    now = Date.now()
): ReadingState {
    const normalizedState = normalizeReadingState(state);
    const item = createReadingStateItem(input, now);
    const targetKey = getReadingStateListKey(kind);
    const currentList = normalizedState[targetKey];
    const normalizedUrl = normalizeReadingStateUrl(item.url);
    const exists = currentList.some((entry) => normalizeReadingStateUrl(entry.url) === normalizedUrl);
    const nextList = exists
        ? currentList.filter((entry) => normalizeReadingStateUrl(entry.url) !== normalizedUrl)
        : [item, ...currentList.filter((entry) => normalizeReadingStateUrl(entry.url) !== normalizedUrl)].slice(
              0,
              MAX_READING_STATE_ITEMS
          );

    const nextState = {
        ...normalizedState,
        [targetKey]: nextList,
    };

    if (!exists && kind === "hidden") {
        return {
            ...nextState,
            later: removeItemByUrl(nextState.later, normalizedUrl),
            favorites: removeItemByUrl(nextState.favorites, normalizedUrl),
        };
    }

    if (!exists && kind !== "hidden") {
        return {
            ...nextState,
            hidden: removeItemByUrl(nextState.hidden, normalizedUrl),
        };
    }

    return nextState;
}

export function removeReadingStateItem(
    state: Partial<ReadingState> | undefined,
    kind: ReadingStateKind,
    url: string
): ReadingState {
    const normalizedState = normalizeReadingState(state);
    const key = getReadingStateListKey(kind);
    return {
        ...normalizedState,
        [key]: removeItemByUrl(normalizedState[key], normalizeReadingStateUrl(url)),
    };
}

export function hasReadingStateItem(
    state: Partial<ReadingState> | undefined,
    kind: ReadingStateKind,
    url: string
): boolean {
    const key = getReadingStateListKey(kind);
    const normalizedUrl = normalizeReadingStateUrl(url);
    return normalizeReadingState(state)[key].some((item) => normalizeReadingStateUrl(item.url) === normalizedUrl);
}

export function isHiddenReadingUrl(state: Partial<ReadingState> | undefined, url: string): boolean {
    return hasReadingStateItem(state, "hidden", url);
}

export function normalizeReadingStateUrl(url: string): string {
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

export function getReadingStateList(state: Partial<ReadingState> | undefined, kind: ReadingStateKind) {
    return normalizeReadingState(state)[getReadingStateListKey(kind)];
}

function normalizeReadingStateItems(items: ReadingStateItem[] | undefined): ReadingStateItem[] {
    if (!Array.isArray(items)) return [];

    const seen = new Set<string>();
    return items
        .map((item) => {
            if (!item?.title || !item.url || !item.sourceId) return undefined;
            return createReadingStateItem(item, Number.isFinite(item.updatedAt) ? item.updatedAt : 0);
        })
        .filter((item): item is ReadingStateItem => Boolean(item))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .filter((item) => {
            const normalizedUrl = normalizeReadingStateUrl(item.url);
            if (!normalizedUrl || seen.has(normalizedUrl)) return false;
            seen.add(normalizedUrl);
            return true;
        })
        .slice(0, MAX_READING_STATE_ITEMS);
}

function getReadingStateListKey(kind: ReadingStateKind): keyof ReadingState {
    return kind === "favorite" ? "favorites" : kind;
}

function removeItemByUrl(items: ReadingStateItem[], normalizedUrl: string): ReadingStateItem[] {
    return items.filter((item) => normalizeReadingStateUrl(item.url) !== normalizedUrl);
}
