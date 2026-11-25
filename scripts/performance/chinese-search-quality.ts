import { createDatabase } from "db0";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import sqliteConnector from "db0/connectors/better-sqlite3";

import { CHINESE_SEARCH_CASES } from "./chinese-search-cases";
import { ArticleIndex } from "../../server/database/article-index";

import type { SourceID } from "../../shared/types";
import type { NewsEventCorpus } from "./news-event-evaluation";

const corpus = JSON.parse(
    await readFile(new URL("../../test/fixtures/news-event-real-corpus.json", import.meta.url), "utf8")
) as NewsEventCorpus;
const db = createDatabase(sqliteConnector({ name: ":memory:" }));
try {
    const index = new ArticleIndex(db);
    await index.init();
    for (const report of corpus.reports) {
        await index.upsertSourceItems(report.source as SourceID, [
            { id: report.id, title: report.title, url: report.url, pubDate: Date.parse(report.reportedAt) },
        ]);
    }
    const result = [];
    for (const { query, relevant } of CHINESE_SEARCH_CASES) {
        const expected = new Set<string>(relevant);
        const response = await index.search({ query, limit: 10 });
        if (response.status !== "ok") throw new Error("Search unavailable: " + query);
        const returned = response.items.map((item) => String(item.item.id));
        const found = returned.filter((id) => expected.has(id));
        result.push({
            query,
            expected: relevant,
            returned,
            mode: response.mode,
            tp: found.length,
            fp: returned.length - found.length,
            fn: expected.size - found.length,
        });
    }
    const durations: number[] = [];
    for (let repeat = 0; repeat < 20; repeat++) {
        for (const { query } of CHINESE_SEARCH_CASES) {
            const start = performance.now();
            await index.search({ query, limit: 10 });
            durations.push(performance.now() - start);
        }
    }
    const counts = result.reduce((sum, row) => ({ tp: sum.tp + row.tp, fp: sum.fp + row.fp, fn: sum.fn + row.fn }), {
        tp: 0,
        fp: 0,
        fn: 0,
    });
    durations.sort((a, b) => a - b);
    console.log(
        JSON.stringify(
            {
                labelStatus: "proposed-title-literal",
                reports: corpus.reports.length,
                queries: result.length,
                ...counts,
                precision: counts.tp / (counts.tp + counts.fp),
                recall: counts.tp / (counts.tp + counts.fn),
                queryCount: durations.length,
                p95Ms: durations[Math.ceil(durations.length * 0.95) - 1],
                result,
            },
            null,
            2
        )
    );
} finally {
    await db.dispose();
}
