import type { SourceID } from "./types";

export type SourceAdapterKind = "legacy" | "plugin" | "configured";

export const sourceAdapterKindLabels: Record<SourceAdapterKind, string> = {
    legacy: "内置来源",
    plugin: "插件来源",
    configured: "配置来源",
};

export function getSourceAdapterKindLabel(kind: SourceAdapterKind | undefined) {
    return kind ? sourceAdapterKindLabels[kind] : "待识别";
}

export interface SourceDescriptor {
    id: SourceID;
    kind: SourceAdapterKind;
}
