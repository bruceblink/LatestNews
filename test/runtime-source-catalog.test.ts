import { it, expect, describe, afterEach } from "vitest";

import dataSources from "../shared/data-sources";
import { createUnifiedFeedView } from "../shared/unified-feed";
import { createDynamicSourceId } from "../shared/dynamic-source-id";
import { resolveSourceBatchSelection } from "../shared/source-batch";
import { createSourceMetadataResponse } from "../shared/source-metadata";
import {
    clearRuntimeSourceCatalog,
    registerRuntimeSourceCatalog,
    createRuntimeSourceMetadataItem,
} from "../shared/runtime-source-catalog";

const sourceId = createDynamicSourceId("org.latestnews.catalog-test", "latest");
const rssSourceId = createDynamicSourceId("org.latestnews.catalog-rss", "latest");

describe("runtime source catalog", () => {
    afterEach(() => clearRuntimeSourceCatalog());

    it("registers dynamic source metadata for discovery and batch selection", () => {
        const item = createRuntimeSourceMetadataItem({
            id: sourceId,
            name: "Runtime Example",
            interval: 300_000,
            type: "realtime",
            column: "tech",
            title: "Example",
            home: "https://example.test",
        });
        const rssItem = createRuntimeSourceMetadataItem({
            id: rssSourceId,
            name: "RSS Example",
            interval: 900_000,
            type: "realtime",
            column: "world",
        });

        registerRuntimeSourceCatalog([item, rssItem]);

        expect(dataSources[sourceId]).toMatchObject({
            name: "Runtime Example",
            interval: 300_000,
            type: "realtime",
            column: "tech",
            title: "Example",
        });
        expect(createSourceMetadataResponse().data.sources.find((source) => source.id === sourceId)).toMatchObject({
            name: "Runtime Example",
            type: "realtime",
            column: "tech",
        });
        expect(resolveSourceBatchSelection({ sources: [sourceId, rssSourceId] })).toMatchObject({
            sourceIds: [sourceId, rssSourceId],
            invalidSourceIds: [],
        });
        const feed = createUnifiedFeedView([
            {
                id: sourceId,
                name: undefined,
                status: "success",
                updatedTime: 1,
                items: [{ id: 1, title: "Dynamic headline", url: "https://example.test/story/1" }],
            },
        ]);
        expect(feed.items[0]).toMatchObject({
            sourceId,
            sourceName: "Runtime Example",
            categoryId: "tech",
        });
    });

    it("rejects malformed runtime metadata and does not register arbitrary IDs", () => {
        const invalidItem = {
            ...createRuntimeSourceMetadataItem({ id: sourceId, name: "Runtime Example", interval: 300_000 }),
            home: "file:///private/path",
        };

        expect(() => registerRuntimeSourceCatalog([invalidItem])).toThrow("Invalid runtime source metadata");
        expect(Object.hasOwn(dataSources, sourceId)).toBe(false);
    });

    it("rejects repeated runtime IDs and malformed namespaces", () => {
        const item = createRuntimeSourceMetadataItem({ id: sourceId, name: "Runtime Example", interval: 300_000 });
        expect(() => registerRuntimeSourceCatalog([item, item])).toThrow(`Duplicate runtime source ID ${sourceId}`);

        expect(() =>
            registerRuntimeSourceCatalog([{ ...item, id: "ext.org.latestnews.catalog-test..latest" }])
        ).toThrow("Invalid runtime source metadata");
        expect(Object.hasOwn(dataSources, sourceId)).toBe(false);
    });

    it("keeps the previous catalog when a replacement collides with an application ID", () => {
        const validItem = createRuntimeSourceMetadataItem({ id: sourceId, name: "Runtime Example", interval: 300_000 });
        registerRuntimeSourceCatalog([validItem]);

        const conflictingId = createDynamicSourceId("org.latestnews.catalog-test", "weibo");
        dataSources[conflictingId] = { name: "Static Conflict", interval: 300_000, color: "primary" };
        try {
            const conflictingItem = createRuntimeSourceMetadataItem({
                id: conflictingId,
                name: "Conflict",
                interval: 300_000,
            });
            expect(() => registerRuntimeSourceCatalog([conflictingItem])).toThrow(
                "conflicts with an application source"
            );
            expect(dataSources[sourceId]?.name).toBe("Runtime Example");
        } finally {
            delete dataSources[conflictingId];
        }
    });
});
