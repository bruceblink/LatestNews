import type { SourceID, SourceResponse } from "@shared/types";
import type { SourceMetadataResponse } from "@shared/source-metadata";
import type { SourceHealthSummary } from "@shared/source-health-types";
import type {
    SourceQuery,
    SourceItemsQuery,
    NewsInsightsPayload,
    SourceItemsResponse,
    EntireSourcesPayload,
    NewsInsightsResponse,
    EntireSourcesResponse,
} from "@shared/source-api";

import { myFetch } from "~/utils";
import { getOrCreateInFlightRequest } from "@shared/in-flight-request";
import {
    sourceApi,
    getSourceItemsPath,
    getNewsInsightsRequestKey,
    normalizeEntireSourcesResponse,
} from "@shared/source-api";

const inFlightNewsInsights = new Map<string, Promise<NewsInsightsResponse>>();

export function fetchSource(query: SourceQuery, headers?: Record<string, string>): Promise<SourceResponse> {
    return myFetch(sourceApi.single, {
        query,
        headers,
    });
}

export function fetchEntireSources(sources: SourceID[]): Promise<SourceResponse[] | undefined> {
    return fetchEntireSourcesEnvelope(sources).then(normalizeEntireSourcesResponse);
}

export function fetchSourceItemsV1(id: SourceID, query?: SourceItemsQuery): Promise<SourceItemsResponse> {
    return myFetch(getSourceItemsPath(id), {
        query,
    });
}

export function fetchEntireSourcesEnvelope(sources: SourceID[]): Promise<EntireSourcesResponse | SourceResponse[]> {
    const body: EntireSourcesPayload = { sources };

    return myFetch(sourceApi.entire, {
        method: "POST",
        body,
    });
}

export function fetchNewsInsights(payload: NewsInsightsPayload): Promise<NewsInsightsResponse> {
    const requestKey = getNewsInsightsRequestKey(payload);
    return getOrCreateInFlightRequest(inFlightNewsInsights, requestKey, () =>
        myFetch(sourceApi.insights, {
            method: "POST",
            body: payload,
        })
    );
}

export function fetchSourceHealthSummary(): Promise<SourceHealthSummary> {
    return myFetch(sourceApi.health);
}

export function fetchSourceMetadata(): Promise<SourceMetadataResponse> {
    return myFetch(sourceApi.sourcesV1);
}
