import { tmpdir } from "node:os";
import { createDatabase } from "db0";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { rm, mkdtemp } from "node:fs/promises";
import d1Connector from "db0/connectors/cloudflare-d1";

import { ArticleIndex } from "../../server/database/article-index";
import { repairFtsPage, beginFtsRepair, ftsIsInconsistent } from "../../server/database/article-recovery";

const miniflareDir = process.env.LATESTNEWS_MINIFLARE_DIR;
if (!miniflareDir) throw new Error("Set LATESTNEWS_MINIFLARE_DIR to an isolated Miniflare installation.");
const { Miniflare } = createRequire(join(resolve(miniflareDir), "package.json"))("miniflare");
const dir = await mkdtemp(join(tmpdir(), "latestnews-recovery-d1-"));
const options = {
    modules: true,
    script: "export default {fetch(){return new Response('isolated fixture')}}",
    compatibilityDate: process.env.LATESTNEWS_D1_TEST_COMPAT_DATE || "2026-08-06",
    d1Databases: { LATESTNEWS_DB: "latestnews-recovery-isolated-fixture" },
    d1Persist: dir,
    outboundService: { external: { address: "127.0.0.1:1" } },
};
let mf;
async function open() {
    mf = new Miniflare(options);
    const binding = await mf.getD1Database("LATESTNEWS_DB");
    globalThis.__env__ = { LATESTNEWS_DB: binding };
    const db = createDatabase(d1Connector({ bindingName: "LATESTNEWS_DB" }));
    const index = new ArticleIndex(db);
    return { db, index };
}
const baseTime = Date.parse("2026-11-23T00:00:00Z");
const makeItem = (n) => ({
    id: String(n), title: "Recovery D1 fixture " + n, url: "https://example.test/d1-recovery/" + n, pubDate: baseTime,
});
try {
    let { db, index } = await open();
    await index.init();
    await index.upsertSourceItems("weibo", Array.from({ length: 220 }, (_, i) => makeItem(i)), baseTime);
    assert.equal(await ftsIsInconsistent(db), false);
    await beginFtsRepair(db);
    await repairFtsPage(db);
    await repairFtsPage(db);
    assert.equal(Number((await db.prepare("SELECT count(*) AS n FROM article_search").get()).n), 0);
    const first = await repairFtsPage(db);
    assert.equal(first.indexed, 50);
    console.log("PASS D1 first rebuild page remains 50");
    const behind = await db.prepare("SELECT payload FROM articles ORDER BY article_key LIMIT 1").get();
    const updated = { ...JSON.parse(behind.payload), title: "Updated D1 behind cursor" };
    await Promise.all([
        index.continueRepair(1), index.continueRepair(1),
        index.upsertSourceItems("v2ex", [updated, makeItem(221)], baseTime + 1),
    ]);
    assert.equal((await index.search({ query: updated.title })).mode, "like");
    const checkpoint = await db.prepare("SELECT cursor,generation FROM article_fts_repair WHERE id=1").get();
    assert.ok(checkpoint.cursor.startsWith("build:"));
    await mf.dispose();
    mf = undefined;
    ({ db, index } = await open());
    await index.probe();
    assert.deepEqual(await db.prepare("SELECT cursor,generation FROM article_fts_repair WHERE id=1").get(), checkpoint);
    let status = await index.continueRepair(1);
    for (let i = 0; status.status === "pending" && i < 20; i++) status = await index.continueRepair(1);
    assert.equal(status.status, "ok");
    assert.equal(await ftsIsInconsistent(db), false);
    assert.equal(Number((await db.prepare("SELECT count(*) AS n FROM articles").get()).n), 221);
    assert.equal(Number((await db.prepare("SELECT count(*) AS n FROM article_search").get()).n), 221);
    assert.equal(Number((await db.prepare("SELECT count(*) AS n FROM article_sources").get()).n), 222);
    const result = await index.search({ query: updated.title });
    assert.equal(result.mode, "fts");
    assert.equal(result.items.length, 1);
    assert.deepEqual(result.items[0].sourceIds, ["v2ex", "weibo"]);
    assert.equal((await index.getRecoveryStatus()).pendingFts, 0);
    console.log("PASS isolated D1 overlapping repair, write journal, workerd restart and verified search");
    console.log(JSON.stringify({ result: "passed", compatibilityDate: options.compatibilityDate, fixtureArticles: 221, firstBuildPage: first.indexed, productionD1: false }));
} finally {
    if (mf) await mf.dispose();
    delete globalThis.__env__;
    await rm(dir, { recursive: true, force: true });
}
