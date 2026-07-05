import type { SourceID, SourceResponse } from "@shared/types";
import type { SourceHealthSummary } from "@shared/source-health-types";
import type {
    SourceQuery,
    NewsInsightsPayload,
    EntireSourcesPayload,
    NewsInsightsResponse,
    EntireSourcesResponse,
} from "@shared/source-api";

import { myFetch } from "~/utils";
import { sourceApi, normalizeEntireSourcesResponse } from "@shared/source-api";

export function fetchSource(query: SourceQuery, headers?: Record<string, string>): Promise<SourceResponse> {
    return myFetch(sourceApi.single, {
        query,
        headers,
    });
}

export function fetchEntireSources(sources: SourceID[]): Promise<SourceResponse[] | undefined> {
    return fetchEntireSourcesEnvelope(sources).then(normalizeEntireSourcesResponse);
}

export function fetchEntireSourcesEnvelope(sources: SourceID[]): Promise<EntireSourcesResponse | SourceResponse[]> {
    const body: EntireSourcesPayload = { sources };

    return myFetch(sourceApi.entire, {
        method: "POST",
        body,
    });
}

export function fetchNewsInsights(payload: NewsInsightsPayload): Promise<NewsInsightsResponse> {
    return myFetch(sourceApi.insights, {
        method: "POST",
        body: payload,
    });
}

export function fetchSourceHealthSummary(): Promise<SourceHealthSummary> {
    return myFetch(sourceApi.health);
}
