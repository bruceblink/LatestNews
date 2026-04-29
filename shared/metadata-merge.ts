import type { SourceID, PrimitiveMetadata } from "@shared/types";

import { fixedColumnIds } from "./metadata";

function mergeColumnSources(remoteSources: SourceID[] = [], localSources: SourceID[] = []) {
    const merged: SourceID[] = [];
    const seen = new Set<SourceID>();

    for (const source of [...remoteSources, ...localSources]) {
        if (seen.has(source)) continue;
        seen.add(source);
        merged.push(source);
    }

    return merged;
}

export function mergePrimitiveMetadata(local: PrimitiveMetadata, remote: PrimitiveMetadata): PrimitiveMetadata {
    const merged: PrimitiveMetadata = {
        updatedTime: Math.max(local.updatedTime, remote.updatedTime),
        data: {
            focus: [],
            hottest: [],
            realtime: [],
        },
        action: "sync",
    };

    for (const key of fixedColumnIds) {
        merged.data[key] = mergeColumnSources(remote.data[key], local.data[key]);
    }

    return merged;
}
