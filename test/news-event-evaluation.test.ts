import { readFileSync } from "node:fs";
import { it, expect, describe } from "vitest";

import {
    validateCorpus,
    summarizeConfusion,
    evaluateNewsEventCorpus,
} from "../scripts/performance/news-event-evaluation";

import type { NewsEventCorpus } from "../scripts/performance/news-event-evaluation";

const corpus = JSON.parse(
    readFileSync(new URL("./fixtures/news-event-real-corpus.json", import.meta.url), "utf8")
) as NewsEventCorpus;

describe("real news event evaluation", () => {
    it("handles undefined precision and recall without hiding false negatives", () => {
        expect(summarizeConfusion({ tp: 0, fp: 0, tn: 1, fn: 1 })).toMatchObject({
            pairs: 2,
            precision: null,
            recall: 0,
            f1: 0,
        });
        expect(summarizeConfusion({ tp: 0, fp: 0, tn: 1, fn: 0 })).toMatchObject({
            precision: null,
            recall: null,
            f1: null,
        });
        expect(summarizeConfusion({ tp: 2, fp: 1, tn: 5, fn: 2 })).toMatchObject({
            pairs: 10,
            positives: 4,
            precision: 2 / 3,
            recall: 1 / 2,
            f1: 4 / 7,
        });
    });

    it("validates the frozen public-report corpus and rejects missing or duplicate identities", () => {
        expect(() => validateCorpus(corpus)).not.toThrow();
        expect(() => validateCorpus({ ...corpus, reports: [...corpus.reports, corpus.reports[0]] })).toThrow(
            /Duplicate/
        );
        expect(() =>
            validateCorpus({
                ...corpus,
                reports: [{ ...corpus.reports[0], event: "unknown" }, ...corpus.reports.slice(1)],
            })
        ).toThrow(/label/);
        expect(() =>
            validateCorpus({
                ...corpus,
                reports: [{ ...corpus.reports[0], reportedAt: "2030-01-01" }, ...corpus.reports.slice(1)],
            })
        ).toThrow(/time/);
    });

    it("counts isolated pairs and complete cohort clusters separately and preserves the baseline", () => {
        const result = evaluateNewsEventCorpus(corpus);
        expect(result).toMatchObject({
            reportCount: 73,
            eventCount: 43,
            sourceCount: 6,
            distinctArticleCount: 70,
            labelStatus: "proposed",
        });
        const batch = result.totals.batch;
        expect(batch).toMatchObject({ pairs: 1038, positives: 59 });
        // Proposed labels, not a production quality SLA. Improvements may reduce errors,
        // but this fixed regression corpus must not trade one error class for the other.
        expect(batch.fp).toBeLessThanOrEqual(3);
        expect(batch.fn).toBeLessThanOrEqual(15);
        expect(result.totals.pair).toMatchObject({ pairs: 1038, positives: 59 });
        expect(result.totals.distinctArticleBatch.pairs).toBe(1035);
        expect(result.totals.hardBatch).toMatchObject({ pairs: 225, positives: 59 });
        expect(result.recorded.daily.languages["en-zh"]).toMatchObject({ positives: 8, pairs: 350 });
        expect(result.adapterDaily?.batch.pairs).toBe(741);
        expect(Object.values(result.recorded).every((cohort) => cohort.orderDisagreements.length === 0)).toBe(true);
    });

    it("keeps event labels outside the production clustering inputs", () => {
        const renamed = {
            ...corpus,
            events: corpus.events.map((event) => ({ ...event, id: "label-" + event.id })),
            reports: corpus.reports.map((report) => ({ ...report, event: "label-" + report.event })),
        };
        expect(evaluateNewsEventCorpus(renamed)).toEqual(evaluateNewsEventCorpus(corpus));
    });
});
