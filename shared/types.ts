import type { colors } from "unocss/preset-mini";

import type sources from "./sources.json";
import type { originSources } from "./pre-sources";

// ---------------------------
// 基础类型
// ---------------------------
export type Color = "primary" | Exclude<keyof typeof colors, "current" | "inherit" | "transparent" | "black" | "white">;

export const columnIds = ["china", "world", "tech", "finance", "focus", "realtime", "hottest"] as const;
export const fixedColumnIds = ["focus", "hottest", "realtime"] as const;

export type ColumnID = (typeof columnIds)[number];
export type FixedColumnID = (typeof fixedColumnIds)[number];

// ---------------------------
// 数据源 ID
// ---------------------------
export type SourceID = keyof typeof sources & string;

type OriginSources = typeof originSources;
type OriginMainSourceID = keyof OriginSources & string;
type OriginSubSourceID<ID extends OriginMainSourceID> = OriginSources[ID] extends { sub: infer SubSources }
    ? `${ID}-${keyof SubSources & string}`
    : never;

export type OriginSourceID = {
    [ID in OriginMainSourceID]: ID | OriginSubSourceID<ID>;
}[OriginMainSourceID];

export interface OriginSource extends Partial<Source> {
    sub?: Record<string, Partial<Source>>;
}

export interface PrimitiveMetadata {
    updatedTime: number;
    data: Record<FixedColumnID, SourceID[]>;
    action: "init" | "manual" | "sync";
}

// ---------------------------
// Source 接口
// ---------------------------
export interface Source {
    name: string;
    interval: number;
    color: Color;

    /**
     * Subtitle 小标题
     */
    title?: string;
    desc?: string;
    /**
     * Default normal timeline
     */
    type?: "hottest" | "realtime";
    column?: ColumnID;
    home?: string;
    /**
     * @default false
     */
    disable?: boolean | "cf";
    redirect?: SourceID;
}

// ---------------------------
// Column / Metadata
// ---------------------------
export interface Column {
    name: string;
    sources: SourceID[];
}

export interface NewsItem {
    id: string | number; // unique
    title: string;
    url: string;
    mobileUrl?: string;
    pubDate?: number | string;
    extra?: {
        hover?: string;
        date?: number | string;
        info?: false | string;
        diff?: number;
        icon?:
            | false
            | string
            | {
                  url: string;
                  scale: number;
              };
    };
}

export interface SourceResponse {
    status: "success" | "cache";
    id: SourceID;
    name?: string;
    updatedTime: number | string;
    items: NewsItem[];
}

export type Metadata = Record<ColumnID, Column>;
