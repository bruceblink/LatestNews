import { dataSources } from "./data-sources.ts";
import { typeSafeObjectKeys, typeSafeObjectEntries, typeSafeObjectFromEntries } from "./type.util";

import type { SourceID, Metadata } from "./types";

// ---------------------------
// 核心列配置
// ---------------------------
export interface ColumnConfigItem {
    name: string;
    sourceRule?: (id: SourceID, s: (typeof dataSources)[SourceID]) => boolean;
}

export const columnConfig: Record<string, ColumnConfigItem> = {
    china: {
        name: "国内",
        sourceRule: (_, s) => s.column === "china" && !s.redirect,
    },
    world: {
        name: "国际",
        sourceRule: (_, s) => s.column === "world" && !s.redirect,
    },
    tech: {
        name: "科技",
        sourceRule: (_, s) => s.column === "tech" && !s.redirect,
    },
    finance: {
        name: "财经",
        sourceRule: (_, s) => s.column === "finance" && !s.redirect,
    },
    focus: { name: "关注" },
    history: { name: "历史" },
    realtime: {
        name: "实时",
        sourceRule: (_, s) => s.type === "realtime" && !s.redirect,
    },
    hottest: {
        name: "最热",
        sourceRule: (_, s) => s.type === "hottest" && !s.redirect,
    },
};

// ---------------------------
// 类型推导
// ---------------------------
export type ColumnID = keyof typeof columnConfig;

// ---------------------------
// 导航栏 固定列 / 隐藏列的配置
// ---------------------------
export const fixedColumnIds = ["focus", "hottest", "realtime", "history"] as const;
export type FixedColumnId = (typeof fixedColumnIds)[number];

const fixedSet = new Set<FixedColumnId>(fixedColumnIds);

export const hiddenColumns = typeSafeObjectKeys(columnConfig).filter(
    (id): id is Exclude<ColumnID, FixedColumnId> => !fixedSet.has(id as FixedColumnId)
);

// ---------------------------
// 生成 metadata
// ---------------------------
export const metadata: Metadata = typeSafeObjectFromEntries(
    typeSafeObjectEntries(columnConfig).map(([columnId, cfg]) => [
        columnId,
        {
            name: cfg.name,
            sources: cfg.sourceRule
                ? typeSafeObjectEntries(dataSources)
                      .filter(([id, s]) => cfg.sourceRule!(id as SourceID, s))
                      .map(([id]) => id as SourceID)
                : [],
        },
    ])
);

// ---------------------------
// 兼容旧代码 columns.zh
// ---------------------------
export const columns = typeSafeObjectFromEntries(
    typeSafeObjectEntries(columnConfig).map(([id, cfg]) => [id, { zh: cfg.name }])
);
