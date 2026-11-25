import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "db0";
import { it, expect, describe } from "vitest";
import { rm, mkdtemp } from "node:fs/promises";
import sqliteConnector from "db0/connectors/better-sqlite3";

import { reconcileArticleEventId } from "./article-event-identity";

const a = "https://example.test/a";
const b = "https://example.test/b";
const c = "https://example.test/c";

type TestDatabase = ReturnType<typeof createDatabase>;

async function init(db: TestDatabase) {
    await db.prepare("CREATE TABLE IF NOT EXISTS articles (canonical_url TEXT PRIMARY KEY, event_id TEXT)").run();
}

async function insert(db: TestDatabase, url: string, id: string | null = null) {
    await db.prepare("INSERT INTO articles (canonical_url, event_id) VALUES (?, ?)").run(url, id);
}

async function getId(db: TestDatabase, url: string) {
    const row = (await db.prepare("SELECT event_id FROM articles WHERE canonical_url = ?").get(url)) as {
        event_id: string | null;
    };
    return row.event_id;
}

async function withDatabase(run: (db: TestDatabase) => Promise<void>) {
    const db = createDatabase(sqliteConnector({ name: ":memory:" }));
    try {
        await init(db);
        await run(db);
    } finally {
        await db.dispose();
    }
}

describe("persistent article event identity", () => {
    it("keeps the first assigned ID on backfill, partial views and repeated requests", async () => {
        await withDatabase(async (db) => {
            await insert(db, a);
            await expect(reconcileArticleEventId(db, [a], "event-original")).resolves.toBe("event-original");
            await insert(db, b);
            await expect(reconcileArticleEventId(db, [b, a], "event-earlier")).resolves.toBe("event-original");
            await expect(reconcileArticleEventId(db, [b], "event-partial")).resolves.toBe("event-original");
            await expect(reconcileArticleEventId(db, [a, b, a], "event-repeat")).resolves.toBe("event-original");
            expect(await getId(db, a)).toBe("event-original");
            expect(await getId(db, b)).toBe("event-original");
        });
    });

    it("does not merge conflicting persisted IDs or assign an ambiguous new member", async () => {
        await withDatabase(async (db) => {
            await insert(db, a, "event-a");
            await insert(db, b, "event-b");
            await insert(db, c);
            await expect(reconcileArticleEventId(db, [a, b, c], "event-candidate")).resolves.toBe("event-candidate");
            expect(await getId(db, a)).toBe("event-a");
            expect(await getId(db, b)).toBe("event-b");
            expect(await getId(db, c)).toBeNull();
        });
    });

    it("returns a provisional ID for missing or empty index membership", async () => {
        await withDatabase(async (db) => {
            await expect(reconcileArticleEventId(db, [a], "event-unindexed")).resolves.toBe("event-unindexed");
            await expect(reconcileArticleEventId(db, [], "event-empty")).resolves.toBe("event-empty");
            expect(await db.prepare("SELECT count(*) AS count FROM articles").get()).toMatchObject({ count: 0 });
        });
    });

    it("converges overlapping concurrent requests on the first persisted ID", async () => {
        await withDatabase(async (db) => {
            await insert(db, a);
            await insert(db, b);
            await insert(db, c);
            const ids = await Promise.all([
                reconcileArticleEventId(db, [a, b], "event-first"),
                reconcileArticleEventId(db, [b, c], "event-second"),
            ]);
            expect(ids[0]).toBe(ids[1]);
            expect(await getId(db, a)).toBe(ids[0]);
            expect(await getId(db, b)).toBe(ids[0]);
            expect(await getId(db, c)).toBe(ids[0]);
        });
    });

    it("uses fixed-size SQL bindings for groups larger than 100 members", async () => {
        await withDatabase(async (db) => {
            const urls = Array.from({ length: 150 }, (_, index) => `https://example.test/large/${index}`);
            for (const url of urls) await insert(db, url);
            await expect(reconcileArticleEventId(db, urls, "event-large")).resolves.toBe("event-large");
            expect(
                await db.prepare("SELECT count(*) AS count FROM articles WHERE event_id = ?").get("event-large")
            ).toMatchObject({ count: 150 });
        });
    });

    it("reuses existing IDs after reopening a file database", async () => {
        const directory = await mkdtemp(join(tmpdir(), "latestnews-event-identity-"));
        try {
            const first = createDatabase(sqliteConnector({ cwd: directory, name: "articles" }));
            try {
                await init(first);
                await insert(first, a);
                await reconcileArticleEventId(first, [a], "event-persistent");
            } finally {
                await first.dispose();
            }
            const reopened = createDatabase(sqliteConnector({ cwd: directory, name: "articles" }));
            try {
                await insert(reopened, b);
                await expect(reconcileArticleEventId(reopened, [a, b], "event-backfill")).resolves.toBe(
                    "event-persistent"
                );
                expect(await getId(reopened, b)).toBe("event-persistent");
            } finally {
                await reopened.dispose();
            }
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
});
