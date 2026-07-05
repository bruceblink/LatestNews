import type { SourceID, SourceResponse } from "@shared/types";
import type { SourceHealthSummary } from "@shared/source-health-types";
import type { SourceQuery, EntireSourcesPayload } from "@shared/source-api";

import { myFetch } from "~/utils";
import { sourceApi } from "@shared/source-api";

export function fetchSource(query: SourceQuery, headers?: Record<string, string>): Promise<SourceResponse> {
    return myFetch(sourceApi.single, {
        query,
        headers,
    });
}

export function fetchEntireSources(sources: SourceID[]): Promise<SourceResponse[] | undefined> {
    const body: EntireSourcesPayload = { sources };

    return myFetch(sourceApi.entire, {
        method: "POST",
        body,
    });
}

export function fetchSourceHealthSummary(): Promise<SourceHealthSummary> {
    return myFetch(sourceApi.health);
}
