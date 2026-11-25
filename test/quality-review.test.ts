import { readFileSync } from "node:fs";
import { it, expect, describe } from "vitest";

import { CHINESE_SEARCH_CASES } from "../scripts/performance/chinese-search-cases";
import { scoreReviewedRetrieval } from "../scripts/performance/quality-review-retrieval";
import {
    packetDigest,
    compareReviews,
    blankSubmission,
    prepareReviewPacket,
} from "../scripts/performance/quality-review";

import type { NewsEventCorpus } from "../scripts/performance/news-event-evaluation";
import type { ReviewPacket, ReviewDataset } from "../scripts/performance/quality-review";

const now = "2026-11-25T09:00:00Z";
const report = (id: string, title: string, source = "weibo", language = "en") => ({
    id,
    cohort: "release",
    title,
    source,
    language,
    url: "https://example.test/" + id,
    articleUrl: "https://example.test/" + id,
    evidenceUrl: "https://example.test/" + id,
    reportedAt: now,
    timeKind: "published",
});
const dataset: ReviewDataset = {
    snapshotAt: now,
    reports: [
        report("a", "Rust 1.97 released"),
        report("b", "Rust 1.97 released", "hackernews"),
        report("c", "Rust 1.98 released"),
    ],
    queries: [
        { id: "q1", query: "Rust 1.97" },
        { id: "q2", query: "No answer 12345" },
    ],
};
function reviews(packet: ReviewPacket) {
    return ["test-fixture-a", "test-fixture-b"].map((name, i) => {
        const row = blankSubmission(packet);
        row.reviewer = name;
        row.independent = true;
        row.withoutPredictions = true;
        row.events = row.events.map((item) => {
            const r = packet.reports.find((x) => x.id === item.reportId)!;
            return {
                ...item,
                group: (r.title.includes("1.97") ? "event-a" : "event-b") + i,
                family: "rust" + i,
                reason: "Synthetic test fixture; not human annotation.",
            };
        });
        row.retrieval = row.retrieval.map((item) => ({
            ...item,
            reviewedAllReports: true,
            relevant:
                packet.queries.find((q) => q.id === item.queryId)!.query === "Rust 1.97"
                    ? packet.reports.filter((r) => r.title.includes("1.97")).map((r) => r.id)
                    : [],
            reason: "Synthetic test fixture; all reports classified for this query.",
        }));
        return row;
    });
}

