import type { colors } from "unocss/preset-mini";

import type { originSources } from "./pre-sources";
import type { ColumnID, fixedColumnIds } from "./metadata";

// ---------------------------
// 基础类型
// ---------------------------
export type Color = "primary" | Exclude<keyof typeof colors, "current" | "inherit" | "transparent" | "black" | "white">;

export type FixedColumnID = (typeof fixedColumnIds)[number];
export type HiddenColumnID = Exclude<ColumnID, FixedColumnID>;

// ---------------------------
// SourceID 类型
// ---------------------------
type ConstSources = typeof originSources;
type MainSourceID = keyof ConstSources;

export type SourceID = {
    [Key in MainSourceID]: ConstSources[Key] extends { disable?: true }
        ? never
        : ConstSources[Key] extends { sub?: infer SubSource }
          ?
                | {
                      [SubKey in keyof SubSource & string]: SubSource[SubKey] extends { disable?: true }
                          ? never
                          : `${Key}-${SubKey}`;
                  }[keyof SubSource & string]
                | Key
          : Key;
}[MainSourceID];

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
    column?: ColumnID; // 改为 ColumnID，不直接用 HiddenColumnID，打破循环
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
    updatedTime: number | string;
    items: NewsItem[];
}

export type Metadata = Record<ColumnID, Column>;
