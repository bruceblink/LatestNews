import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "db0";
import { it, expect, describe } from "vitest";
import { rm, mkdtemp } from "node:fs/promises";
import sqliteConnector from "db0/connectors/better-sqlite3";

import { Cache } from "../server/database/cache-store";
import { createPerformanceCacheController } from "../scripts/performance/cache-controller";

describe("performance cache preparation", () => {
    it("requires committed matching checkpoints, a ready FTS state, and empty recovery queues", async () => {
        const dir = await mkdtemp(join(tmpdir(), "ln-perf-cache-"));
        const path = join(dir, "fixture.sqlite3");
        const db = createDatabase(sqliteConnector({ path }));
        const cache = new Cache(db);
        await cache.init();
        const controller = createPerformanceCacheController(path);
        try {
            expect(controller.isSettled(["weibo"])).toBe(false);
            await cache.set("weibo", [{ id: "fixture", title: "Fixture", url: "https://example.test/fixture" }]);
            expect(controller.isSettled(["weibo"])).toBe(true);
            await db.prepare("INSERT INTO article_fts_pending VALUES('pending')").run();
            expect(controller.isSettled(["weibo"])).toBe(false);
            await db.prepare("DELETE FROM article_fts_pending").run();
            await db.prepare("UPDATE article_fts_repair SET phase='repairing'").run();
            expect(controller.isSettled(["weibo"])).toBe(false);
            await db.prepare("UPDATE article_fts_repair SET phase='ready'").run();
            await db.prepare("UPDATE article_ingest_checkpoint SET observed_at=1").run();
            expect(controller.isSettled(["weibo"])).toBe(false);
            await cache.maintainArticleIndex();
            expect(controller.isSettled(["weibo"])).toBe(true);
            controller.setUpdatedAt(["weibo"], 1000);
            expect(controller.isSettled(["weibo"])).toBe(true);
            expect((await cache.get("weibo"))?.updated).toBe(1000);
            expect(() => controller.setUpdatedAt(["weibo", "missing"], 2000)).toThrow();
            expect((await cache.get("weibo"))?.updated).toBe(1000);
            controller.clear(["weibo"]);
            expect(controller.isSettled(["weibo"])).toBe(false);
        } finally {
            controller.close();
            await db.dispose();
            await rm(dir, { recursive: true, force: true });
        }
    });
});
