import { dataSources } from "./data-sources.ts";
import { typeSafeObjectEntries, typeSafeObjectFromEntries } from "./type.util";

import type { ColumnID, Metadata, SourceID, HiddenColumnID } from "./types";

export const columns = {
    china: { zh: "国内" },
    world: { zh: "国际" },
    tech: { zh: "科技" },
    finance: { zh: "财经" },
    focus: { zh: "关注" },
    realtime: { zh: "实时" },
    hottest: { zh: "最热" },
} as const;

export const fixedColumnIds = ["focus", "hottest", "realtime"] as const satisfies Partial<ColumnID>[];
export const hiddenColumns = Object.keys(columns).filter(
    (id) => !fixedColumnIds.includes(id as any)
) as HiddenColumnID[];

export const metadata: Metadata = typeSafeObjectFromEntries(
    typeSafeObjectEntries(columns).map(([columnId, columnInfo]) => {
        switch (columnId) {
            case "focus":
                return [
                    columnId,
                    {
                        name: columnInfo.zh,
                        sources: [] as SourceID[],
                    },
                ];

            case "hottest":
                return [
                    columnId,
                    {
                        name: columnInfo.zh,
                        sources: typeSafeObjectEntries(dataSources)
                            .filter(([, source]) => source.type === "hottest" && !source.redirect)
                            .map(([sourceId]) => sourceId),
                    },
                ];

            case "realtime":
                return [
                    columnId,
                    {
                        name: columnInfo.zh,
                        sources: typeSafeObjectEntries(dataSources)
                            .filter(([, source]) => source.type === "realtime" && !source.redirect)
                            .map(([sourceId]) => sourceId),
                    },
                ];

            default:
                return [
                    columnId,
                    {
                        name: columnInfo.zh,
                        sources: typeSafeObjectEntries(dataSources)
                            .filter(([, source]) => source.column === columnId && !source.redirect)
                            .map(([sourceId]) => sourceId),
                    },
                ];
        }
    })
);
