import { tmpdir } from "node:os";
import process from "node:process";
import { createDatabase } from "db0";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import d1Connector from "db0/connectors/cloudflare-d1";
import { rm, mkdtemp, readFile } from "node:fs/promises";

import { Cache } from "../../server/database/cache-store.ts";
import { ArticleIndex } from "../../server/database/article-index.ts";
import { assignReviewedEvent } from "../../server/database/article-event-governance.ts";
import { reconcileArticleEventId } from "../../server/database/article-event-identity.ts";
import { approveArticleEventAlias } from "../../server/database/article-event-aliases.ts";
import { repairFtsPage, beginFtsRepair, ftsIsInconsistent } from "../../server/database/article-recovery.ts";

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
    const unapproved=(await request(["hackernews"]))[0];
    assert.equal(unapproved.identityStatus,"candidate");
    assert.equal((await ctx.db.prepare("SELECT event_id FROM articles WHERE canonical_url=?").get(original.url)).event_id,null);
    const reviewed=await assignReviewedEvent(ctx.db,{urls:[original.url],actor:"isolated-test",evidence:"fixture"});
    const first=(await request(["hackernews"]))[0];
    assert.equal(first.eventId,reviewed.eventId);
    assert.equal(first.identityStatus,"registered");
    const migrated = await event("event-legacy");
    assert.equal(migrated.data.items[0].eventId, "event-legacy");
    console.log("PASS legacy event registry migration via built Pages worker");

    await seed(ctx, "weibo", [earlier]);
    const partialGroup=(await request(["hackernews","weibo"]))[0];
    assert.equal(partialGroup.identityStatus,"partial");
    assert.equal((await ctx.db.prepare("SELECT event_id FROM articles WHERE canonical_url=?").get(earlier.url)).event_id,null);
    await assignReviewedEvent(ctx.db,{urls:[earlier.url],eventId:reviewed.eventId,actor:"isolated-test",evidence:"fixture"});
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
    console.log("PASS built Pages read-only insights, explicit reviewed assignment, backfill and partial/hidden consistency");

    // Recreate the shipped pre-L1 schema with an original article key and source mapping.
    await ctx.db.prepare("DELETE FROM article_schema_migrations").run();
    await ctx.db.prepare("DROP TABLE article_sources").run();
    await ctx.db.prepare("CREATE TABLE article_sources (article_key TEXT NOT NULL, source_id TEXT NOT NULL, raw_item_id TEXT NOT NULL, first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, PRIMARY KEY(article_key,source_id), UNIQUE(source_id,raw_item_id))").run();
    const legacyIdentity = { ...makeItem("reused", Math.floor(now / 1000), "Identity boundary fixture"), url: "https://example.test/Aa" };
    await ctx.db.prepare("INSERT INTO articles VALUES (?,?,?,?,?,?,?,?,?)").run("article-l2jxre", legacyIdentity.url, legacyIdentity.title, legacyIdentity.pubDate, "old", "event-old-identity", JSON.stringify(legacyIdentity), now, now);
    await ctx.db.prepare("INSERT INTO article_sources VALUES (?,?,?,?,?)").run("article-l2jxre","weibo","reused",now,now);
    await ctx.index.init();
    assert.deepEqual(await ctx.db.prepare("SELECT article_key,published_at,event_id,payload FROM articles WHERE canonical_url=?").get(legacyIdentity.url), {
        article_key:"article-l2jxre", published_at:legacyIdentity.pubDate*1000,event_id:"event-old-identity",payload:JSON.stringify(legacyIdentity)
    });
    const other = { ...legacyIdentity, url: "https://example.test/BB", pubDate: now };
    await ctx.index.upsertSourceItems("weibo",[other]);
    assert.equal(Number((await ctx.db.prepare("SELECT count(*) AS n FROM article_sources WHERE source_id='weibo' AND raw_item_id='reused'").get()).n),2);
    assert.equal((await event("event-old-identity")).data.items[0].articleKey,"article-l2jxre");
    console.log("PASS D1 legacy identity migration, old key/event preservation and raw-ID reuse");

    const concurrent = makeItem("atomic-same",now,"Atomic write fixture");
    const writes=await Promise.all([ctx.index.upsertSourceItems("weibo",[concurrent]),ctx.index.upsertSourceItems("v2ex",[{...concurrent,id:"atomic-other"}])]);
    assert.equal(writes.reduce((sum,row)=>sum+row.inserted,0),1);
    assert.equal(writes.reduce((sum,row)=>sum+row.updated,0),1);
    const actual=(await get("/api/v1/articles/search?q=" + encodeURIComponent("Atomic write fixture"))).data.items;
    assert.equal(actual.length,1);
    assert.deepEqual(actual[0].sourceIds,["v2ex","weibo"]);
    await ctx.db.prepare("CREATE TRIGGER n4l1_fail BEFORE INSERT ON article_sources WHEN NEW.source_id='ithome' BEGIN SELECT RAISE(ABORT,'fixture failure'); END").run();
    await assert.rejects(ctx.index.upsertSourceItems("ithome",[{...concurrent,title:"Failed atomic edit"}]));
    await assert.rejects(ctx.index.upsertSourceItems("ithome",[makeItem("atomic-fail",now,"Failed atomic insert")]));
    assert.equal((await ctx.db.prepare("SELECT title FROM articles WHERE canonical_url=?").get(concurrent.url)).title,concurrent.title);
    assert.equal(await ctx.db.prepare("SELECT article_key FROM articles WHERE canonical_url=?").get("https://example.test/atomic-fail"),null);
    await ctx.db.prepare("DROP TRIGGER n4l1_fail").run();
    console.log("PASS D1 atomic concurrent upsert, FTS uniqueness and rollback on mapping failure");

    const dateItems = [
        makeItem("timestamp-sec",Math.floor(now/1000),"Timestamp filter fixture"),
        makeItem("timestamp-ms",now,"Timestamp filter fixture"),
        makeItem("timestamp-iso",new Date(now).toISOString(),"Timestamp filter fixture"),
        makeItem("timestamp-unknown","unknown","Timestamp filter fixture"),
        makeItem("timestamp-old",now-86400000,"Timestamp filter fixture"),
    ];
    await ctx.index.upsertSourceItems("v2ex",dateItems);
    const filtered=(await get("/api/v1/articles/search?q="+encodeURIComponent("Timestamp filter fixture")+"&since="+(now-3600000))).data.items;
    assert.deepEqual(filtered.map(row=>row.item.id).sort(),["timestamp-iso","timestamp-ms","timestamp-sec"]);
    assert.ok(filtered.every(row=>typeof row.publishedAt==="number"));
    console.log("PASS D1 timestamp normalization and explicit since filter");



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
    await ctx.index.upsertSourceItems("v2ex", [
        makeItem("han-exact", now, "AI 频道"),
        makeItem("han-substring", now, "AI 个性化电视频道"),
        makeItem("han-percent", now, "100%_量化模型"),
        makeItem("han-noise", now, "1000量化模型"),
    ]);
    const han = (await get("/api/v1/articles/search?source=v2ex&q=" + encodeURIComponent("AI 频道"))).data;
    assert.equal(han.searchMode, "like");
    assert.deepEqual(han.items.map((item) => item.item.id), ["han-exact", "han-substring"]);
    const symbols = (await get("/api/v1/articles/search?q=" + encodeURIComponent("%_"))).data;
    assert.deepEqual(symbols.items.map((item) => item.item.id), ["han-percent"]);
    await get("/api/v1/articles/search?q=" + "x".repeat(257), 400);
    console.log("PASS D1 Han substring, mixed terms, literal symbols, filters and query limit");
    const validLink = { ...makeItem("url-valid", now, "Boundary URL fixture"), mobileUrl: "file:///legacy-mobile" };
    const invalidLink = { ...makeItem("url-invalid", now, "Boundary URL fixture"), url: "file:///legacy-article" };
    const legacyCache = JSON.stringify([validLink, invalidLink]);
    await ctx.db.prepare("INSERT INTO cache (id, updated, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET updated=excluded.updated,data=excluded.data").run("v2ex", now, legacyCache);
    assert.equal((await ctx.index.upsertSourceItems("v2ex", [validLink, invalidLink])).inserted, 1);
    await ctx.db.prepare("INSERT INTO articles(article_key, canonical_url, title, published_at, content_fingerprint, event_id, payload, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
        "legacy-url-invalid", invalidLink.url, invalidLink.title, now, "legacy-url-invalid", "event-legacy-url-invalid", JSON.stringify(invalidLink), now, now
    );
    await ctx.index.rebuildSearchIndex();
    const safeSource = (await get("/api/v1/sources/v2ex/items")).data;
    assert.deepEqual(safeSource.items.map((item) => item.id), ["url-valid"]);
    assert.equal(safeSource.items[0].mobileUrl, undefined);
    const safeSearch = (await get("/api/v1/articles/search?q=" + encodeURIComponent("Boundary URL fixture"))).data;
    assert.deepEqual(safeSearch.items.map((item) => item.item.id), ["url-valid"]);
    assert.equal(safeSearch.items[0].item.mobileUrl, undefined);
    assert.deepEqual((await event("event-legacy-url-invalid")).data.items, []);
    assert.equal((await ctx.db.prepare("SELECT data FROM cache WHERE id = ?").get("v2ex")).data, legacyCache);
    assert.equal((await ctx.db.prepare("SELECT payload FROM articles WHERE article_key = ?").get("legacy-url-invalid")).payload, JSON.stringify(invalidLink));
    console.log("PASS D1 URL input, cached read, indexed read and legacy preservation");



    const recovery = new Cache(ctx.db);
    await recovery.check();
    const replay = makeItem("replay-durable", now, "Durable snapshot fixture");
    await ctx.db.prepare("CREATE TRIGGER n4l2_fail BEFORE INSERT ON article_sources WHEN NEW.source_id='v2ex' BEGIN SELECT RAISE(ABORT,'fixture failure'); END").run();
    await recovery.set("v2ex", [replay]);
    assert.equal((await recovery.get("v2ex")).items[0].id, replay.id);
    assert.ok((await recovery.getArticleIndexHealth()).pendingIngest >= 1);
    const degraded = (await get("/api/v1/health/deployment")).data.checks;
    assert.equal(degraded.cache.status, "ok");
    assert.equal(degraded.articleIndex.status, "degraded");
    await mf.dispose(); mf=undefined; ctx=await start();
    await ctx.db.prepare("DROP TRIGGER n4l2_fail").run();
    const resumed = new Cache(ctx.db);
    await resumed.check();
    for(let i=0;i<4;i++)await resumed.maintainArticleIndex(10);
    assert.equal((await resumed.getArticleIndexHealth()).pendingIngest,0);
    assert.equal((await get("/api/v1/articles/search?q="+encodeURIComponent("Durable snapshot fixture"))).data.items[0].item.id,replay.id);
    console.log("PASS D1 durable cache journal, degraded health, workerd restart and replay");

    const repairRows=await ctx.db.prepare("SELECT article_key,title,canonical_url FROM articles ORDER BY article_key LIMIT 2").all();
    await ctx.db.prepare("DELETE FROM article_search WHERE article_key=?").run(repairRows[1].article_key);
    await ctx.db.prepare("INSERT INTO article_search VALUES(?,?,?)").run(repairRows[0].article_key,repairRows[0].title,repairRows[0].canonical_url);
    assert.equal(await ftsIsInconsistent(ctx.db),true);
    await beginFtsRepair(ctx.db);
    const clearPage=await repairFtsPage(ctx.db);
    assert.equal(clearPage.indexed,0);
    assert.equal((await ctx.db.prepare("SELECT phase FROM article_fts_repair WHERE id=1").get()).phase,"repairing");
    assert.equal((await search()).searchMode,"like");
    await Promise.all([ctx.index.continueRepair(1),ctx.index.upsertSourceItems("weibo",[makeItem("repair-overlap",now,"Repair overlap fixture")])]);
    for(let i=0;i<20;i++){if((await ctx.index.continueRepair(2)).status==="ok")break;}
    assert.equal(await ftsIsInconsistent(ctx.db),false);
    assert.equal((await search()).searchMode,"fts");
    console.log("PASS D1 same-count corruption detection, bounded repair and concurrent upsert");
    // A deployment interrupted in the old key-by-key format must not skip
    // previously indexed or newly ingested articles after upgrading.
    const beforeRepairCount=Number((await ctx.db.prepare("SELECT count(*) AS n FROM articles").get()).n);
    await ctx.db.prepare("UPDATE article_fts_repair SET phase='repairing',cursor='legacy-key',generation='legacy-generation'").run();
    await repairFtsPage(ctx.db);
    assert.equal((await ctx.db.prepare("SELECT cursor FROM article_fts_repair").get()).cursor,"clear");
    await repairFtsPage(ctx.db);
    assert.equal((await search()).searchMode,"like");
    await ctx.index.upsertSourceItems("weibo",[makeItem("repair-restart",now,"Repair restart fixture")]);
    assert.equal(Number((await ctx.db.prepare("SELECT count(*) AS n FROM article_fts_pending").get()).n),1);
    await mf.dispose(); mf=undefined; ctx=await start();
    for(let i=0;i<20;i++){if((await ctx.index.continueRepair(2)).status==="ok")break;}
    assert.equal(await ftsIsInconsistent(ctx.db),false);
    assert.equal(Number((await ctx.db.prepare("SELECT count(*) AS n FROM articles").get()).n),beforeRepairCount+1);
    assert.equal((await get("/api/v1/articles/search?q="+encodeURIComponent("Repair restart fixture"))).data.items[0].item.id,"repair-restart");
    assert.equal((await search()).searchMode,"fts");
    console.log("PASS D1 legacy repair cursor, workerd restart, pending ingestion and verified publication");

    const reviewedItems=["reviewed-one","reviewed-two","reviewed-three"].map(id=>makeItem(id,now,"Reviewed governance fixture"));
    await ctx.index.upsertSourceItems("weibo",reviewedItems);
    const approvals=await Promise.allSettled([
        assignReviewedEvent(ctx.db,{urls:reviewedItems.slice(0,2).map(item=>item.url),actor:"fixture",evidence:"fixture"}),
        assignReviewedEvent(ctx.db,{urls:reviewedItems.slice(1).map(item=>item.url),actor:"fixture",evidence:"fixture"})
    ]);
    assert.equal(approvals.filter(x=>x.status==="fulfilled").length,1);
    const winner=approvals.find(x=>x.status==="fulfilled").value;
    assert.equal((await event(winner.eventId)).data.items.length,2);
    assert.equal(Number((await ctx.db.prepare("SELECT count(*) AS n FROM news_event_approvals WHERE actor='fixture'").get()).n),1);
    console.log("PASS D1 audited approval, competing new assignments and history");


    await ctx.db.prepare("DROP TRIGGER trg_articles_event_insert").run();
    await ctx.db.prepare("DROP TRIGGER trg_articles_event_update").run();
    await ctx.db.prepare("DROP TABLE news_events").run();
    // With automatic initialization disabled, missing registry must surface
    // as unavailable rather than being recreated by a new request.
    await mf.dispose(); mf=undefined;
    mf=new Miniflare({...options,bindings:{...options.bindings,INIT_TABLE:"false"}});
    await get("/api/v1/events/" + first.eventId, 503);
    assert.equal((await search()).items.length, 2);
    console.log("PASS unavailable registry returns 503; article search remains available");
} finally {
    if (mf) await mf.dispose();
    delete globalThis.__env__;
    await rm(dir, { recursive: true, force: true });
}
