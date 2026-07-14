import type { Database } from "db0";

import { it, vi, expect, describe, afterEach } from "vitest";

const originalEnableCache = process.env.ENABLE_CACHE;
const originalInitTable = process.env.INIT_TABLE;
const originalUseDatabase = globalThis.useDatabase;

afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env.ENABLE_CACHE = originalEnableCache;
    process.env.INIT_TABLE = originalInitTable;
    globalThis.useDatabase = originalUseDatabase;
});

describe("cache database availability", () => {
    it("returns no cache table when the configured database binding is unavailable", async () => {
        process.env.ENABLE_CACHE = "true";
        process.env.INIT_TABLE = "false";
        globalThis.useDatabase = () =>
            ({
                prepare: () => ({
                    get: () => Promise.reject(new Error("[db0] [d1] binding `LATESTNEWS_DB` not found")),
                }),
            }) as unknown as Database;

        const { logger } = await import("../utils/logger");
        vi.spyOn(logger, "error").mockImplementation(() => undefined);

        const { getCacheTable } = await import("./cache");

        await expect(getCacheTable()).resolves.toBeUndefined();
    });

    it("returns the cache table after a successful availability check", async () => {
        process.env.ENABLE_CACHE = "true";
        process.env.INIT_TABLE = "false";
        const get = vi.fn().mockResolvedValue({ id: "probe" });
        globalThis.useDatabase = () =>
            ({
                prepare: () => ({ get }),
            }) as unknown as Database;

        const { getCacheTable } = await import("./cache");
        const cacheTable = await getCacheTable();

        expect(cacheTable).toBeDefined();
        expect(get).toHaveBeenCalledOnce();
    });
});
