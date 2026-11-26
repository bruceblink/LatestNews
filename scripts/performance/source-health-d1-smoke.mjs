import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { rm, mkdtemp } from "node:fs/promises";

const root = fileURLToPath(new URL("../..", import.meta.url));
const miniflareDir = process.env.LATESTNEWS_MINIFLARE_DIR;
if (!miniflareDir) throw new Error("Set LATESTNEWS_MINIFLARE_DIR.");
const { Miniflare } = createRequire(join(resolve(miniflareDir), "package.json"))("miniflare");
const dir = await mkdtemp(join(tmpdir(), "latestnews-n3g2-d1-"));
let mf, db, calls = 0, failCollection = false;
let outboundGate;
const compatibilityDate = process.env.LATESTNEWS_D1_TEST_COMPAT_DATE || "2026-08-06";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function open() {
    mf = new Miniflare({
        modules: true,
        scriptPath: join(root, "dist/_worker.js/index.js"),
        compatibilityDate,
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: { LATESTNEWS_DB: "n3g2-isolated" },
        d1Persist: dir,
        bindings: { ENABLE_CACHE: "true", INIT_TABLE: "true" },
        outboundService: async request => {
            const url = new URL(request.url);
            assert.equal(url.hostname, "hn.algolia.com", "no actual upstream network");
            calls++;
            await pause(150);
            if (outboundGate) await outboundGate;
            return Response.json({ hits: failCollection ? [] : [{ objectID: String(100 + calls), title: "HN fixture", points: 1 }] });
        },
    });
    db = await mf.getD1Database("LATESTNEWS_DB");
}
async function get(path, status = 200) {
    const r = await mf.dispatchFetch("http://localhost" + path);
    const body = await r.json();
    assert.equal(r.status, status, JSON.stringify(body));
    return body;
}
const refresh = () => get("/api/v1/sources/hackernews/items?latest=true&clearCache=true");
async function rows() {
    try {
        return (await db.prepare("SELECT source_id,status,error_message FROM source_health_events WHERE source_id='hackernews' ORDER BY occurred_at,id").all()).results;
    } catch { return []; }
}
async function until(predicate) {
    for (let i = 0; i < 80; i++) {
        if (await predicate()) return;
        await pause(50);
    }
    assert.fail("background health work did not settle");
}
async function health() {
    const body = await get("/api/v1/health/sources");
    assert.equal(body.meta.sampleScope, "instance");
    return body.data.find(source => source.id === "hackernews");
}
try {
    await open();
    assert.equal((await health()).status, "idle");
    const both = await Promise.all([refresh(), refresh()]);
    assert.ok(both.every(x => x.data.items.length === 1));
    assert.equal(calls, 2, "each Pages request owns its I/O");
    await until(async () => (await rows()).length === 2);
    assert.equal((await health()).successCount, 2);
    assert.deepEqual((await rows()).map(x => x.status), ["healthy", "healthy"]);
    console.log("PASS concurrent Pages requests own independent collections and persist one sample each");
    failCollection = true;
    const fallback = await refresh();
    assert.equal(fallback.data.items.length, 1);
    await until(async () => (await rows()).length === 3);
    assert.equal((await rows())[2].status, "failing");
    assert.equal((await rows())[2].error_message, "Source collection failed.");
    assert.equal((await health()).errorCount, 1);
    console.log("PASS actual failed collection records safe failure while cache remains readable");
    await mf.dispose(); await open();
    assert.equal((await rows()).length, 3);
    assert.equal((await health()).status, "idle");
    assert.equal((await health()).successCount, 0);
    console.log("PASS durable recent rows survive restart; public counters explicitly remain instance-local");
    failCollection = false;
    // A stale read must return while its collection is still blocked.
    let release;
    outboundGate = new Promise(resolve => { release = resolve; });
    await db.prepare("UPDATE cache SET updated=1 WHERE id='hackernews'").run();
    try {
        const stale = await get("/api/v1/sources/hackernews/items");
        assert.equal(stale.data.status, "stale-cache");
        assert.equal((await rows()).length, 3);
    } finally {
        release();
        outboundGate = undefined;
    }
    await until(async () => (await rows()).length === 4);
    assert.equal((await health()).successCount, 1);
    console.log("PASS stale response finishes before collection; waitUntil retains the later health write");
    await db.prepare("CREATE TRIGGER fail_health_insert BEFORE INSERT ON source_health_events BEGIN SELECT RAISE(ABORT,'private fixture error'); END").run();
    const next = await refresh();
    assert.equal(next.data.items.length, 1);
    assert.equal((await health()).successCount, 2);
    await pause(250);
    assert.equal((await rows()).length, 4);
    await db.prepare("DROP TRIGGER fail_health_insert").run();
    await refresh();
    await until(async () => (await rows()).length === 5);
    console.log("PASS health persistence failure cannot fail collection; later request persists normally");
    const initialCalls = calls;
    outboundGate = new Promise(resolve => { release = resolve; });
    const pending = Promise.all([refresh(), refresh()]);
    try {
        await until(async () => calls === initialCalls + 2);
        const saturated = await refresh();
        assert.equal(saturated.data.items.length, 1);
        assert.equal(saturated.data.status, "stale-cache");
        assert.equal(calls, initialCalls + 2);
        await until(async () => (await rows()).length === 6);
        assert.equal((await rows())[5].error_message, "Source collection queue is full.");
    } finally {
        release();
        outboundGate = undefined;
    }
    assert.ok((await pending).every(x => x.data.items.length === 1));
    await until(async () => (await rows()).length === 8);
    console.log("PASS cross-request origin saturation uses bounded cache fallback without borrowing I/O");
    console.log(JSON.stringify({result:"passed",checks:6,compatibilityDate,productionD1:false}));
} finally {
    if (mf) await mf.dispose();
    await rm(dir, { recursive: true, force: true });
}
