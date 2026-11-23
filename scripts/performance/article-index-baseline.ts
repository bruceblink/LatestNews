import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "db0";
import { performance } from "node:perf_hooks";
import { rm, mkdtemp, readFile } from "node:fs/promises";
import sqliteConnector from "db0/connectors/better-sqlite3";

import { ArticleIndex } from "../../server/database/article-index";

import type { SourceID } from "../../shared/types";

const ARTICLE_COUNT = 1_000;
const QUERY_COUNT = 200;

const directory = await mkdtemp(join(tmpdir(), "latestnews-article-index-"));
const databasePath = join(directory, ".data", "articles.sqlite3");
const database = createDatabase(sqliteConnector({ cwd: directory, name: "articles" }));

try {
    const index = new ArticleIndex(database);
    await index.init();
    await index.upsertSourceItems(
        "benchmark" as SourceID,
        Array.from({ length: ARTICLE_COUNT }, (_, number) => ({
            id: `benchmark-${number}`,
            title: `OpenAI GPT-${number % 10} 模型更新与工程实践 ${number}`,
            url: `https://benchmark.example.test/articles/${number}`,
            pubDate: Date.parse("2026-11-23T00:00:00.000Z") - number * 60_000,
        }))
    );

    const durations: number[] = [];
    for (let number = 0; number < QUERY_COUNT; number += 1) {
        const startedAt = performance.now();
        const result = await index.search({ query: `GPT-${number % 10}`, limit: 20 });
        durations.push(performance.now() - startedAt);
        if (result.status !== "ok" || result.items.length === 0) {
            throw new Error(`Article index benchmark query ${number} returned no result.`);
        }
    }

    const [pageCount, pageSize] = await Promise.all([
        database.prepare("PRAGMA page_count").get(),
        database.prepare("PRAGMA page_size").get(),
    ]);
    const file = await readFile(databasePath);
    console.log(
        JSON.stringify(
            {
                articleCount: ARTICLE_COUNT,
                queryCount: QUERY_COUNT,
                indexSizeBytes: file.byteLength,
                pageCount: readPragmaNumber(pageCount, "page_count"),
                pageSize: readPragmaNumber(pageSize, "page_size"),
                p50Ms: quantile(durations, 0.5),
                p95Ms: quantile(durations, 0.95),
                p99Ms: quantile(durations, 0.99),
            },
            null,
            2
        )
    );
} finally {
    await database.dispose();
    await rm(directory, { recursive: true, force: true });
}

function quantile(values: number[], probability: number) {
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * probability) - 1);
    return Math.round((sorted[index] ?? 0) * 1000) / 1000;
}

function readPragmaNumber(value: unknown, key: string) {
    if (!value || typeof value !== "object" || !(key in value)) throw new Error(`Missing SQLite pragma ${key}.`);
    const number = Number((value as Record<string, unknown>)[key]);
    if (!Number.isFinite(number)) throw new Error(`Invalid SQLite pragma ${key}.`);
    return number;
}
