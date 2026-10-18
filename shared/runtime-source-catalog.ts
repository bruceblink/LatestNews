import { z } from "zod";

import { metadata } from "./metadata";
import dataSources from "./data-sources";
import { isDynamicSourceId } from "./dynamic-source-id";

import type { Source, SourceID, ColumnID } from "./types";
import type { SourceMetadataItem, SourceMetadataType } from "./source-metadata";

export interface RuntimeSourceDefinition {
    id: string;
    name: string;
    interval: number;
    type?: Exclude<SourceMetadataType, "normal">;
    column?: Exclude<ColumnID, "focus" | "hottest" | "realtime">;
    title?: string;
    desc?: string;
    home?: string;
}

const runtimeSourceSchema = z
    .object({
        id: z.string().refine(isDynamicSourceId),
        name: z.string().trim().min(1).max(80),
        interval: z.number().int().min(30_000).max(86_400_000),
        color: z.literal("primary"),
        type: z.enum(["normal", "hottest", "realtime"]),
        disabled: z.boolean(),
        column: z.enum(["china", "world", "tech", "finance"]).optional(),
        columnName: z.string().max(40).optional(),
        title: z.string().max(40).optional(),
        description: z.string().max(240).optional(),
        home: z.string().url().refine(isHttpsUrl).optional(),
        redirectTo: z.never().optional(),
        disableReason: z.enum(["manual", "cloudflare"]).optional(),
    })
    .strict();

const registeredSourceIds = new Set<string>();

/** Convert plugin metadata to the public source descriptor used by API and renderer. */
export function createRuntimeSourceMetadataItem(source: RuntimeSourceDefinition): SourceMetadataItem {
    const id = source.id as SourceID;
    return {
        id,
        name: source.name,
        interval: source.interval,
        color: "primary",
        type: source.type ?? "normal",
        disabled: false,
        column: source.column,
        columnName: source.column ? metadata[source.column].name : undefined,
        title: source.title,
        description: source.desc,
        home: source.home,
    };
}

/** Register only validated namespaced sources, preserving the static source catalog. */
export function registerRuntimeSourceCatalog(input: unknown): SourceMetadataItem[] {
    if (!Array.isArray(input)) throw new Error("Runtime source catalog must be an array.");

    const validated: SourceMetadataItem[] = [];
    const seen = new Set<string>();
    for (const candidate of input) {
        if (!isRecord(candidate) || typeof candidate.id !== "string" || !candidate.id.startsWith("ext.")) continue;
        const parsed = runtimeSourceSchema.safeParse(candidate);
        if (!parsed.success) {
            throw new Error(`Invalid runtime source metadata for ${candidate.id}.`);
        }
        if (seen.has(parsed.data.id)) throw new Error(`Duplicate runtime source ID ${parsed.data.id}.`);
        if (Object.hasOwn(dataSources, parsed.data.id) && !registeredSourceIds.has(parsed.data.id)) {
            throw new Error(`Runtime source ${parsed.data.id} conflicts with an application source.`);
        }
        seen.add(parsed.data.id);
        validated.push(parsed.data as SourceMetadataItem);
    }

    clearRuntimeSourceCatalog();
    for (const item of validated) {
        const source: Source = {
            name: item.name,
            interval: item.interval,
            color: item.color,
            ...(item.type !== "normal" ? { type: item.type } : {}),
            ...(item.column ? { column: item.column } : {}),
            ...(item.title ? { title: item.title } : {}),
            ...(item.description ? { desc: item.description } : {}),
            ...(item.home ? { home: item.home } : {}),
            ...(item.disabled ? { disable: item.disableReason === "cloudflare" ? "cf" : true } : {}),
        };
        dataSources[item.id] = source;
        registeredSourceIds.add(item.id);
        addRuntimeSourceToMetadata(item.id, source);
    }

    return validated;
}

/** Remove only sources inserted by the runtime catalog, for replacement and isolated tests. */
export function clearRuntimeSourceCatalog() {
    for (const sourceId of registeredSourceIds) {
        delete dataSources[sourceId as SourceID];
        for (const column of Object.values(metadata)) {
            column.sources = column.sources.filter((id) => id !== sourceId);
        }
    }
    registeredSourceIds.clear();
}

function addRuntimeSourceToMetadata(id: SourceID, source: Source) {
    if (source.column) metadata[source.column].sources.push(id);
    if (source.type === "hottest") metadata.hottest.sources.push(id);
    if (source.type === "realtime") metadata.realtime.sources.push(id);
}

function isHttpsUrl(value: string) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password;
    } catch {
        return false;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
