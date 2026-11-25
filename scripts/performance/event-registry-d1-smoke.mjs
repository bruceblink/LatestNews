import { tmpdir } from "node:os";
import process from "node:process";
import { createDatabase } from "db0";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import d1Connector from "db0/connectors/cloudflare-d1";
import { rm, mkdtemp, readFile } from "node:fs/promises";

import { ArticleIndex } from "../../server/database/article-index.ts";
import { reconcileArticleEventId } from "../../server/database/article-event-identity.ts";
import { approveArticleEventAlias } from "../../server/database/article-event-aliases.ts";

// Run via tsx after build:pages. Miniflare is installed separately so production
// dependencies and the repository lockfile remain unchanged.
const miniflareDir = process.env.LATESTNEWS_MINIFLARE_DIR;
if (!miniflareDir) throw new Error("Set LATESTNEWS_MINIFLARE_DIR to an isolated Miniflare installation directory.");
const { Miniflare } = createRequire(join(resolve(miniflareDir), "package.json"))("miniflare");
const root = fileURLToPath(new URL("../..", import.meta.url));
const config = JSON.parse(await readFile(join(root, "wrangler.json"), "utf8"));
const dir = await mkdtemp(join(tmpdir(), "latestnews-event-d1-"));
const now = Date.now();
const options = {
    modules: true,
    scriptPath: join(root, "dist/_worker.js/index.js"),
    compatibilityDate: process.env.LATESTNEWS_D1_TEST_COMPAT_DATE || config.compatibility_date,
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { LATESTNEWS_DB: "latestnews-event-isolated-fixture" },
    d1Persist: dir,
    bindings: { ENABLE_CACHE: "true", INIT_TABLE: "true" },
    // No real upstream collection. All API inputs come from local fixtures.
    outboundService: { external: { address: "127.0.0.1:1" } },
};
let mf;
const makeItem = (id, pubDate, title = "LatestNews event fixture") => ({
    id,
    title,
    url: "https://example.test/" + id,
    pubDate,
});

async function start() {
    mf = new Miniflare(options);
    const binding = await mf.getD1Database("LATESTNEWS_DB");
    globalThis.__env__ = { LATESTNEWS_DB: binding };
    const db = createDatabase(d1Connector({ bindingName: "LATESTNEWS_DB" }));
    const index = new ArticleIndex(db);
    await index.init();
    await db.prepare("CREATE TABLE IF NOT EXISTS cache (id TEXT PRIMARY KEY, updated INTEGER, data TEXT)").run();
    return { db, index };
}

async function seed(ctx, source, items) {
    await ctx.index.upsertSourceItems(source, items);
    await ctx.db
        .prepare(
            "INSERT INTO cache (id, updated, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET updated=excluded.updated,data=excluded.data"
        )
        .run(source, now, JSON.stringify(items));
}

async function request(sources, hiddenUrls = []) {
    const r = await mf.dispatchFetch("http://localhost/api/v1/insights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sources, minTopicItems: 1, hiddenUrls }),
    });
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(body.meta.partial, false);
    return body.data.topicEvents;
}

async function get(path, status = 200) {
    const r = await mf.dispatchFetch("http://localhost" + path);
    const body = await r.json();
    assert.equal(r.status, status, JSON.stringify(body));
    return body;
}

async function event(id, query = "") {
    return get("/api/v1/events/" + encodeURIComponent(id) + query);
}

async function search() {
    return (await get("/api/v1/articles/search?q=LatestNews")).data;
}

