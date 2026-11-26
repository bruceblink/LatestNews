import { it, expect, describe } from "vitest";
import { QueryClient } from "@tanstack/react-query";

import { projectNewsReloadData } from "./news-reload-schema";
import { createNewsInsights } from "../../shared/news-insights";
import { getUnifiedFeedCacheKey, getNewsInsightsCacheKey } from "../../shared/source-api";
import {
    digestReloadKey,
    readReloadSnapshot,
    writeReloadSnapshot,
    NEWS_RELOAD_MAX_AGE_MS,
    NEWS_RELOAD_STORAGE_KEY,
} from "./news-reload-cache.service";

function memoryStorage(): Storage {
    const values = new Map<string, string>();
    return {
        get length() {
            return values.size;
        },
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
            values.set(key, value);
        },
        removeItem: (key) => {
            values.delete(key);
        },
        clear: () => {
            values.clear();
        },
        key: (index) => [...values.keys()][index] ?? null,
    };
}
const now = 1795670000000;
const scope = "https://news.example.test/api";
const fixture = {
    id: "hackernews",
    status: "success",
    updatedTime: now,
    items: [{ id: "1", title: "Cached news", url: "https://example.test/1" }],
};
const project = (data: unknown) => projectNewsReloadData("source", data);
const keyFor = (id: string) => digestReloadKey(scope, "source", ["source", id]);

