import type { SourceID } from "@shared/types";

import dataSources from "./data-sources";

export interface SourceQuerySchedule {
    staleTime: number;
    refetchInterval: number;
}

export function getSourceQuerySchedule(id: SourceID, failing: boolean): SourceQuerySchedule {
    const sourceType = dataSources[id].type;

    if (failing) {
        return {
            staleTime: 1000 * 60 * 5,
            refetchInterval: 1000 * 60 * 8,
        };
    }

    if (sourceType === "realtime") {
        return {
            staleTime: 1000 * 60,
            refetchInterval: 1000 * 60 * 2,
        };
    }

    if (sourceType === "hottest") {
        return {
            staleTime: 1000 * 60 * 2,
            refetchInterval: 1000 * 60 * 4,
        };
    }

    return {
        staleTime: 1000 * 60 * 4,
        refetchInterval: 1000 * 60 * 6,
    };
}
