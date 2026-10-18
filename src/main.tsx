import type { SourceMetadataResponse } from "@shared/source-metadata";

import ReactDOM from "react-dom/client";
import { sourceApi } from "@shared/source-api";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { registerRuntimeSourceCatalog } from "@shared/runtime-source-catalog";

import { myFetch } from "./utils";

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: false,
            refetchOnWindowFocus: false,
        },
    },
});

await bootstrapRuntimeSourceCatalog();

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

declare module "@tanstack/react-router" {
    interface Register {
        router: typeof router;
    }
}

async function bootstrapRuntimeSourceCatalog() {
    const sourceMetadata = new Map<string, unknown>();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const remoteCatalog = myFetch<SourceMetadataResponse>(sourceApi.sourcesV1, {
        signal: controller.signal,
    })
        .then((response) => response.data.sources)
        .catch(() => []);
    const localCatalog = window.latestNewsDesktop?.listCrawlerSourceMetadata?.().catch(() => []) ?? Promise.resolve([]);

    try {
        const [remoteSources, localSources] = await Promise.all([remoteCatalog, localCatalog]);
        for (const source of remoteSources) sourceMetadata.set(source.id, source);
        for (const source of localSources) sourceMetadata.set(source.id, source);
        registerRuntimeSourceCatalog([...sourceMetadata.values()]);
    } catch (error) {
        console.warn("Runtime crawler source catalog could not be loaded; using built-in sources.", error);
    } finally {
        clearTimeout(timeout);
    }
}
