import os from "node:os";
import { join } from "node:path";
import { createDatabase } from "db0";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { rm, mkdtemp } from "node:fs/promises";
import sqliteConnector from "db0/connectors/better-sqlite3";

import { ArticleIndex } from "../../server/database/article-index";
import { ftsIsInconsistent } from "../../server/database/article-recovery";
import { executeArticleBatch, type AtomicStatement } from "../../server/database/article-atomic-batch";

import type { SourceID } from "../../shared/types";
interface NativeStatement {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): unknown;
}
interface NativeSqlite {
    prepare(sql: string): NativeStatement;
    transaction(fn: (...args: unknown[]) => unknown): { immediate(...args: unknown[]): unknown };
    pragma(sql: string): unknown;
}

const source = "benchmark" as SourceID;
const baseTime = Date.parse("2026-11-23T00:00:00Z");
const size = Number(process.argv[2] ?? 100000);
assert(Number.isSafeInteger(size) && size >= 200, "size must be an integer >= 200");
const cwd = await mkdtemp(join(os.tmpdir(), "latestnews-recovery-bench-"));
const db = createDatabase(sqliteConnector({ cwd, name: "capacity" }));
const native = (await db.getInstance()) as NativeSqlite;
const stats: Record<string, { count: number; ms: number; maxMs: number }> = {};
const add = (label: string, ms: number) => {
    const stat = (stats[label] ??= { count: 0, ms: 0, maxMs: 0 });
    stat.count++;
    stat.ms += ms;
    stat.maxMs = Math.max(stat.maxMs, ms);
};
let active = false;
let statementMs = 0;
let maxTransactionMs = 0;
let transactionLabel: string | undefined;
const transactionWall: Record<string, number[]> = {};
function category(sql: string) {
    if (sql.includes("LEFT JOIN") && sql.includes("article_search")) return "audit";
    if (sql.startsWith("DELETE FROM article_search")) return sql.includes("rowid") ? "fts.clear" : "fts.pending.delete";
    if (sql.startsWith("INSERT INTO article_search"))
        return sql.includes("article_fts_pending ORDER BY") ? "fts.pending.insert" : "fts.build";
    if (sql.startsWith("SELECT article_key FROM articles")) return "key.scan";
    if (sql.startsWith("DELETE FROM article_fts_pending")) return "pending.delete";
    if (sql.includes("article_fts_repair")) return "state";
    return "other";
}
const prepare = native.prepare.bind(native);
const transaction = native.transaction.bind(native);
native.prepare = ((sql: string) => {
    if (!active) return prepare(sql);
    const label = category(sql);
    if (transactionLabel !== undefined) {
        if (label === "fts.clear") transactionLabel = "clear";
        if (label === "fts.build") transactionLabel = "build";
        if (label === "fts.pending.delete") transactionLabel = "pending";
        if (label === "audit") transactionLabel = "verify";
    }
    const start = performance.now();
    const stmt = prepare(sql);
    const preparation = performance.now() - start;
    return new Proxy(stmt, {
        get(target, prop) {
            const value = Reflect.get(target, prop, target);
            if (typeof value !== "function") return value;
            if (!["get", "all", "run"].includes(String(prop))) return value.bind(target);
            return (...params: unknown[]) => {
                const now = performance.now();
                try {
                    return value.apply(target, params);
                } finally {
                    const ms = performance.now() - now + preparation;
                    statementMs += ms;
                    add(label, ms);
                }
            };
        },
    });
}) as typeof native.prepare;
native.transaction = ((fn: (...args: unknown[]) => unknown) => {
    const wrapped = transaction(fn);
    if (!active) return wrapped;
    const immediate = wrapped.immediate.bind(wrapped);
    return {
        immediate: (...args: unknown[]) => {
            const start = performance.now();
            const before = statementMs;
            transactionLabel = "other";
            try {
                return immediate(...args);
            } finally {
                const elapsed = performance.now() - start;
                maxTransactionMs = Math.max(maxTransactionMs, elapsed);
                (transactionWall[transactionLabel ?? "other"] ??= []).push(elapsed);
                transactionLabel = undefined;
                add("transaction.overhead", Math.max(0, elapsed - (statementMs - before)));
            }
        },
    };
}) as typeof native.transaction;

