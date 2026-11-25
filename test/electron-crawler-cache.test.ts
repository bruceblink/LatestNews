import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, vi, expect, describe, afterEach } from "vitest";
import { rm, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";

import { CrawlerCacheStore } from "../electron/crawler-cache";

import type { NewsItem } from "../shared/types";

const temporaryDirectories: string[] = [];

afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(
        temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
    );
});

describe("desktop crawler cache", () => {
    it("persists normalized items and reloads them from disk", async () => {
        const path = await createCachePath();
        const store = new CrawlerCacheStore({ path });
        const items = [createItem("one")];

        await store.write("juejin", items, 1_000);

        await expect(store.read("juejin")).resolves.toEqual({ updatedTime: 1_000, items });
        const reloaded = new CrawlerCacheStore({ path });
        await expect(reloaded.read("juejin")).resolves.toEqual({ updatedTime: 1_000, items });
        await expect(readdir(join(path, ".."))).resolves.toEqual(["crawler-cache.json"]);
    });

    it("ignores corrupt, oversized, and unsafe cache records", async () => {
        const path = await createCachePath();
        await writeFile(path, "{not-json", "utf8");
        await expect(new CrawlerCacheStore({ path }).read("juejin")).resolves.toBeUndefined();

        await writeFile(path, "x".repeat(200), "utf8");
        await expect(new CrawlerCacheStore({ path, maxFileBytes: 100 }).read("juejin")).resolves.toBeUndefined();

        const store = new CrawlerCacheStore({ path });
        await store.write("../escape", [createItem("unsafe")], 1_000);
        await expect(store.read("../escape")).resolves.toBeUndefined();
    });

    it("filters legacy unsafe links on load without rewriting the file", async () => {
        const path = await createCachePath();
        const safe = createItem("safe");
        const bad = { ...createItem("bad"), url: "file:///legacy" };
        const legacy = JSON.stringify({
            version: 1,
            entries: { juejin: { updatedTime: 1000, items: [bad, { ...safe, mobileUrl: bad.url }] } },
        });
        await writeFile(path, legacy, "utf8");
        const store = new CrawlerCacheStore({ path });
        expect(await store.read("juejin")).toEqual({ updatedTime: 1000, items: [safe] });
        expect(await readFile(path, "utf8")).toBe(legacy);
        await store.write("juejin", [bad], 2000);
        expect(await readFile(path, "utf8")).toBe(legacy);
    });

    it("limits the number of sources and items per source", async () => {
        const path = await createCachePath();
        vi.useFakeTimers();
        const store = new CrawlerCacheStore({ path, maxSources: 2, maxItemsPerSource: 2 });

        vi.setSystemTime(1_000);
        await store.write("first", [createItem("1"), createItem("2"), createItem("3")], 1_000);
        vi.setSystemTime(2_000);
        await store.write("second", [createItem("4")], 2_000);
        vi.setSystemTime(3_000);
        await store.write("third", [createItem("5")], 3_000);

        await expect(store.read("first")).resolves.toBeUndefined();
        await expect(store.read("second")).resolves.toMatchObject({ updatedTime: 2_000 });
        await expect(store.read("third")).resolves.toMatchObject({ updatedTime: 3_000 });
        const persisted = JSON.parse(await readFile(path, "utf8")) as {
            entries: Record<string, { items: NewsItem[] }>;
        };
        expect(persisted.entries.third?.items).toHaveLength(1);
    });

    it("keeps concurrent source writes in the final file", async () => {
        const path = await createCachePath();
        const store = new CrawlerCacheStore({ path });

        await Promise.all([
            store.write("alpha", [createItem("a")], 1_000),
            store.write("beta", [createItem("b")], 2_000),
        ]);

        const reloaded = new CrawlerCacheStore({ path });
        await expect(reloaded.read("alpha")).resolves.toMatchObject({ updatedTime: 1_000 });
        await expect(reloaded.read("beta")).resolves.toMatchObject({ updatedTime: 2_000 });
    });
});

async function createCachePath() {
    const directory = await mkdtemp(join(tmpdir(), "latestnews-cache-"));
    temporaryDirectories.push(directory);
    return join(directory, "crawler-cache.json");
}

function createItem(id: string): NewsItem {
    return {
        id,
        title: "Item " + id,
        url: "https://example.test/" + id,
    };
}
