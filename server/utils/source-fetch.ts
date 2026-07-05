import type { NewsItem, SourceID } from "@shared/types";

import { getters } from "#/getters";
import { normalizeNewsItems } from "@shared/news-item-schema";

import { recordSourceFailure, recordSourceSuccess } from "./source-health";

interface CreateSourceFetcherOptions {
    getItems: (id: SourceID) => Promise<NewsItem[]>;
    onSuccess: (id: SourceID, durationMs: number, itemCount: number) => void;
    onFailure: (id: SourceID, durationMs: number, error: unknown) => void;
    now?: () => number;
}

export function hasSourceGetter(id: SourceID) {
    return typeof getters[id] === "function";
}

export function createSourceFetcher({ getItems, onSuccess, onFailure, now = Date.now }: CreateSourceFetcherOptions) {
    const inflightRequests = new Map<SourceID, Promise<NewsItem[]>>();

    return function fetchSourceItems(id: SourceID) {
        const pending = inflightRequests.get(id);
        if (pending) return pending;

        const startTime = now();
        const request = getItems(id)
            .then((items) => {
                const normalizedItems = normalizeNewsItems(items, { sourceId: id });
                onSuccess(id, now() - startTime, normalizedItems.length);
                return normalizedItems;
            })
            .catch((error) => {
                onFailure(id, now() - startTime, error);
                throw error;
            })
            .finally(() => {
                inflightRequests.delete(id);
            });

        inflightRequests.set(id, request);
        return request;
    };
}

export const fetchSourceItems = createSourceFetcher({
    getItems: (id) => getters[id](),
    onSuccess: recordSourceSuccess,
    onFailure: recordSourceFailure,
});
