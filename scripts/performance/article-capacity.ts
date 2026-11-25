import os from "node:os";
import { join } from "node:path";
import { createDatabase } from "db0";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { rm, stat, mkdtemp } from "node:fs/promises";
import sqliteConnector from "db0/connectors/better-sqlite3";

import { ArticleIndex } from "../../server/database/article-index";
import { ftsIsInconsistent } from "../../server/database/article-recovery";
import { executeArticleBatch } from "../../server/database/article-atomic-batch";

import type { SourceID } from "../../shared/types";

const sizes = [1000, 10000, 100000];
const source = "benchmark" as SourceID;
const baseTime = Date.parse("2026-11-23T00:00:00Z");
const samples = 30;
const repairBudgetMs = 12000;

function summarize(values: number[]) {
    const sorted = [...values].sort((a, b) => a - b);
    const quantile = (p: number) => Math.round(sorted[Math.ceil(sorted.length * p) - 1]! * 1000) / 1000;
    return { count: values.length, p50Ms: quantile(0.5), p95Ms: quantile(0.95), p99Ms: quantile(0.99) };
}

async function timed(action: () => Promise<void>, count: number) {
    const values: number[] = [];
    for (let i = 0; i < count; i++) {
        const start = performance.now();
        await action();
        values.push(performance.now() - start);
    }
    return summarize(values);
}

async function run(size: number) {
    const cwd = await mkdtemp(join(os.tmpdir(), "latestnews-capacity-"));
    const db = createDatabase(sqliteConnector({ cwd, name: "capacity" }));
    try {
        const index = new ArticleIndex(db);
        await index.init();
        const eventId = "event-benchmark";
        const start = performance.now();
        // Bulk fixture load intentionally bypasses ingestion to measure capacity separately.
        for (let offset = 0; offset < size; offset += 500) {
            const statements = [];
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
                            n % 100 === 0 ? eventId : null,
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
        const fixtureLoadMs = performance.now() - start;
        if (await ftsIsInconsistent(db)) throw new Error("Fixture inconsistency");
        const scenarios: Record<string, ReturnType<typeof summarize>> = {};
        for (const [name, query, mode] of [
            ["english", "GPT1", "fts"],
            ["chinese", "模型更新", "like"],
            ["mixed", "GPT1 模型", "like"],
            ["noAnswer", "unmatchedzxc", "like"],
        ] as const) {
            const action = async () => {
                const result = await index.search({ query, limit: 20 });
                if (
                    result.status !== "ok" ||
                    result.mode !== mode ||
                    result.items.length !== (name === "noAnswer" ? 0 : 20) ||
                    new Set(result.items.map((x) => x.articleKey)).size !== result.items.length
                ) {
                    throw new Error("Unexpected result for " + name + ": " + result.mode + "/" + result.items.length);
                }
                if (
                    name !== "noAnswer" &&
                    result.items.some((x) => !x.title.includes(name === "chinese" ? "模型更新" : "GPT1"))
                )
                    throw new Error("Unexpected article");
            };
            await action();
            scenarios[name] = await timed(action, samples);
        }
        let cursor: string | undefined;
        const seen = new Set<string>();
        const pageTimes: number[] = [];
        do {
            const pageStart = performance.now();
            const page = await index.getEvent(eventId, { limit: 30, after: cursor });
            pageTimes.push(performance.now() - pageStart);
            if (page.status !== "ok") throw new Error("Event page failed");
            for (const item of page.items) {
                if (seen.has(item.articleKey) || item.eventId !== eventId)
                    throw new Error("Duplicate or wrong event member");
                seen.add(item.articleKey);
            }
            cursor = page.nextCursor;
        } while (cursor);
        if (seen.size !== size / 100) throw new Error("Missing event members");
        scenarios.eventPagination = summarize(pageTimes);
        let writeId = 0;
        scenarios.concurrentWrites = await timed(async () => {
            const n = writeId++;
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
            if (
                results.reduce((sum, x) => sum + x.inserted, 0) !== 1 ||
                results.reduce((sum, x) => sum + x.updated, 0) !== 1
            )
                throw new Error("Concurrent identity mismatch");
        }, 10);
        if (await ftsIsInconsistent(db)) throw new Error("Post-write inconsistency");
        const repairStart = performance.now();
        let repair = await index.rebuildSearchIndex();
        let indexed = repair.indexed;
        while (repair.status === "pending" && performance.now() - repairStart < repairBudgetMs) {
            repair = await index.continueRepair(1);
            indexed += repair.indexed;
        }
        if (repair.status === "unavailable") throw new Error("Repair unavailable");
        const repairMs = performance.now() - repairStart;
        if (repair.status === "ok" && (await ftsIsInconsistent(db))) throw new Error("Post-repair inconsistency");
        const pages = (await db.prepare("PRAGMA page_count").get()) as { page_count: number };
        const pageSize = (await db.prepare("PRAGMA page_size").get()) as { page_size: number };
        const result = {
            size,
            fixtureLoadMs,
            scenarios,
            repair: { status: repair.status, indexed, elapsedMs: repairMs, budgetMs: repairBudgetMs },
            databaseBytes: pages.page_count * pageSize.page_size,
            fileBytes: (await stat(join(cwd, ".data", "capacity.sqlite3"))).size,
            rssBytes: process.memoryUsage().rss,
        };
        return result;
    } finally {
        await db.dispose();
        await rm(cwd, { recursive: true, force: true });
    }
}

console.log(
    JSON.stringify({
        runtime: {
            node: process.version,
            platform: process.platform,
            arch: process.arch,
            cpu: os.cpus()[0]?.model,
            cores: os.cpus().length,
            memoryBytes: os.totalmem(),
        },
        samples,
        seed: "deterministic-index-number",
        fixtureLoad: "bulk SQLite fixture, not real collection",
        repairBudgetMs,
    })
);
for (const size of sizes) console.log(JSON.stringify(await run(size)));