try {
    console.log("Isolated D1 runtime date:", options.compatibilityDate);
    let ctx = await start();
    // Simulate an existing N4-F database. Worker startup must backfill it.
    await ctx.db.prepare("DROP TRIGGER trg_articles_event_insert").run();
    await ctx.db.prepare("DROP TRIGGER trg_articles_event_update").run();
    await ctx.db.prepare("DROP TABLE news_events").run();
    const legacy = makeItem("legacy", now, "Legacy indexed report");
    await ctx.index.upsertSourceItems("v2ex", [legacy]);
    await reconcileArticleEventId(ctx.db, [legacy.url], "event-legacy");

    const original = makeItem("original", now - 60_000);
    const earlier = makeItem("earlier", now - 3_600_000);
    await seed(ctx, "hackernews", [original]);
    const first = (await request(["hackernews"]))[0];
    assert.ok(first.eventId);
    const migrated = await event("event-legacy");
    assert.equal(migrated.data.items[0].eventId, "event-legacy");
    console.log("PASS legacy event registry migration via built Pages worker");

    await seed(ctx, "weibo", [earlier]);
    const both = (await request(["hackernews", "weibo"]))[0];
    assert.equal(both.eventId, first.eventId);
    assert.equal(both.itemCount, 2);
    assert.notEqual(both.id, first.id);
    assert.equal((await request(["weibo"]))[0].eventId, first.eventId);
    assert.equal((await request(["hackernews", "weibo"], [original.url]))[0].eventId, first.eventId);
    const indexed = await search();
    assert.equal(indexed.items.length, 2);
    assert.ok(indexed.items.every((item) => item.eventId === first.eventId));
    const history = await event(first.eventId);
    assert.equal(history.data.items.length, 2);
    assert.ok(history.data.items.every((item) => item.eventId === first.eventId));
    console.log("PASS built Pages insights/search/history: backfill, partial, hidden, consistency");

    const items = Array.from({ length: 150 }, (_, i) => makeItem("bulk-" + i, now, "Fixture bulk " + i));
    await ctx.index.upsertSourceItems("v2ex", items);
    assert.equal(await reconcileArticleEventId(ctx.db, items.map((item) => item.url), "event-large"), "event-large");
    const count = await ctx.db.prepare("SELECT COUNT(*) AS n FROM articles WHERE event_id=?").get("event-large");
    assert.equal(Number(count.n), 150);
    const page1 = await event("event-large", "?limit=100");
    assert.equal(page1.data.items.length, 100);
    assert.ok(page1.meta.nextCursor);
    const page2 = await event("event-large", "?limit=100&after=" + page1.meta.nextCursor);
    assert.equal(page2.data.items.length, 50);
    assert.equal(page2.meta.nextCursor, undefined);
    assert.equal(new Set([...page1.data.items, ...page2.data.items].map((item) => item.articleKey)).size, 150);
    console.log("PASS D1 150-member assignment and 100/50 keyset pagination");

    const fixtures = Array.from({ length: 30 }, (_, i) => makeItem("race-" + i, now, "Fixture race " + i));
    await ctx.index.upsertSourceItems("v2ex", fixtures);
    for (let i = 0; i < 10; i += 1) {
        const [a, b, c] = fixtures.slice(i * 3, i * 3 + 3);
        const ids = await Promise.all([
            reconcileArticleEventId(ctx.db, [a.url, b.url], "event-race-a-" + i),
            reconcileArticleEventId(ctx.db, [b.url, c.url], "event-race-b-" + i),
        ]);
        assert.equal(ids[0], ids[1]);
        const result = await event(ids[0]);
        assert.equal(result.data.items.length, 3);
        assert.ok(result.data.items.every((item) => item.eventId === ids[0]));
        await get("/api/v1/events/" + (ids[0] === "event-race-a-" + i ? "event-race-b-" + i : "event-race-a-" + i), 404);
    }
    console.log("PASS D1 10 overlapping concurrent assignment pairs; only winning IDs registered");

    const [a, b, c] = ["a", "b", "c"].map((suffix) => makeItem("conflict-" + suffix, now, "Conflict " + suffix));
    await ctx.index.upsertSourceItems("v2ex", [a, b, c]);
    await reconcileArticleEventId(ctx.db, [a.url], "event-a");
    await reconcileArticleEventId(ctx.db, [b.url], "event-b");
    assert.equal(await reconcileArticleEventId(ctx.db, [a.url, b.url, c.url], "event-conflict"), "event-conflict");
    const rows = await ctx.db
        .prepare("SELECT event_id FROM articles WHERE canonical_url IN (?,?,?) ORDER BY canonical_url")
        .all(a.url, b.url, c.url);
    assert.deepEqual(rows.map((row) => row.event_id), ["event-a", "event-b", null]);
    await get("/api/v1/events/event-conflict", 404);
    await get("/api/v1/events/event-a?limit=101", 400);
    console.log("PASS D1 conflict preservation and API 400/404");

    const alias = await approveArticleEventAlias(ctx.db, {
        aliasId: "event-a", canonicalId: "event-b", actor: "isolated-test", evidence: "fixture approval only"
    });
    assert.equal(alias.canonicalId, "event-b");
    await assert.rejects(approveArticleEventAlias(ctx.db, {
        aliasId: "event-b", canonicalId: "event-a", actor: "isolated-test", evidence: "cycle"
    }));
    const mergedHistory = await event("event-a");
    assert.equal(mergedHistory.data.canonicalEventId, "event-b");
    assert.deepEqual(mergedHistory.data.items.map((item) => item.eventId).sort(), ["event-a", "event-b"]);
    assert.equal(await reconcileArticleEventId(ctx.db, [a.url, b.url, c.url], "candidate"), "event-b");
    console.log("PASS D1 explicit alias, cycle guard and canonical assignment");
    await ctx.db.prepare("DELETE FROM cache WHERE id IN (?,?)").run("hackernews", "weibo");
    await mf.dispose();
    mf = undefined;
    ctx = await start();
    assert.equal((await event("event-a")).data.items.length, 3);
    const persisted = await event(first.eventId);
    assert.equal(persisted.data.registeredAt, history.data.registeredAt);
    assert.equal(persisted.data.items.length, 2);
    assert.ok(persisted.data.items.every((item) => item.eventId === first.eventId));
    const restarted = await search();
    assert.equal(restarted.items.length, 2);
    assert.ok(restarted.items.every((item) => item.eventId === first.eventId));
    assert.equal((await event("event-legacy")).data.registeredAt, migrated.data.registeredAt);
    console.log("PASS D1 source-cache deletion, workerd restart, registry persistence");

    await ctx.db.prepare("DROP TRIGGER trg_articles_event_insert").run();
    await ctx.db.prepare("DROP TRIGGER trg_articles_event_update").run();
    await ctx.db.prepare("DROP TABLE news_events").run();
    await get("/api/v1/events/" + first.eventId, 503);
    assert.equal((await search()).items.length, 2);
    console.log("PASS unavailable registry returns 503; article search remains available");
} finally {
    if (mf) await mf.dispose();
    delete globalThis.__env__;
    await rm(dir, { recursive: true, force: true });
}