try {
    const index = new ArticleIndex(db);
    await index.init();
    const fixtureStart = performance.now();
    for (let offset = 0; offset < size; offset += 500) {
        const statements: AtomicStatement[] = [];
        for (let n = offset; n < Math.min(size, offset + 500); n++) {
            const url = "https://benchmark.example.test/articles/" + n;
            const key = "article-v2-" + createHash("sha256").update(url).digest("hex");
            const title = "OpenAI GPT" + (n % 10) + " 模型更新 工程实践 " + n;
            const pubDate = baseTime - n * 60000;
            const item = { id: String(n), title, url, pubDate };
            statements.push(
                {
                    sql: "INSERT INTO articles VALUES(?,?,?,?,?,?,?,?,?)",
                    params: [
                        key,
                        url,
                        title,
                        pubDate,
                        key,
                        n % 100 === 0 ? "event-benchmark" : null,
                        JSON.stringify(item),
                        baseTime,
                        baseTime,
                    ],
                },
                {
                    sql: "INSERT INTO article_sources VALUES(?,?,?,?,?)",
                    params: [key, source, String(n), baseTime, baseTime],
                },
                { sql: "INSERT INTO article_search VALUES(?,?,?)", params: [key, title, url] }
            );
        }
        await executeArticleBatch(db, statements);
    }
    for (let n = 0; n < 10; n++) {
        const item = {
            id: "new" + n,
            title: "New benchmark " + n,
            url: "https://benchmark.example.test/new/" + n,
            pubDate: baseTime,
        };
        const results = await Promise.all([
            index.upsertSourceItems(source, [item]),
            index.upsertSourceItems("benchmark2" as SourceID, [item]),
        ]);
        assert.equal(
            results.reduce((sum, r) => sum + r.inserted, 0),
            1
        );
        assert.equal(
            results.reduce((sum, r) => sum + r.updated, 0),
            1
        );
    }
    assert.equal(await ftsIsInconsistent(db), false);
    console.log(
        JSON.stringify({
            fixtureMs: performance.now() - fixtureStart,
            size,
            node: process.version,
            cpu: os.cpus()[0]?.model,
            cores: os.cpus().length,
            memory: os.totalmem(),
            sqlite: native.prepare("select sqlite_version() as version").get(),
            journal: native.pragma("journal_mode"),
            synchronous: native.pragma("synchronous"),
        })
    );
    // Query-plan sample: LIMIT 50 and LIMIT 200 have the same keyset predicate.
    for (const sql of [
        "SELECT article_key FROM articles WHERE article_key > ? ORDER BY article_key LIMIT 50",
        "INSERT INTO article_search(article_key,title,canonical_url) SELECT article_key,title,canonical_url FROM articles WHERE article_key IN (SELECT value FROM json_each(?)) AND EXISTS(SELECT 1 FROM article_fts_repair WHERE id=1 AND phase='repairing' AND generation=? AND cursor=?)",
        "DELETE FROM article_search WHERE rowid IN (SELECT rowid FROM article_search ORDER BY rowid LIMIT 200) AND EXISTS(SELECT 1 FROM article_fts_repair WHERE id=1 AND phase='repairing' AND generation=? AND cursor=?)",
    ]) {
        const params = sql.startsWith("SELECT") ? [""] : sql.startsWith("INSERT") ? ["[]", "", ""] : ["", ""];
        console.log(JSON.stringify({ sql, plan: native.prepare("EXPLAIN QUERY PLAN " + sql).all(...params) }));
    }
    active = true;
    const start = performance.now();
    let result = await index.rebuildSearchIndex();
    const initialCallMs = performance.now() - start;
    let indexed = result.indexed;
    let calls = 1;
    const phases: Record<string, { calls: number; ms: number }> = {};
    while (result.status === "pending") {
        if (performance.now() - start > 600000) throw new Error("10-minute watchdog exceeded");
        const state = prepare("SELECT cursor,generation FROM article_fts_repair WHERE id=1").get() as {
            cursor: string;
            generation: string;
        };
        const phase = state.cursor.startsWith("build") ? "build" : state.cursor;
        const t = performance.now();
        result = await index.continueRepair(1);
        const p = (phases[phase] ??= { calls: 0, ms: 0 });
        p.calls++;
        p.ms += performance.now() - t;
        indexed += result.indexed;
        calls++;
        if (calls % 200 === 0)
            console.log(JSON.stringify({ progress: calls, phase, indexed, elapsedMs: performance.now() - start }));
    }
    const repairMs = performance.now() - start;
    active = false;
    const auditStart = performance.now();
    const inconsistent = await ftsIsInconsistent(db);
    const auditMs = performance.now() - auditStart;
    assert.equal(result.status, "ok");
    assert.equal(inconsistent, false);
    assert.equal(indexed, size + 10);
    const count = native.prepare("SELECT COUNT(*) AS n FROM article_search").get() as { n: number };
    assert.equal(count.n, size + 10);
    assert.deepEqual(native.prepare("SELECT COUNT(*) AS n FROM articles").get(), { n: size + 10 });
    assert.deepEqual(native.prepare("SELECT COUNT(*) AS n FROM article_sources").get(), { n: size + 20 });
    const final = await index.getRecoveryStatus();
    assert.equal(final.status, "ok");
    assert.equal(final.pendingFts, 0);
    assert.equal(final.pendingIngest, 0);
    const search = await index.search({ query: "GPT1", limit: 20 });
    assert.equal(search.mode, "fts");
    assert.equal(search.items.length, 20);
    console.log(
        JSON.stringify({
            result: "passed",
            size,
            indexed,
            calls,
            repairMs,
            externalAuditMs: auditMs,
            initialCallMs,
            maxTransactionMs,
            transactionWall: Object.fromEntries(
                Object.entries(transactionWall).map(([label, times]) => {
                    const ordered = [...times].sort((a, b) => a - b);
                    return [
                        label,
                        {
                            count: times.length,
                            p95Ms: ordered[Math.ceil(ordered.length * 0.95) - 1],
                            maxMs: ordered.at(-1),
                        },
                    ];
                })
            ),
            phases,
            stats,
            rss: process.memoryUsage().rss,
            final,
        })
    );
} finally {
    await db.dispose();
    await rm(cwd, { recursive: true, force: true });
}
