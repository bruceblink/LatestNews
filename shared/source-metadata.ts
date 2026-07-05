import { metadata } from "./metadata";
import dataSources from "./data-sources";
import { objectEntries } from "./type.util";

import type { Source, SourceID, ColumnID } from "./types";

export type SourceMetadataType = NonNullable<Source["type"]> | "normal";
export type SourceDisableReason = "manual" | "cloudflare";

export interface SourceMetadataItem {
    id: SourceID;
    name: string;
    interval: number;
    color: Source["color"];
    type: SourceMetadataType;
    disabled: boolean;
    column?: ColumnID;
    columnName?: string;
    title?: string;
    description?: string;
    home?: string;
    redirectTo?: SourceID;
    disableReason?: SourceDisableReason;
}

export interface SourceMetadataColumn {
    id: ColumnID;
    name: string;
    sourceIds: SourceID[];
}

export interface SourceMetadataResponse {
    data: {
        sources: SourceMetadataItem[];
        columns: SourceMetadataColumn[];
    };
    meta: {
        generatedAt: number;
        sourceCount: number;
        redirectCount: number;
        disabledCount: number;
        columnCount: number;
    };
}

interface CreateSourceMetadataOptions {
    generatedAt?: number;
    includeRedirects?: boolean;
}

export function createSourceMetadataResponse(options: CreateSourceMetadataOptions = {}): SourceMetadataResponse {
    const sources = createSourceMetadataItems(options);
    const sourceIds = new Set(sources.map((source) => source.id));
    const columns = createSourceMetadataColumns(sourceIds);

    return {
        data: {
            sources,
            columns,
        },
        meta: {
            generatedAt: options.generatedAt ?? Date.now(),
            sourceCount: sources.length,
            redirectCount: sources.filter((source) => source.redirectTo).length,
            disabledCount: sources.filter((source) => source.disabled).length,
            columnCount: columns.length,
        },
    };
}

export function createSourceMetadataItems({
    includeRedirects = false,
}: Pick<CreateSourceMetadataOptions, "includeRedirects"> = {}): SourceMetadataItem[] {
    return objectEntries(dataSources)
        .filter(([, source]) => includeRedirects || !source.redirect)
        .map(([id, source]) => createSourceMetadataItem(id, source))
        .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

function createSourceMetadataItem(id: SourceID, source: Source): SourceMetadataItem {
    return {
        id,
        name: source.name,
        interval: source.interval,
        color: source.color,
        type: source.type ?? "normal",
        disabled: Boolean(source.disable),
        column: source.column,
        columnName: source.column ? metadata[source.column]?.name : undefined,
        title: source.title,
        description: source.desc,
        home: source.home,
        redirectTo: source.redirect,
        disableReason: getDisableReason(source.disable),
    };
}

function createSourceMetadataColumns(sourceIds: Set<SourceID>): SourceMetadataColumn[] {
    return objectEntries(metadata).map(([id, column]) => ({
        id,
        name: column.name,
        sourceIds: column.sources.filter((sourceId) => sourceIds.has(sourceId)),
    }));
}

function getDisableReason(disable: Source["disable"]): SourceDisableReason | undefined {
    if (disable === "cf") return "cloudflare";
    if (disable) return "manual";
    return undefined;
}
