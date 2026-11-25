import { createDatabase } from "db0";
import { it, expect, describe } from "vitest";
import sqliteConnector from "db0/connectors/better-sqlite3";

import { ArticleIndex } from "./article-index";
import { reconcileArticleEventId } from "./article-event-identity";
import { compareArticleEvents, approveArticleEventAlias } from "./article-event-aliases";

async function fixture(
    run: (db: ReturnType<typeof createDatabase>, index: ArticleIndex, urls: string[]) => Promise<void>
) {
    const db = createDatabase(sqliteConnector({ name: ":memory:" }));
    try {
        const index = new ArticleIndex(db);
        await index.init();
        const urls = ["a", "b", "c", "d"].map((id) => "https://example.test/" + id);
        await index.upsertSourceItems(
            "weibo",
            urls.map((url, i) => ({
                id: String(i),
                title: i < 2 ? "Rust compiler release" : "Other news " + i,
                url,
                pubDate: 1700000000000 + i * 864000000,
            }))
        );
        for (let i = 0; i < 3; i++) await reconcileArticleEventId(db, [urls[i]], "event-" + i);
        await run(db, index, urls);
    } finally {
        await db.dispose();
    }
}
const approval = {
    aliasId: "event-0",
    canonicalId: "event-1",
    actor: "reviewer",
    evidence: "Verified same event against sources",
};

describe("explicit event aliases", () => {
    it("compares disjoint windows without writing and merges only after approval", async () => {
        await fixture(async (db, index, urls) => {
            const candidate = await compareArticleEvents(db, "event-0", "event-1");
            expect(candidate).toMatchObject({ status: "requires-review", exactTitles: ["Rust compiler release"] });
            expect(await db.prepare("SELECT count(*) AS count FROM news_event_aliases").get()).toMatchObject({
                count: 0,
            });
            const result = await approveArticleEventAlias(db, approval);
            expect(await approveArticleEventAlias(db, { ...approval, actor: "second" })).toEqual(result);
            const first = await index.getEvent("event-0", { limit: 1 });
            expect(first).toMatchObject({ status: "ok", canonicalEventId: "event-1", nextCursor: expect.any(String) });
            if (first.status !== "ok") throw new Error("Expected event");
            const second = await index.getEvent("event-1", { limit: 1, after: first.nextCursor });
            if (second.status !== "ok") throw new Error("Expected event");
            expect([...first.items, ...second.items].map((item) => item.eventId).sort()).toEqual([
                "event-0",
                "event-1",
            ]);
            await expect(reconcileArticleEventId(db, [urls[0], urls[1], urls[3]], "event-candidate")).resolves.toBe(
                "event-1"
            );
            expect(
                await db.prepare("SELECT event_id FROM articles WHERE canonical_url = ?").get(urls[0])
            ).toMatchObject({ event_id: "event-0" });
            expect(
                await db.prepare("SELECT event_id FROM articles WHERE canonical_url = ?").get(urls[3])
            ).toMatchObject({ event_id: "event-1" });
            await expect(reconcileArticleEventId(db, [urls[0], urls[2]], "event-conflict")).resolves.toBe(
                "event-conflict"
            );
        });
    });

    it("rejects unknown IDs, cycles, alias chains, self links and conflicting approvals", async () => {
        await fixture(async (db) => {
            await expect(approveArticleEventAlias(db, { ...approval, evidence: "" })).rejects.toThrow();
            await expect(approveArticleEventAlias(db, { ...approval, canonicalId: "unknown" })).rejects.toThrow();
            await expect(approveArticleEventAlias(db, { ...approval, canonicalId: "event-0" })).rejects.toThrow();
            await approveArticleEventAlias(db, approval);
            await expect(approveArticleEventAlias(db, { ...approval, canonicalId: "event-2" })).rejects.toThrow();
            await expect(
                approveArticleEventAlias(db, { ...approval, aliasId: "event-1", canonicalId: "event-2" })
            ).rejects.toThrow();
            await expect(
                approveArticleEventAlias(db, { ...approval, aliasId: "event-2", canonicalId: "event-0" })
            ).rejects.toThrow();
            expect(await db.prepare("SELECT count(*) AS count FROM news_event_aliases").get()).toMatchObject({
                count: 1,
            });
        });
    });

    it("allows only one of two incompatible concurrent approvals", async () => {
        await fixture(async (db) => {
            const results = await Promise.allSettled([
                approveArticleEventAlias(db, approval),
                approveArticleEventAlias(db, { ...approval, aliasId: "event-1", canonicalId: "event-0" }),
            ]);
            expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
            expect(await db.prepare("SELECT count(*) AS count FROM news_event_aliases").get()).toMatchObject({
                count: 1,
            });
        });
    });

    it("keeps previous schema readable without an alias table", async () => {
        await fixture(async (db, index, urls) => {
            await db.prepare("DROP TABLE news_event_aliases").run();
            expect(await index.getEvent("event-0", { limit: 30 })).toMatchObject({
                status: "ok",
                items: [expect.objectContaining({ eventId: "event-0" })],
            });
            expect(await reconcileArticleEventId(db, [urls[0], urls[3]], "candidate")).toBe("event-0");
        });
    });
});
