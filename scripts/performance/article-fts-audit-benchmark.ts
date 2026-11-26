import os from "node:os";
import { join } from "node:path";
import { createDatabase } from "db0";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { rm, mkdtemp } from "node:fs/promises";
import sqliteConnector from "db0/connectors/better-sqlite3";

import { Cache } from "../../server/database/cache-store";
import { ArticleIndex } from "../../server/database/article-index";

interface NativeStatement {
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
}
interface NativeSqlite {
    prepare(sql: string): NativeStatement;
    transaction<T>(fn: () => T): { immediate(): T };
    pragma(sql: string): unknown;
}

const size = Number(process.argv[2] ?? 100000);
const samples = Number(process.argv[3] ?? 100);
assert(Number.isSafeInteger(size) && size >= 1000);
assert(Number.isSafeInteger(samples) && samples >= 20);
const cwd = await mkdtemp(join(os.tmpdir(), "latestnews-n4p1-bench-"));
const db = createDatabase(sqliteConnector({ cwd, name: "audit" }));
const native = (await db.getInstance()) as NativeSqlite;
const prepare = native.prepare.bind(native);
const baseTime = Date.parse("2026-11-23T00:00:00Z");
const query = { query: "uniqueauditneedle", limit: 10 };
const now = Date.now();
let tracing = false;
const statements: string[] = [];
native.prepare = (sql: string) => {
    if (tracing) statements.push(sql);
    return prepare(sql);
};
async function open() {
    const cache = new Cache(db, { deferMaintenance: () => {} });
    await cache.openPages(false);
    return cache;
}
function summarize(times: number[], calls: number[]) {
    const sorted = [...times].sort((a, b) => a - b);
    const percentile = (q: number) => sorted[Math.ceil(q * sorted.length) - 1];
    return {
        samples: times.length,
        p50Ms: percentile(0.5),
        p95Ms: percentile(0.95),
        p99Ms: percentile(0.99),
        minStatements: Math.min(...calls),
        maxStatements: Math.max(...calls),
    };
}
try {
    await new Cache(db).init();
    const insert = prepare("INSERT INTO articles VALUES(?,?,?,?,?,?,?,?,?)");
    const mapping = prepare("INSERT INTO article_sources VALUES(?,?,?,?,?)");
    const fts = prepare("INSERT INTO article_search VALUES(?,?,?)");
    for (let offset = 0; offset < size; offset += 500) {
        native
            .transaction(() => {
                for (let i = offset; i < Math.min(size, offset + 500); i++) {
                    const key = "fixture-" + String(i).padStart(8, "0");
                    const url = "https://example.test/audit-bench/" + i;
                    const title = i === size - 1 ? "uniqueauditneedle fixture" : "ordinary article segment" + (i % 100);
                    const payload = JSON.stringify({ id: String(i), title, url, pubDate: baseTime - i * 1000 });
                    insert.run(key, url, title, baseTime - i * 1000, key, null, payload, now, now);
                    mapping.run(key, "weibo", String(i), now, now);
                    fts.run(key, title, url);
                }
            })
            .immediate();
    }
    const auditStart = performance.now();
    await new ArticleIndex(db).init();
    const fullAuditStartupMs = performance.now() - auditStart;
    const healthCheck = async () => {
        const c = await open();
        const h = await c.getArticleIndexHealth();
        assert.equal(h.status, "ok");
    };
    const searchCheck = async () => {
        const c = await open();
        const found = await c.searchArticles(query);
        assert.equal(found.mode, "fts");
        assert.equal(found.items.length, 1);
        assert.equal(found.items[0].item.id, String(size - 1));
    };
    for (let i = 0; i < 20; i++) {
        await healthCheck();
        await searchCheck();
    }
    const rounds = [];
    const sql = new Set<string>();
    for (let round = 0; round < 3; round++) {
        const h: number[] = [],
            s: number[] = [],
            hc: number[] = [],
            sc: number[] = [];
        for (let i = 0; i < samples; i++) {
            for (const [check, times, calls] of [
                [healthCheck, h, hc],
                [searchCheck, s, sc],
            ] as const) {
                statements.length = 0;
                tracing = true;
                const start = performance.now();
                await check();
                times.push(performance.now() - start);
                tracing = false;
                calls.push(statements.length);
                statements.forEach((x) => sql.add(x));
            }
        }
        rounds.push({ health: summarize(h, hc), search: summarize(s, sc) });
    }
    const fullAuditStatements = [...sql].filter(
        (x) => x.includes("GROUP BY article_key") && x.includes("article_search")
    );
    assert.equal(fullAuditStatements.length, 0);
    const searchSql = [...sql].find((x) => x.includes("article_search MATCH ?") && x.includes("bm25("));
    assert(searchSql);
    const proofGuard = searchSql.includes("article_fts_audit");
    const plan = prepare("EXPLAIN QUERY PLAN " + searchSql).all(
        ...(proofGuard ? ['"uniqueauditneedle"', now - 86400000, Date.now(), 10] : ['"uniqueauditneedle"', 10])
    );
    console.log(
        "RESULT:" +
            JSON.stringify({
                size,
                samples,
                rounds,
                fullAuditStartupMs,
                fullAuditStatements: fullAuditStatements.length,
                uniqueHotStatements: sql.size,
                proofGuard,
                searchPlan: plan,
                sqliteVersion: prepare("SELECT sqlite_version() AS version").all(),
                journalMode: native.pragma("journal_mode"),
                environment: { node: process.version, cpus: os.cpus().length },
                productionD1: false,
            })
    );
} finally {
    tracing = false;
    await db.dispose();
    await rm(cwd, { recursive: true, force: true });
}
