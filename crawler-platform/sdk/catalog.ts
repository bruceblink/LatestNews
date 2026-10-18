import { z } from "zod";

import { CrawlerPlatformError } from "../core/errors";

const pluginIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const versionPattern =
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?$/;

const catalogVersionSchema = z
    .object({
        version: z.string().regex(versionPattern),
        sourcePath: z.string().min(1).max(200).refine(isSafeRelativePath),
    })
    .strict();

export const crawlerPluginCatalogSchema = z
    .object({
        catalogVersion: z.literal(1),
        plugins: z
            .array(
                z
                    .object({
                        id: z.string().min(3).max(64).regex(pluginIdPattern),
                        name: z.string().trim().min(1).max(80),
                        versions: z.array(catalogVersionSchema).min(1).max(64),
                    })
                    .strict()
                    .superRefine((plugin, context) => {
                        const versions = plugin.versions.map((version) => version.version);
                        if (new Set(versions).size !== versions.length) {
                            context.addIssue({
                                code: "custom",
                                path: ["versions"],
                                message: "Plugin versions must be unique.",
                            });
                        }
                    })
            )
            .max(512),
    })
    .strict()
    .superRefine((catalog, context) => {
        const pluginIds = catalog.plugins.map((plugin) => plugin.id);
        if (new Set(pluginIds).size !== pluginIds.length) {
            context.addIssue({ code: "custom", path: ["plugins"], message: "Plugin IDs must be unique." });
        }
    });

export type CrawlerPluginCatalog = z.infer<typeof crawlerPluginCatalogSchema>;
export type CrawlerPluginCatalogEntry = CrawlerPluginCatalog["plugins"][number];

/** Validate the static local catalog before resolving any plugin source directory. */
export function parseCrawlerPluginCatalog(input: unknown): CrawlerPluginCatalog {
    const result = crawlerPluginCatalogSchema.safeParse(input);
    if (!result.success) {
        const details = result.error.issues
            .map((issue) => `${issue.path.join(".") || "catalog"}: ${issue.message}`)
            .join("; ");
        throw new CrawlerPlatformError("INVALID_MANIFEST", details);
    }
    return result.data;
}

function isSafeRelativePath(value: string) {
    if (value.startsWith("/") || value.includes("\\") || value.includes(":") || value.includes("\0")) return false;
    const segments = value.split("/");
    return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}
