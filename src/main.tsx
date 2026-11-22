import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";

import { queryClient } from "./query-client";
import { bootstrapRuntimeSourceCatalog } from "./services/runtime-source-catalog.service";

// Load the bounded runtime catalog before importing route modules. Several atoms derive their
// initial values from dataSources, so rendering first would discard cached dynamic focus items.
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
