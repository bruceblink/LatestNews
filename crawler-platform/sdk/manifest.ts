import { z } from "zod";

import { CrawlerPlatformError } from "../core/errors";
import { createDynamicSourceId } from "../../shared/dynamic-source-id";

const pluginIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const channelIdPattern = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const versionPattern =
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?$/;

const sourceSchema = z
    .object({
        id: z.string().regex(channelIdPattern),
        name: z.string().trim().min(1).max(80),
        kind: z.enum(["timeline", "hottest", "realtime"]),
        refreshIntervalSeconds: z.number().int().min(30).max(86400),
        column: z.enum(["china", "world", "tech", "finance"]).optional(),
        title: z.string().trim().min(1).max(40).optional(),
        description: z.string().trim().min(1).max(240).optional(),
        home: z.string().url().refine(isAllowedHomePage, "Expected an HTTPS homepage without credentials.").optional(),
    })
    .strict();

const networkPermissionSchema = z
    .object({
        origin: z.string().url().refine(isAllowedOrigin, "Expected an HTTPS origin without a path or credentials."),
        methods: z.array(z.enum(["GET", "HEAD", "POST"])).min(1),
    })
    .strict()
    .superRefine((permission, context) => {
        if (new Set(permission.methods).size !== permission.methods.length) {
            context.addIssue({ code: "custom", path: ["methods"], message: "Methods must be unique." });
        }
    });

export const crawlerPluginManifestSchema = z
    .object({
        manifestVersion: z.literal(1),
        id: z.string().min(3).max(64).regex(pluginIdPattern),
        name: z.string().trim().min(1).max(80),
        version: z.string().regex(versionPattern),
        apiVersion: z.string().regex(/^\^?1\.\d+\.\d+$/),
        runtime: z.literal("trusted-js"),
        entry: z.string().min(1).max(200).refine(isSafeRelativeEntry),
        targets: z.array(z.enum(["node", "electron"])).min(1),
        permissions: z
            .object({
                network: z.array(networkPermissionSchema).max(32),
            })
            .strict(),
        sources: z.array(sourceSchema).min(1).max(64),
    })
    .strict()
    .superRefine((manifest, context) => {
        if (new Set(manifest.targets).size !== manifest.targets.length) {
            context.addIssue({ code: "custom", path: ["targets"], message: "Targets must be unique." });
        }

        const sourceIds = manifest.sources.map((source) => source.id);
        if (new Set(sourceIds).size !== sourceIds.length) {
            context.addIssue({ code: "custom", path: ["sources"], message: "Source IDs must be unique." });
        }

        for (const source of manifest.sources) {
            try {
                createDynamicSourceId(manifest.id, source.id);
            } catch (error) {
                context.addIssue({
                    code: "custom",
                    path: ["sources", source.id],
                    message: error instanceof Error ? error.message : "Invalid dynamic source ID.",
                });
            }
        }

        const origins = manifest.permissions.network.map((permission) => permission.origin);
        if (new Set(origins).size !== origins.length) {
            context.addIssue({ code: "custom", path: ["permissions", "network"], message: "Origins must be unique." });
        }
    });

export type CrawlerPluginManifest = z.infer<typeof crawlerPluginManifestSchema>;
export type CrawlerSourceManifest = CrawlerPluginManifest["sources"][number];
export type CrawlerNetworkPermission = CrawlerPluginManifest["permissions"]["network"][number];

/** Validate plugin metadata before the host loads any plugin code. */
export function parseCrawlerPluginManifest(input: unknown): CrawlerPluginManifest {
    const result = crawlerPluginManifestSchema.safeParse(input);
    if (!result.success) {
        const details = result.error.issues
            .map((issue) => `${issue.path.join(".") || "manifest"}: ${issue.message}`)
            .join("; ");
        throw new CrawlerPlatformError("INVALID_MANIFEST", details);
    }

    return result.data;
}

function isAllowedOrigin(value: string) {
    try {
        const url = new URL(value);
        return (
            url.protocol === "https:" &&
            !url.username &&
            !url.password &&
            url.pathname === "/" &&
            !url.search &&
            !url.hash &&
            url.origin === value.replace(/\/$/, "")
        );
    } catch {
        return false;
    }
}

function isAllowedHomePage(value: string) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password;
    } catch {
        return false;
    }
}

function isSafeRelativeEntry(value: string) {
    if (value.startsWith("/") || value.includes("\\") || value.includes(":") || value.includes("\0")) return false;
    const segments = value.split("/");
    return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}
