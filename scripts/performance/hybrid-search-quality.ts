import { createDatabase } from "db0";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import sqliteConnector from "db0/connectors/better-sqlite3";

import { ArticleIndex } from "../../server/database/article-index";
import { measureRanking, reciprocalRankFusion, CharacterTitleRetriever } from "./hybrid-retrieval";

import type { SourceID } from "../../shared/types";
import type { NewsEventCorpus } from "./news-event-evaluation";

const DEPTH = 5;
const CANDIDATES = 20;
const REPEATS = 20;
const corpus = JSON.parse(
    await readFile(new URL("../../test/fixtures/news-event-real-corpus.json", import.meta.url), "utf8")
) as NewsEventCorpus;
const fixture = JSON.parse(
    await readFile(new URL("../../test/fixtures/news-hybrid-search-queries.json", import.meta.url), "utf8")
) as {
    labelStatus: string;
    selection: string;
    cases: Array<{ query: string; kind: string; relevant: string[] }>;
};
const ids = new Set(corpus.reports.map((report) => report.id));
if (
    !fixture.cases.length ||
    new Set(fixture.cases.map((item) => item.query)).size !== fixture.cases.length ||
    fixture.cases.some((item) => !item.query.trim() || item.relevant.some((id) => !ids.has(id)))
) {
    throw new Error("Invalid retrieval evaluation fixture.");
}

const db = createDatabase(sqliteConnector({ name: ":memory:" }));
const charIndex = new CharacterTitleRetriever(corpus.reports);
try {
    const index = new ArticleIndex(db);
    await index.init();
    for (const report of corpus.reports) {
        await index.upsertSourceItems(report.source as SourceID, [
            { id: report.id, title: report.title, url: report.url, pubDate: Date.parse(report.reportedAt) },
        ]);
    }

    async function lexical(query: string) {
        const result = await index.search({ query, limit: CANDIDATES });
        if (result.status !== "ok") throw new Error("Lexical search unavailable.");
        return result.items.map((item) => String(item.item.id));
    }
    function character(query: string) {
        return charIndex.search(query, CANDIDATES).map((item) => item.id);
    }
    async function retrieve(query: string) {
        const lex = await lexical(query);
        const chars = character(query);
        return {
            lexical: lex,
            character: chars,
            hybrid: reciprocalRankFusion([lex, chars], DEPTH).map((item) => item.id),
        };
    }

    const rows: Array<
        (typeof fixture.cases)[number] & {
            ranks: Record<string, string[]>;
            lexical: ReturnType<typeof measureRanking>;
            character: ReturnType<typeof measureRanking>;
            hybrid: ReturnType<typeof measureRanking>;
        }
    > = [];
    for (const item of fixture.cases) {
        const ranks = await retrieve(item.query);
        rows.push({
            ...item,
            ranks: Object.fromEntries(Object.entries(ranks).map(([name, ranking]) => [name, ranking.slice(0, DEPTH)])),
            lexical: measureRanking(ranks.lexical, item.relevant, DEPTH),
            character: measureRanking(ranks.character, item.relevant, DEPTH),
            hybrid: measureRanking(ranks.hybrid, item.relevant, DEPTH),
        });
    }

    const durations = { lexical: [] as number[], character: [] as number[], hybrid: [] as number[] };
    for (let repeat = 0; repeat < REPEATS; repeat++) {
        for (const { query } of fixture.cases) {
            let start = performance.now();
            await lexical(query);
            durations.lexical.push(performance.now() - start);
            start = performance.now();
            character(query);
            durations.character.push(performance.now() - start);
            start = performance.now();
            await retrieve(query);
            durations.hybrid.push(performance.now() - start);
        }
    }

    const methods = ["lexical", "character", "hybrid"] as const;
    function aggregate(method: (typeof methods)[number]) {
        const scores = rows.map((row) => row[method]);
        const positive = scores.filter((score) => score.relevant > 0);
        const noAnswer = scores.filter((score) => score.relevant === 0);
        const mean = (key: "recall" | "mrr" | "ndcg") =>
            positive.length ? positive.reduce((sum, score) => sum + (score[key] ?? 0), 0) / positive.length : null;
        const hits = scores.reduce((sum, score) => sum + score.hits, 0);
        const returned = scores.reduce((sum, score) => sum + score.returned, 0);
        const relevant = scores.reduce((sum, score) => sum + score.relevant, 0);
        const sorted = durations[method].sort((a, b) => a - b);
        return {
            hits,
            returned,
            relevant,
            microPrecision: returned ? hits / returned : null,
            microRecall: relevant ? hits / relevant : null,
            macroRecallAt5: mean("recall"),
            mrrAt5: mean("mrr"),
            ndcgAt5: mean("ndcg"),
            noAnswerQueries: noAnswer.length,
            falsePositiveNoAnswer: noAnswer.filter((score) => score.falsePositiveNoAnswer).length,
            p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
            latencySamples: sorted.length,
        };
    }
    console.log(
        JSON.stringify(
            {
                labelStatus: fixture.labelStatus,
                reports: corpus.reports.length,
                queries: fixture.cases.length,
                candidateDepth: CANDIDATES,
                resultDepth: DEPTH,
                characterMinCoverage: 0.5,
                rrfK: 60,
                metrics: Object.fromEntries(methods.map((method) => [method, aggregate(method)])),
                rows,
            },
            null,
            2
        )
    );
} finally {
    await db.dispose();
}
