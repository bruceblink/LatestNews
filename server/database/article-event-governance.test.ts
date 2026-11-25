import { createDatabase } from "db0";
import { it, expect, describe } from "vitest";
import sqliteConnector from "db0/connectors/better-sqlite3";

import { ArticleIndex } from "./article-index";
import { approveArticleEventAlias } from "./article-event-aliases";
import { resolveTopicEvent, assignReviewedEvent } from "./article-event-governance";

const urls = ["a", "b", "c", "d"].map((id) => "https://example.test/" + id);
const topic = (members: string[], eventId = "event-v1-collision") => ({
    id: "display",
    eventId,
    title: "Fixture event",
    sources: ["weibo" as const],
    sourceNames: ["Weibo"],
    itemCount: members.length,
    keywords: ["fixture"],
    items: members.map((url, i) => ({ id: String(i), sourceId: "weibo" as const, title: "Fixture", url })),
});
const approval = (members: string[], eventId?: string) => ({
    urls: members,
    actor: "reviewer",
    evidence: "Reviewed fixture evidence",
    eventId,
});

async function fixture(run: (db: ReturnType<typeof createDatabase>, index: ArticleIndex) => Promise<void>) {
    const db = createDatabase(sqliteConnector({ name: ":memory:" }));
    try {
        const index = new ArticleIndex(db);
        await index.init();
        await index.upsertSourceItems(
            "weibo",
            urls.map((url, i) => ({ id: String(i), title: "Fixture " + i, url }))
        );
        await run(db, index);
    } finally {
        await db.dispose();
    }
}

describe("N4-M reviewed event governance", () => {
    it("does not persist display grouping or trust a candidate collision", async () => {
        await fixture(async (db, index) => {
            const first = await assignReviewedEvent(db, approval([urls[0]]));
            const second = await assignReviewedEvent(db, approval([urls[1]]));
            const result = await index.resolveEventIds([topic([urls[0], urls[1], urls[2]], first.eventId)]);
            expect(result[0]).toMatchObject({
                identityStatus: "conflict",
                eventId: expect.stringMatching(/^candidate-v2-/),
            });
            expect(result[0].eventId).not.toBe(first.eventId);
            expect(await db.prepare("SELECT event_id FROM articles WHERE canonical_url=?").get(urls[2])).toEqual({
                event_id: null,
            });
            expect(await index.getEvent(first.eventId, { limit: 30 })).toMatchObject({
                status: "ok",
                items: [expect.objectContaining({ eventId: first.eventId })],
            });
            expect(await index.getEvent(second.eventId, { limit: 30 })).toMatchObject({ status: "ok" });
            expect((await index.resolveEventIds([topic([urls[3]])]))[0].identityStatus).toBe("candidate");
        });
    });
    it("requires all displayed URLs to be registered under the same canonical event", async () => {
        await fixture(async (db, index) => {
            const registered = await assignReviewedEvent(db, approval([urls[0]]));
            expect(await resolveTopicEvent(db, topic([urls[0], urls[2]]))).toMatchObject({ identityStatus: "partial" });
            expect(await resolveTopicEvent(db, topic([urls[0], "https://example.test/missing"]))).toMatchObject({
                identityStatus: "partial",
            });
            expect(await resolveTopicEvent(db, topic([urls[0], urls[0]]))).toMatchObject({
                identityStatus: "registered",
                eventId: registered.eventId,
            });
            await assignReviewedEvent(db, approval([urls[2]], registered.eventId));
            expect((await index.resolveEventIds([topic([urls[0], urls[2]])]))[0]).toMatchObject({
                identityStatus: "registered",
                eventId: registered.eventId,
            });
            const rows = await db.prepare("SELECT event_id,actor,evidence FROM news_event_approvals").all();
            expect(rows).toHaveLength(2);
        });
    });
    it("does not assign missing articles, unknown IDs or conflicting approvals", async () => {
        await fixture(async (db) => {
            const first = await assignReviewedEvent(db, approval([urls[0]]));
            const second = await assignReviewedEvent(db, approval([urls[1]]));
            await expect(assignReviewedEvent(db, approval([urls[0], urls[2]]))).rejects.toThrow();
            await expect(assignReviewedEvent(db, approval([urls[2]], "unknown"))).rejects.toThrow();
            await expect(assignReviewedEvent(db, approval([urls[1], urls[2]], first.eventId))).rejects.toThrow();
            await expect(
                assignReviewedEvent(db, approval([urls[3], "https://example.test/missing"], second.eventId))
            ).rejects.toThrow();
            expect(await db.prepare("SELECT count(*) AS count FROM news_event_approvals").get()).toEqual({ count: 2 });
            expect(await db.prepare("SELECT count(*) AS count FROM articles WHERE event_id IS NULL").get()).toEqual({
                count: 2,
            });
        });
    });
    it("rejects overlapping simultaneous new-event approvals atomically", async () => {
        await fixture(async (db) => {
            const result = await Promise.allSettled([
                assignReviewedEvent(db, approval([urls[0], urls[1]])),
                assignReviewedEvent(db, approval([urls[1], urls[2]])),
            ]);
            expect(result.filter((row) => row.status === "fulfilled")).toHaveLength(1);
            expect(await db.prepare("SELECT count(*) AS count FROM news_event_approvals").get()).toEqual({ count: 1 });
            expect(await db.prepare("SELECT count(*) AS count FROM articles WHERE event_id IS NOT NULL").get()).toEqual(
                { count: 2 }
            );
        });
    });
    it("resolves approved aliases without overwriting historical assignments", async () => {
        await fixture(async (db) => {
            const a = await assignReviewedEvent(db, approval([urls[0]])),
                b = await assignReviewedEvent(db, approval([urls[1]]));
            await approveArticleEventAlias(db, {
                aliasId: a.eventId,
                canonicalId: b.eventId,
                actor: "reviewer",
                evidence: "fixture",
            });
            expect(await resolveTopicEvent(db, topic([urls[0], urls[1]]))).toMatchObject({
                identityStatus: "registered",
                eventId: b.eventId,
            });
            await expect(assignReviewedEvent(db, approval([urls[2]], a.eventId))).rejects.toThrow();
            await assignReviewedEvent(db, approval([urls[0], urls[2]], b.eventId));
            expect(await db.prepare("SELECT event_id FROM articles WHERE canonical_url=?").get(urls[0])).toEqual({
                event_id: a.eventId,
            });
        });
    });
    it("rolls back audit, registry and membership together if assignment fails", async () => {
        await fixture(async (db) => {
            await db
                .prepare(
                    "CREATE TRIGGER fail_review BEFORE UPDATE OF event_id ON articles BEGIN SELECT RAISE(ABORT,'fixture failure'); END"
                )
                .run();
            await expect(assignReviewedEvent(db, approval([urls[0]]))).rejects.toThrow();
            expect(await db.prepare("SELECT count(*) AS count FROM news_event_approvals").get()).toEqual({ count: 0 });
            expect(await db.prepare("SELECT count(*) AS count FROM news_events").get()).toEqual({ count: 0 });
            expect(await db.prepare("SELECT event_id FROM articles WHERE canonical_url=?").get(urls[0])).toEqual({
                event_id: null,
            });
        });
    });
});
