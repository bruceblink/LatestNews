import { createDatabase } from "db0";
import sqliteConnector from "db0/connectors/better-sqlite3";

import { ArticleIndex } from "../../server/database/article-index";
import { measureRanking, reciprocalRankFusion, CharacterTitleRetriever } from "./hybrid-retrieval";

import type { SourceID } from "../../shared/types";
import type { ReviewQuery, ReviewPacket } from "./quality-review";

const depth = 5;
const candidates = 20;
type Method = "lexical" | "character" | "hybrid";
const methods: Method[] = ["lexical", "character", "hybrid"];
function queryLanguage(query: string) {
    const han = /\p{Script=Han}/u.test(query);
    const latin = /\p{Script=Latin}/u.test(query);
    return han && latin ? "mixed" : han ? "zh" : latin ? "latin" : "other";
}

export async function scoreReviewedRetrieval(
    packet: ReviewPacket,
    queries: Array<ReviewQuery & { relevant: string[] }>
) {
    if (!queries.length) return { depth, candidates, queries: 0, metrics: null, metricsByLanguage: {}, rows: [] };
    const db = createDatabase(sqliteConnector({ name: ":memory:" }));
    try {
        const index = new ArticleIndex(db);
        await index.init();
        const docs = packet.reports;
        const character = new CharacterTitleRetriever(docs);
        for (const report of docs) {
            await index.upsertSourceItems(report.source as SourceID, [
                { id: report.id, title: report.title, url: report.url, pubDate: Date.parse(report.reportedAt) },
            ]);
        }
        const rows: Array<
            ReviewQuery & {
                relevant: string[];
                language: ReturnType<typeof queryLanguage>;
                ranks: Record<string, string[]>;
                lexical: ReturnType<typeof measureRanking>;
                character: ReturnType<typeof measureRanking>;
                hybrid: ReturnType<typeof measureRanking>;
            }
        > = [];
        for (const query of queries) {
            const search = await index.search({ query: query.query, limit: candidates });
            if (search.status !== "ok") throw new Error("Review retrieval index unavailable.");
            const lex = search.items.map((item) => String(item.item.id));
            const chars = character.search(query.query, candidates).map((item) => item.id);
            const ranks = {
                lexical: lex,
                character: chars,
                hybrid: reciprocalRankFusion([lex, chars], depth).map((item) => item.id),
            };
            rows.push({
                id: query.id,
                query: query.query,
                relevant: query.relevant,
                language: queryLanguage(query.query),
                ranks: Object.fromEntries(methods.map((m) => [m, ranks[m].slice(0, depth)])),
                lexical: measureRanking(lex, query.relevant, depth),
                character: measureRanking(chars, query.relevant, depth),
                hybrid: measureRanking(ranks.hybrid, query.relevant, depth),
            });
        }
        const aggregate = (subset: typeof rows) =>
            Object.fromEntries(
                methods.map((method) => {
                    const scores = subset.map((row) => row[method]);
                    const tp = scores.reduce((n, r) => n + r.hits, 0);
                    const fp = scores.reduce((n, r) => n + r.returned - r.hits, 0);
                    const fn = scores.reduce((n, r) => n + r.relevant - r.hits, 0);
                    const positive = scores.filter((r) => r.relevant > 0);
                    return [
                        method,
                        {
                            tp,
                            fp,
                            fn,
                            precision: tp + fp ? tp / (tp + fp) : null,
                            recall: tp + fn ? tp / (tp + fn) : null,
                            ndcgAt5: positive.length
                                ? positive.reduce((n, r) => n + (r.ndcg ?? 0), 0) / positive.length
                                : null,
                            mrrAt5: positive.length
                                ? positive.reduce((n, r) => n + (r.mrr ?? 0), 0) / positive.length
                                : null,
                            noAnswerQueries: scores.length - positive.length,
                            falsePositiveNoAnswer: scores.filter((r) => r.falsePositiveNoAnswer).length,
                        },
                    ];
                })
            );
        return {
            depth,
            candidates,
            queries: rows.length,
            metrics: aggregate(rows),
            metricsByLanguage: Object.fromEntries(
                [...new Set(rows.map((row) => row.language))].map((language) => [
                    language,
                    aggregate(rows.filter((row) => row.language === language)),
                ])
            ),
            rows,
        };
    } finally {
        await db.dispose();
    }
}
