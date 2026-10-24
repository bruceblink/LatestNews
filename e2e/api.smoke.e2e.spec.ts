import { test, expect } from "@playwright/test";

// Use the real Nitro routes so browser API mocks cannot hide server import failures.
test("serves source metadata and health from the local API", async ({ request }) => {
    for (const path of ["/api/v1/sources", "/api/v1/health/sources", "/api/v1/health/deployment"]) {
        const response = await request.get(path);
        expect(response.status(), path).toBe(200);
        expect(await response.json()).toHaveProperty("data");
    }
});

test("loads source adapters before rejecting an unknown source", async ({ request }) => {
    const response = await request.get("/api/v1/sources/unknown-source-for-smoke-test/items");

    expect(response.status()).toBe(400);
});
