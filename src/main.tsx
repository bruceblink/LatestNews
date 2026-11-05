import type { SourceMetadataItem, SourceMetadataResponse } from "@shared/source-metadata";

import ReactDOM from "react-dom/client";
import { sourceApi } from "@shared/source-api";
import { QueryClientProvider } from "@tanstack/react-query";
import { isDynamicSourceId } from "@shared/dynamic-source-id";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { registerRuntimeSourceCatalog } from "@shared/runtime-source-catalog";

import { myFetch } from "./utils";
import { queryClient } from "./query-client";

const runtimeSourceCatalogPromise = bootstrapRuntimeSourceCatalog();

const [{ routeTree }, { AuthProvider }] = await Promise.all([import("./routeTree.gen"), import("./auth/AuthProvider")]);

const router = createRouter({
    routeTree,
    context: {
        queryClient,
    },
});

const rootElement = document.getElementById("app")!;

if (!rootElement.innerHTML) {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
        <QueryClientProvider client={queryClient}>
            <AuthProvider>
                <RouterProvider router={router} />
            </AuthProvider>
        </QueryClientProvider>
    );
}

void runtimeSourceCatalogPromise;

declare module "@tanstack/react-router" {
    interface Register {
        router: typeof router;
    }
}

async function bootstrapRuntimeSourceCatalog() {
    const cachedSources = readCachedRuntimeSourceCatalog();
    if (cachedSources.length > 0) {
        try {
            registerRuntimeSourceCatalog(cachedSources);
        } catch {
            // Ignore an invalid snapshot and continue with the live catalogs.
        }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const remoteCatalog = myFetch<SourceMetadataResponse>(sourceApi.sourcesV1, {
        signal: controller.signal,
    })
        .then((response) => ({ available: true, sources: response.data.sources }))
        .catch(() => ({ available: false, sources: [] as SourceMetadataItem[] }));
    const listLocalSourceMetadata = window.latestNewsDesktop?.listCrawlerSourceMetadata;
    const localCatalog = listLocalSourceMetadata
        ? listLocalSourceMetadata()
              .then((sources) => ({ available: true, sources }))
              .catch(() => ({ available: false, sources: [] as SourceMetadataItem[] }))
        : Promise.resolve({ available: false, sources: [] as SourceMetadataItem[] });

    try {
        const [remoteResult, localResult] = await Promise.all([remoteCatalog, localCatalog]);
        const liveSources = new Map<string, SourceMetadataItem>();
        for (const source of remoteResult.sources) {
            if (isDynamicSourceId(source.id)) liveSources.set(source.id, source);
        }
        for (const source of localResult.sources) {
            if (isDynamicSourceId(source.id)) liveSources.set(source.id, source);
        }

        if (remoteResult.available || localResult.available) {
            for (const source of cachedSources) {
                if (!liveSources.has(source.id)) {
                    liveSources.set(source.id, {
                        ...source,
                        disabled: true,
                        disableReason: "manual",
                    });
                }
            }
            const mergedSources = [...liveSources.values()];
            registerRuntimeSourceCatalog(mergedSources);
            writeCachedRuntimeSourceCatalog(mergedSources);
        } else if (cachedSources.length > 0) {
            registerRuntimeSourceCatalog(cachedSources);
        } else {
            registerRuntimeSourceCatalog([]);
        }
    } catch (error) {
        console.warn("Runtime crawler source catalog could not be loaded; using built-in sources.", error);
    } finally {
        clearTimeout(timeout);
    }
}

const RUNTIME_SOURCE_CATALOG_CACHE_KEY = "latestnews:runtime-source-catalog";

function readCachedRuntimeSourceCatalog(): SourceMetadataItem[] {
    try {
        const value = localStorage.getItem(RUNTIME_SOURCE_CATALOG_CACHE_KEY);
        if (!value) return [];
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed)
            ? parsed.filter(
                  (source): source is SourceMetadataItem =>
                      typeof source === "object" &&
                      source !== null &&
                      "id" in source &&
                      typeof source.id === "string" &&
                      isDynamicSourceId(source.id)
              )
            : [];
    } catch {
        return [];
    }
}

function writeCachedRuntimeSourceCatalog(sources: SourceMetadataItem[]) {
    try {
        localStorage.setItem(RUNTIME_SOURCE_CATALOG_CACHE_KEY, JSON.stringify(sources));
    } catch {
        // Catalog persistence is best effort and must not block startup.
    }
}