describe("browser reload cache", () => {
    it("keys snapshots by exact filters and API scope without storing raw reading URLs", async () => {
        const history = "https://example.test/private-history";
        const a = getNewsInsightsCacheKey({
            sources: ["weibo", "hackernews"],
            readUrls: [history],
            trendWindow: "24h",
        });
        const b = getNewsInsightsCacheKey({
            sources: ["hackernews", "weibo"],
            readUrls: [history],
            trendWindow: "24h",
        });
        const k = await digestReloadKey(scope, "insights", a);
        expect(k).toMatch(/^[a-f0-9]{64}$/);
        expect(await digestReloadKey(scope, "insights", b)).toBe(k);
        expect(
            await digestReloadKey(
                scope,
                "insights",
                getNewsInsightsCacheKey({ sources: ["hackernews", "weibo"], trendWindow: "24h" })
            )
        ).not.toBe(k);
        expect(
            await digestReloadKey(
                scope,
                "insights",
                getNewsInsightsCacheKey({
                    sources: ["hackernews", "weibo"],
                    readUrls: [history],
                    hiddenUrls: [history],
                    trendWindow: "24h",
                })
            )
        ).not.toBe(k);
        expect(await digestReloadKey("https://another.example.test/api", "insights", a)).not.toBe(k);
        expect(getUnifiedFeedCacheKey({ sources: ["weibo", "hackernews"], since: "24h" })).toEqual(
            getUnifiedFeedCacheKey({ sources: ["hackernews", "weibo"], since: "24h" })
        );
        expect(getUnifiedFeedCacheKey({ sources: ["weibo"], since: "24h" })).not.toEqual(
            getUnifiedFeedCacheKey({ sources: ["weibo"], since: "3d" })
        );
    });

    it("preserves the original savedAt and React Query freshness across a new client", async () => {
        const storage = memoryStorage();
        const key = (await keyFor("hackernews"))!;
        expect(writeReloadSnapshot(key, fixture, project, storage, now)).toBe(true);
        const snapshot = readReloadSnapshot<typeof fixture>(key, project, storage, now + 60000)!;
        const client = new QueryClient();
        client.setQueryData(["source", "hackernews"], snapshot.data, { updatedAt: snapshot.savedAt });
        expect(client.getQueryState(["source", "hackernews"])?.dataUpdatedAt).toBe(now);
        expect(readReloadSnapshot(key, project, storage, now + NEWS_RELOAD_MAX_AGE_MS + 1)).toBeUndefined();
        expect(readReloadSnapshot(key, project, storage, now - 1)).toBeUndefined();
        expect(readReloadSnapshot((await keyFor("weibo"))!, project, storage, now)).toBeUndefined();
    });

    it("keeps the previous valid snapshot when refresh fails or returns degraded/invalid data", async () => {
        const storage = memoryStorage();
        const key = (await keyFor("hackernews"))!;
        expect(
            writeReloadSnapshot(
                key,
                {
                    ...fixture,
                    authorization: "not-a-real-secret",
                    items: [{ ...fixture.items[0], unknown: "not-persisted" }],
                },
                project,
                storage,
                now
            )
        ).toBe(true);
        expect(storage.getItem(NEWS_RELOAD_STORAGE_KEY)).not.toContain("not-a-real-secret");
        expect(storage.getItem(NEWS_RELOAD_STORAGE_KEY)).not.toContain("not-persisted");
        for (const response of [
            { ...fixture, status: "stale-cache" },
            { ...fixture, status: "empty", items: [] },
            { ...fixture, items: [{ ...fixture.items[0], url: "javascript:alert(1)" }] },
            { ...fixture, items: [null] },
        ]) {
            expect(writeReloadSnapshot(key, response, project, storage, now + 1)).toBe(false);
        }
        expect(readReloadSnapshot(key, project, storage, now + 2)).toEqual({ key, savedAt: now, data: fixture });
    });

    it("bounds entry count, size, and gracefully handles corrupt or unavailable storage", async () => {
        const storage = memoryStorage();
        for (let i = 0; i < 40; i++)
            expect(writeReloadSnapshot((await keyFor("id-" + i))!, fixture, project, storage, now + i)).toBe(true);
        const entries = JSON.parse(storage.getItem(NEWS_RELOAD_STORAGE_KEY)!);
        expect(entries).toHaveLength(32);
        expect(readReloadSnapshot((await keyFor("id-0"))!, project, storage, now + 40)).toBeUndefined();
        expect(
            writeReloadSnapshot(
                (await keyFor("large"))!,
                { ...fixture, items: [{ ...fixture.items[0], title: "x".repeat(200000) }] },
                project,
                storage,
                now + 40
            )
        ).toBe(false);
        storage.setItem(NEWS_RELOAD_STORAGE_KEY, "{broken");
        expect(readReloadSnapshot((await keyFor("id-39"))!, project, storage, now + 40)).toBeUndefined();
        storage.setItem = () => {
            throw new Error("quota");
        };
        expect(writeReloadSnapshot((await keyFor("quota"))!, fixture, project, storage, now + 40)).toBe(false);
    });
    it("does not replace a complete insight with a later partial result", async () => {
        const storage = memoryStorage();
        const key = (await digestReloadKey(scope, "insights", ["fixture"]))!;
        const complete = { data: { itemCount: 1 }, meta: { partial: false } };
        const partial = { data: { itemCount: 1 }, meta: { partial: true } };
        const accept = (data: unknown) => data;
        expect(writeReloadSnapshot(key, partial, accept, storage, now)).toBe(true);
        expect(writeReloadSnapshot(key, complete, accept, storage, now + 1)).toBe(true);
        expect(writeReloadSnapshot(key, partial, accept, storage, now + 2)).toBe(false);
        expect(readReloadSnapshot(key, accept, storage, now + 3)).toEqual({ key, savedAt: now + 1, data: complete });
    });

    it("persists a resolved empty insight, including one produced by hiding all articles", async () => {
        const storage = memoryStorage();
        const key = (await digestReloadKey(scope, "insights", ["hidden-all"]))!;
        const data = createNewsInsights([{ ...fixture, id: "hackernews", status: "success" }], {
            generatedAt: now,
            hiddenUrls: [fixture.items[0].url],
        });
        expect(data.itemCount).toBe(0);
        const response = {
            data,
            meta: {
                generatedAt: now,
                requestedSourceCount: 1,
                resolvedSourceCount: 1,
                partial: false,
                omittedSourceIds: [],
            },
            errors: [],
        };
        const projectInsights = (value: unknown) => projectNewsReloadData("insights", value);
        expect(writeReloadSnapshot(key, response, projectInsights, storage, now)).toBe(true);
        expect(readReloadSnapshot(key, projectInsights, storage, now + 1000)).toMatchObject({
            savedAt: now,
            data: { data: { itemCount: 0 }, meta: { partial: false, resolvedSourceCount: 1 } },
        });
        const partialEmpty = {
            ...response,
            meta: { ...response.meta, requestedSourceCount: 2, partial: true, omittedSourceIds: ["weibo"] },
        };
        expect(projectInsights(partialEmpty)).toBeDefined();
        expect(writeReloadSnapshot(key, partialEmpty, projectInsights, storage, now + 2000)).toBe(false);
        for (const failure of [
            {
                ...response,
                meta: { ...response.meta, partial: true, resolvedSourceCount: 0, omittedSourceIds: ["hackernews"] },
            },
            { ...response, data: { ...data, itemCount: -1 } },
            { ...response, data: { ...data, itemCount: 0.5 } },
        ]) {
            expect(writeReloadSnapshot(key, failure, projectInsights, storage, now + 3000)).toBe(false);
        }
        expect(readReloadSnapshot(key, projectInsights, storage, now + 4000)?.savedAt).toBe(now);
    });
});
