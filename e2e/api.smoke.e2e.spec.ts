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

test("does not serve retired APIs through the SPA renderer", async ({ request }) => {
    for (const path of [
        "/api/s",
        "/api/s/ids",
        "/api/s/health",
        "/api/latest",
        "/api/enable-login",
        "/api/proxy/img.png",
        "/api/v1/media/image",
    ]) {
        expect((await request.get(path)).status(), path).toBe(404);
    }
    expect((await request.post("/api/s/entire", { data: { sources: ["hackernews"] } })).status()).toBe(404);
    expect((await request.post("/api/s/insights", { data: { sources: ["hackernews"] } })).status()).toBe(404);
    expect(await (await request.get("/api/v1/auth/capability")).json()).toEqual({ enable: expect.any(Boolean) });
});
