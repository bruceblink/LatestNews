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
    status: string;
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
    title?: string;
    desc?: string;
    type?: "hottest" | "realtime";
    column?: ColumnID; // 改为 ColumnID，不直接用 HiddenColumnID，打破循环
    home?: string;
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

export type Metadata = Record<ColumnID, Column>;