describe("independent quality review workflow", () => {
    it("exports existing reports and queries without answers, label order or predictions", () => {
        const corpus = JSON.parse(
            readFileSync(new URL("./fixtures/news-event-real-corpus.json", import.meta.url), "utf8")
        ) as NewsEventCorpus;
        const hybrid = JSON.parse(
            readFileSync(new URL("./fixtures/news-hybrid-search-queries.json", import.meta.url), "utf8")
        ) as { cases: Array<{ query: string; kind: string; relevant: string[] }> };
        const input = {
            snapshotAt: corpus.snapshotAt,
            reports: corpus.reports.map((r) => ({ ...r, cohort: corpus.events.find((e) => e.id === r.event)!.cohort })),
            queries: [...hybrid.cases, ...CHINESE_SEARCH_CASES].map((q, i) => ({ ...q, id: "q-" + i })),
        };
        const packet = prepareReviewPacket(input, "regression");
        expect(packet.reports).toHaveLength(73);
        expect(packet.queries).toHaveLength(36);
        expect(
            packet.reports.every(
                (r) => !Object.hasOwn(r, "event") && !Object.hasOwn(r, "family") && r.id.startsWith("r-")
            )
        ).toBe(true);
        expect(packet.queries.every((q) => Object.keys(q).sort().join(",") === "id,query")).toBe(true);
        expect(prepareReviewPacket(packet, "regression")).toEqual(packet);
        expect(
            packetDigest(
                prepareReviewPacket(
                    { ...input, reports: [...input.reports].reverse(), queries: [...input.queries].reverse() },
                    "regression"
                )
            )
        ).toBe(packetDigest(packet));
    });
    it("validates the unreviewed frozen holdout candidate against both known query fixtures", () => {
        const corpus = JSON.parse(
            readFileSync(new URL("./fixtures/news-event-real-corpus.json", import.meta.url), "utf8")
        ) as NewsEventCorpus;
        const hybrid = JSON.parse(
            readFileSync(new URL("./fixtures/news-hybrid-search-queries.json", import.meta.url), "utf8")
        ) as { cases: Array<{ query: string }> };
        const prior = {
            snapshotAt: corpus.snapshotAt,
            reports: corpus.reports.map((r) => ({ ...r, cohort: corpus.events.find((e) => e.id === r.event)!.cohort })),
            queries: [...hybrid.cases, ...CHINESE_SEARCH_CASES].map((q, i) => ({ id: "q" + i, query: q.query })),
        };
        const candidate = JSON.parse(
            readFileSync(new URL("./fixtures/news-quality-holdout-candidate.json", import.meta.url), "utf8")
        ) as ReviewDataset;
        const packet = prepareReviewPacket(candidate, "holdout", [prior]);
        expect(packet.reports).toHaveLength(63);
        expect(packet.queries).toHaveLength(22);
        expect(packet.reports.filter((r) => r.cohort === "daily")).toHaveLength(48);
        expect(packet.reports.filter((r) => r.cohort === "release")).toHaveLength(8);
        expect(packet.reports.filter((r) => r.cohort === "security")).toHaveLength(7);
        expect(packet.reports.filter((r) => r.language === "zh")).toHaveLength(16);
        expect(packetDigest(prepareReviewPacket(packet, "holdout", [prior]))).toBe(packetDigest(packet));
    });
    it("keeps uncertain singleton reports visible even without pair comparisons", () => {
        const packet = prepareReviewPacket(
            { ...dataset, reports: [...dataset.reports.slice(0, 2), { ...dataset.reports[2], cohort: "singleton" }] },
            "regression"
        );
        const [a, b] = reviews(packet);
        const id = packet.reports.find((r) => r.cohort === "singleton")!.id;
        const label = b.events.find((r) => r.reportId === id)!;
        label.group = null;
        label.family = null;
        label.reason = "Synthetic uncertainty.";
        const result = compareReviews(packet, a, b);
        expect(result.status).toBe("review-disagreements");
        expect(result.event.excludedPairs).toBe(0);
        expect(result.event.unresolvedReports).toEqual([
            { id, reviewerReasons: [a.events.find((r) => r.reportId === id)!.reason, "Synthetic uncertainty."] },
        ]);
    });
    it("rejects contradictory family assignments inside the same reviewed event", () => {
        const packet = prepareReviewPacket(dataset, "regression");
        const [a, b] = reviews(packet);
        const reportId = packet.reports.find((r) => r.title.includes("1.97"))!.id;
        b.events.find((r) => r.reportId === reportId)!.family = "contradictory";
        expect(() => compareReviews(packet, a, b)).toThrow(/Inconsistent family/);
    });

    it("requires complete reasoned submissions, different reviewers and an exact packet digest", () => {
        const packet = prepareReviewPacket(dataset, "regression");
        const [a, b] = reviews(packet);
        expect(() => compareReviews(packet, blankSubmission(packet), b)).toThrow(/attestation/);
        expect(() => compareReviews(packet, a, { ...b, reviewer: a.reviewer.toUpperCase() })).toThrow(/distinct/);
        expect(() => compareReviews(packet, a, { ...b, packetSha256: "stale" })).toThrow(/digest/);
        expect(() => compareReviews(packet, a, { ...b, events: b.events.slice(1) })).toThrow(/Incomplete/);
        expect(() =>
            compareReviews(packet, a, {
                ...b,
                retrieval: b.retrieval.map((q) => ({ ...q, reviewedAllReports: false })),
            })
        ).toThrow(/Incomplete relevance/);
        expect(() => compareReviews(packet, a, { ...b, events: b.events.map((q) => ({ ...q, reason: "" })) })).toThrow(
            /reason/
        );
    });
    it("compares group relations rather than local names and evaluates real clustering", () => {
        const packet = prepareReviewPacket(dataset, "regression");
        const [a, b] = reviews(packet);
        const result = compareReviews(packet, a, b);
        expect(result).toMatchObject({
            status: "submitted-consensus",
            automaticAdmission: false,
            event: {
                pairs: 3,
                scoredPairs: 3,
                excludedPairs: 0,
                metrics: { batch: { positives: 1, pairs: 3 }, hardBatch: { pairs: 3 } },
            },
        });
        expect(result.agreedQueries).toHaveLength(2);
        expect(result.agreedQueries.find((q) => q.query.startsWith("No"))?.relevant).toEqual([]);
    });
    it("excludes uncertain pairs and entire ambiguous relevance queries without fabricating negatives", () => {
        const packet = prepareReviewPacket(dataset, "regression");
        const [a, b] = reviews(packet);
        b.events[0] = { ...b.events[0], group: null, family: null, reason: "Synthetic uncertain evidence." };
        const q = b.retrieval.find((x) => packet.queries.find((y) => y.id === x.queryId)?.query === "Rust 1.97")!;
        q.uncertain = [packet.reports.find((r) => !q.relevant.includes(r.id))!.id];
        const result = compareReviews(packet, a, b);
        expect(result).toMatchObject({
            status: "review-disagreements",
            event: { pairs: 3, excludedPairs: 2, scoredPairs: 1 },
        });
        expect(
            result.event.disagreements.every((x) => x.reviewerReasons.includes("Synthetic uncertain evidence."))
        ).toBe(true);
        expect(result.agreedQueries.map((entry) => entry.query)).toEqual(["No answer 12345"]);
        expect(result.excludedQueries).toHaveLength(1);
    });
    it("keeps actual different relation and family disagreement visible", () => {
        const packet = prepareReviewPacket(dataset, "regression");
        const [a, b] = reviews(packet);
        const r = packet.reports.find((entry) => entry.title.includes("1.98"))!;
        const label = b.events.find((x) => x.reportId === r.id)!;
        label.group = b.events.find((x) => x.reportId !== r.id)!.group;
        expect(compareReviews(packet, a, b).event.excludedPairs).toBe(2);
        label.group = "different";
        label.family = "different-family";
        const result = compareReviews(packet, a, b);
        expect(result.event.familyDisagreements).toHaveLength(2);
        expect(result.status).toBe("review-disagreements");
    });
    it("rejects unknown and duplicated relevance IDs", () => {
        const packet = prepareReviewPacket(dataset, "regression");
        const [a, b] = reviews(packet);
        b.retrieval[0].relevant = ["absent"];
        expect(() => compareReviews(packet, a, b)).toThrow(/Invalid relevance/);
        b.retrieval[0].relevant = [packet.reports[0].id];
        b.retrieval[0].uncertain = [packet.reports[0].id];
        expect(() => compareReviews(packet, a, b)).toThrow(/Invalid relevance/);
    });
    it("requires known-corpus disjointness by normalized report/original URL, title, and query", () => {
        const fresh: ReviewDataset = {
            snapshotAt: now,
            reports: [report("fresh-1", "New topic A"), report("fresh-2", "New topic B")],
            queries: [{ id: "q", query: "New topic" }],
        };
        expect(() => prepareReviewPacket(fresh, "holdout")).toThrow(/prior dataset/);
        expect(prepareReviewPacket(fresh, "holdout", [dataset]).kind).toBe("holdout");
        expect(() =>
            prepareReviewPacket(
                {
                    ...fresh,
                    reports: [
                        { ...fresh.reports[0], articleUrl: dataset.reports[0].url + "?utm_source=fixture" },
                        fresh.reports[1],
                    ],
                },
                "holdout",
                [dataset]
            )
        ).toThrow(/overlaps prior reports/);
        expect(() =>
            prepareReviewPacket(
                { ...fresh, reports: [{ ...fresh.reports[0], title: " RUST 1.97  released " }, fresh.reports[1]] },
                "holdout",
                [dataset]
            )
        ).toThrow(/overlaps prior reports/);
        expect(() =>
            prepareReviewPacket({ ...fresh, queries: [{ id: "q", query: " Ｒｕｓｔ １.９７ " }] }, "holdout", [dataset])
        ).toThrow(/overlaps prior queries/);
    });
    it("does not accept unsafe evidence, duplicate report IDs or malformed dates", () => {
        expect(() =>
            prepareReviewPacket(
                {
                    ...dataset,
                    reports: [{ ...dataset.reports[0], url: "file:///secret" }, ...dataset.reports.slice(1)],
                },
                "regression"
            )
        ).toThrow(/Invalid review report/);
        expect(() =>
            prepareReviewPacket(
                { ...dataset, reports: [dataset.reports[0], { ...dataset.reports[1], id: dataset.reports[0].id }] },
                "regression"
            )
        ).toThrow(/Duplicate/);
        expect(() =>
            prepareReviewPacket(
                { ...dataset, reports: [{ ...dataset.reports[0], reportedAt: "bad" }, ...dataset.reports.slice(1)] },
                "regression"
            )
        ).toThrow(/Invalid review report/);
    });
    it("scores agreed relevance using the actual article index and both experimental channels", async () => {
        const packet = prepareReviewPacket(dataset, "regression");
        const [a, b] = reviews(packet);
        const result = await scoreReviewedRetrieval(packet, compareReviews(packet, a, b).agreedQueries);
        expect(result.queries).toBe(2);
        expect(result.metrics?.lexical).toMatchObject({ tp: 2, fn: 0, noAnswerQueries: 1, falsePositiveNoAnswer: 0 });
        expect(result.metrics?.hybrid).toHaveProperty("ndcgAt5");
        expect(result.metricsByLanguage).toMatchObject({ latin: { lexical: { tp: 2, noAnswerQueries: 1 } } });
        expect(result.rows.every((row) => row.lexical.returned <= 5)).toBe(true);
        expect(await scoreReviewedRetrieval(packet, [])).toMatchObject({ queries: 0, metrics: null });
    });
});
