import { dataSources } from "./data-sources.ts";
import { objectEntries, objectFromEntries } from "./type.util";

import type { Source, SourceID, Metadata, ColumnID } from "./types";

type ColumnConfigItem = {
    name: string;
    sourceRule?: (id: SourceID, source: Source) => boolean;
};

const columnConfig: Record<ColumnID, ColumnConfigItem> = {
    china: {
        name: "国内",
        sourceRule: (_, source) => source.column === "china" && !source.redirect,
    },
    world: {
        name: "国际",
        sourceRule: (_, source) => source.column === "world" && !source.redirect,
    },
    tech: {
        name: "科技",
        sourceRule: (_, source) => source.column === "tech" && !source.redirect,
    },
    finance: {
        name: "财经",
        sourceRule: (_, source) => source.column === "finance" && !source.redirect,
    },
    focus: { name: "关注" },
    realtime: {
        name: "实时",
        sourceRule: (_, source) => source.type === "realtime" && !source.redirect,
    },
    hottest: {
        name: "热门",
        sourceRule: (_, source) => source.type === "hottest" && !source.redirect,
    },
};

export const metadata: Metadata = objectFromEntries(
    objectEntries(columnConfig).map(([columnId, cfg]) => [
        columnId,
        {
            name: cfg.name,
            sources: cfg.sourceRule
                ? objectEntries(dataSources)
                      .filter(([id, s]) => cfg.sourceRule!(id as SourceID, s))
                      .map(([id]) => id as SourceID)
                : [],
        },
    ])
);
