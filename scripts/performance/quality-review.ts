import { createHash } from "node:crypto";

import { safeNewsUrl } from "../../shared/news-url-policy";
import { normalizeNewsUrl } from "../../shared/news-insights";
import { summarizeConfusion, clusterNewsEventReports } from "./news-event-evaluation";

import type { Confusion, LabeledReport } from "./news-event-evaluation";

export type ReviewReport = Omit<LabeledReport, "event"> & { cohort: string };
export interface ReviewQuery {
    id: string;
    query: string;
}
export interface ReviewDataset {
    snapshotAt: string;
    reports: ReviewReport[];
    queries: ReviewQuery[];
}
export interface ReviewPacket extends ReviewDataset {
    schemaVersion: 1;
    kind: "regression" | "holdout";
}
interface EventJudgment {
    reportId: string;
    group: string | null;
    family: string | null;
    reason: string;
}
interface RetrievalJudgment {
    queryId: string;
    relevant: string[];
    uncertain: string[];
    reviewedAllReports: boolean;
    reason: string;
}
export interface ReviewSubmission {
    packetSha256: string;
    reviewer: string;
    independent: boolean;
    withoutPredictions: boolean;
    events: EventJudgment[];
    retrieval: RetrievalJudgment[];
}

const textKey = (value: string) => value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
const blindId = (prefix: string, value: string) =>
    prefix + "-" + createHash("sha256").update(value).digest("hex").slice(0, 32);
const validId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const hasText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const blank = (): Confusion => ({ tp: 0, fp: 0, tn: 0, fn: 0 });
function add(c: Confusion, expected: boolean, actual: boolean) {
    if (expected) c[actual ? "tp" : "fn"]++;
    else c[actual ? "fp" : "tn"]++;
}

/** Export a fixed whitelist: neither proposed labels nor model predictions/answers
 * can be carried into a review packet by copying an evaluation fixture.
 */
export function prepareReviewPacket(
    dataset: ReviewDataset,
    kind: ReviewPacket["kind"],
    baselines: ReviewDataset[] = []
): ReviewPacket {
    if (
        !dataset ||
        !["regression", "holdout"].includes(kind) ||
        !hasText(dataset.snapshotAt) ||
        !Number.isFinite(Date.parse(dataset.snapshotAt)) ||
        !Array.isArray(dataset.reports) ||
        !Array.isArray(dataset.queries) ||
        dataset.reports.length < 2 ||
        dataset.reports.length > 500 ||
        dataset.queries.length < 1 ||
        dataset.queries.length > 200
    )
        throw new Error("Invalid review dataset.");
    const reports = dataset.reports
        .map((r) => {
            if (
                !r ||
                !validId(r.id) ||
                !validId(r.cohort) ||
                !hasText(r.source) ||
                !hasText(r.title) ||
                !["zh", "en"].includes(r.language) ||
                !["published", "submission"].includes(r.timeKind) ||
                !hasText(r.reportedAt) ||
                !Number.isFinite(Date.parse(r.reportedAt)) ||
                Date.parse(r.reportedAt) > Date.parse(dataset.snapshotAt) ||
                ![r.url, r.articleUrl, r.evidenceUrl].every((v) => safeNewsUrl(v) && new URL(v).protocol === "https:")
            ) {
                throw new Error("Invalid review report: " + r?.id);
            }
            const { cohort, source, language, title, url, articleUrl, reportedAt, timeKind, evidenceUrl } = r;
            return {
                id: blindId("r", normalizeNewsUrl(url)),
                cohort,
                source,
                language,
                title,
                url,
                articleUrl,
                reportedAt,
                timeKind,
                evidenceUrl,
            };
        })
        .sort((a, b) => a.id.localeCompare(b.id, "en"));
    const queries = dataset.queries
        .map((q) => {
            if (!q || !validId(q.id) || !hasText(q.query) || q.query.length > 256)
                throw new Error("Invalid review query.");
            return { id: blindId("q", textKey(q.query)), query: q.query.trim() };
        })
        .sort((a, b) => a.id.localeCompare(b.id, "en"));
    if (
        new Set(dataset.reports.map((r) => r.id)).size !== reports.length ||
        new Set(dataset.queries.map((q) => q.id)).size !== queries.length ||
        new Set(reports.map((r) => r.id)).size !== reports.length ||
        new Set(reports.map((r) => normalizeNewsUrl(r.url))).size !== reports.length ||
        new Set(queries.map((q) => q.id)).size !== queries.length ||
        new Set(queries.map((q) => textKey(q.query))).size !== queries.length
    )
        throw new Error("Duplicate report or query.");
    if (kind === "holdout") {
        if (!baselines.length) throw new Error("Holdout requires prior dataset comparison.");
        const seenUrls = new Set(
            baselines.flatMap((b) =>
                b.reports.flatMap((r) => [normalizeNewsUrl(r.url), normalizeNewsUrl(r.articleUrl)])
            )
        );
        const seenTitles = new Set(baselines.flatMap((b) => b.reports.map((r) => textKey(r.title))));
        const seenQueries = new Set(baselines.flatMap((b) => b.queries.map((q) => textKey(q.query))));
        if (
            reports.some(
                (r) =>
                    [r.url, r.articleUrl].some((url) => seenUrls.has(normalizeNewsUrl(url))) ||
                    seenTitles.has(textKey(r.title))
            )
        ) {
            throw new Error("Holdout overlaps prior reports (URL or title).");
        }
        if (queries.some((q) => seenQueries.has(textKey(q.query)))) throw new Error("Holdout overlaps prior queries.");
    }
    return { schemaVersion: 1, kind, snapshotAt: dataset.snapshotAt, reports, queries };
}
export function packetDigest(packet: ReviewPacket) {
    return createHash("sha256").update(JSON.stringify(packet)).digest("hex");
}
export function blankSubmission(packet: ReviewPacket): ReviewSubmission {
    return {
        packetSha256: packetDigest(packet),
        reviewer: "",
        independent: false,
        withoutPredictions: false,
        events: packet.reports.map((r) => ({ reportId: r.id, group: null, family: null, reason: "" })),
        retrieval: packet.queries.map((q) => ({
            queryId: q.id,
            relevant: [],
            uncertain: [],
            reviewedAllReports: false,
            reason: "",
        })),
    };
}

function validateSubmission(packet: ReviewPacket, review: ReviewSubmission) {
    if (
        !review ||
        review.packetSha256 !== packetDigest(packet) ||
        !hasText(review.reviewer) ||
        review.independent !== true ||
        review.withoutPredictions !== true ||
        !Array.isArray(review.events) ||
        !Array.isArray(review.retrieval)
    )
        throw new Error("Review identity, packet digest or attestation missing.");
    const events = new Map(review.events.map((r) => [r.reportId, r]));
    const retrieval = new Map(review.retrieval.map((r) => [r.queryId, r]));
    const ids = new Set(packet.reports.map((r) => r.id));
    if (
        events.size !== packet.reports.length ||
        events.size !== review.events.length ||
        retrieval.size !== packet.queries.length ||
        retrieval.size !== review.retrieval.length
    )
        throw new Error("Incomplete or duplicate review judgments.");
    const familiesByGroup = new Map<string, string>();
    for (const report of packet.reports) {
        const r = events.get(report.id);
        if (
            !r ||
            !hasText(r.reason) ||
            !(r.group === null ? r.family === null : hasText(r.group) && hasText(r.family))
        ) {
            throw new Error("Missing event judgment or reason: " + report.id);
        }
        if (r.group !== null) {
            const key = JSON.stringify([report.cohort, r.group.trim()]);
            const family = r.family!.trim();
            const known = familiesByGroup.get(key);
            if (known !== undefined && known !== family)
                throw new Error("Inconsistent family for reviewed event group: " + report.id);
            familiesByGroup.set(key, family);
        }
    }
    for (const query of packet.queries) {
        const r = retrieval.get(query.id);
        if (
            !r ||
            !hasText(r.reason) ||
            r.reviewedAllReports !== true ||
            !Array.isArray(r.relevant) ||
            !Array.isArray(r.uncertain)
        ) {
            throw new Error("Incomplete relevance judgment: " + query.id);
        }
        const judged = [...r.relevant, ...r.uncertain];
        if (new Set(judged).size !== judged.length || judged.some((id) => !ids.has(id)))
            throw new Error("Invalid relevance report IDs: " + query.id);
    }
    return { events, retrieval };
}

/** Compare relations rather than arbitrary reviewer-local group names.
 * Keep original complete cohort inputs when scoring agreed pairs.
 */
export function compareReviews(packet: ReviewPacket, first: ReviewSubmission, second: ReviewSubmission) {
    const a = validateSubmission(packet, first),
        b = validateSubmission(packet, second);
    if (textKey(first.reviewer) === textKey(second.reviewer))
        throw new Error("Two distinct reviewer identifiers required.");
    const totals = {
        batch: blank(),
        pair: blank(),
        hardBatch: blank(),
        crossSourceBatch: blank(),
        distinctArticleBatch: blank(),
    };
    const byCohort: Record<string, Confusion> = Object.create(null);
    const byLanguage: Record<string, Confusion> = { "en-en": blank(), "en-zh": blank(), "zh-zh": blank() };
    const disagreements: Array<{ left: string; right: string; reason: string; reviewerReasons: string[] }> = [];
    const familyDisagreements: Array<{ left: string; right: string; reviewerReasons: string[] }> = [];
    const unresolvedReports = packet.reports.flatMap((report) => {
        const l = a.events.get(report.id)!,
            r = b.events.get(report.id)!;
        return l.group === null || r.group === null ? [{ id: report.id, reviewerReasons: [l.reason, r.reason] }] : [];
    });
    const cohorts = [...new Set(packet.reports.map((r) => r.cohort))];
    let pairs = 0,
        orderDisagreements = 0;
    const observedAt = Date.parse(packet.snapshotAt);
    for (const cohort of cohorts) {
        const reports = packet.reports.filter((r) => r.cohort === cohort);
        const forward = clusterNewsEventReports(reports, "recorded", observedAt);
        const reverse = clusterNewsEventReports([...reports].reverse(), "recorded", observedAt);
        byCohort[cohort] = blank();
        for (let i = 0; i < reports.length; i++) {
            const left = reports[i];
            for (const right of reports.slice(i + 1)) {
                pairs++;
                const l = a.events.get(left.id)!,
                    r = a.events.get(right.id)!,
                    l2 = b.events.get(left.id)!,
                    r2 = b.events.get(right.id)!;
                const x = l.group !== null && r.group !== null ? l.group.trim() === r.group.trim() : null;
                const y = l2.group !== null && r2.group !== null ? l2.group.trim() === r2.group.trim() : null;
                const actual = forward.get(left.id) === forward.get(right.id);
                if (actual !== (reverse.get(left.id) === reverse.get(right.id))) orderDisagreements++;
                if (x === null || y === null || x !== y) {
                    disagreements.push({
                        left: left.id,
                        right: right.id,
                        reason: x === null || y === null ? "uncertain" : "different relation",
                        reviewerReasons: [l.reason, r.reason, l2.reason, r2.reason],
                    });
                    continue;
                }
                const isolated = clusterNewsEventReports([left, right], "recorded", observedAt);
                add(totals.batch, x, actual);
                add(totals.pair, x, isolated.get(left.id) === isolated.get(right.id));
                add(byCohort[cohort], x, actual);
                add(byLanguage[[left.language, right.language].sort().join("-")], x, actual);
                if (left.source !== right.source) add(totals.crossSourceBatch, x, actual);
                if (normalizeNewsUrl(left.articleUrl) !== normalizeNewsUrl(right.articleUrl))
                    add(totals.distinctArticleBatch, x, actual);
                const hard = l.family!.trim() === r.family!.trim(),
                    hard2 = l2.family!.trim() === r2.family!.trim();
                if (hard !== hard2)
                    familyDisagreements.push({
                        left: left.id,
                        right: right.id,
                        reviewerReasons: [l.reason, r.reason, l2.reason, r2.reason],
                    });
                else if (hard) add(totals.hardBatch, x, actual);
            }
        }
    }
    // A disputed or uncertain report relevance makes recall and no-answer
    // classification unknown for the entire query; do not silently call it negative.
    const agreedQueries: Array<ReviewQuery & { relevant: string[] }> = [];
    const excludedQueries: Array<{
        id: string;
        reason: string;
        reviewerReasons: string[];
        judgments: Array<{ relevant: string[]; uncertain: string[] }>;
    }> = [];
    for (const query of packet.queries) {
        const x = a.retrieval.get(query.id)!,
            y = b.retrieval.get(query.id)!;
        const ids = [...x.relevant].sort();
        if (
            x.uncertain.length ||
            y.uncertain.length ||
            JSON.stringify(ids) !== JSON.stringify([...y.relevant].sort())
        ) {
            excludedQueries.push({
                id: query.id,
                reason: x.uncertain.length || y.uncertain.length ? "uncertain" : "different relevant sets",
                reviewerReasons: [x.reason, y.reason],
                judgments: [
                    { relevant: x.relevant, uncertain: x.uncertain },
                    { relevant: y.relevant, uncertain: y.uncertain },
                ],
            });
        } else agreedQueries.push({ ...query, relevant: ids });
    }
    const stats = summarizeConfusion(totals.batch);
    return {
        packetSha256: packetDigest(packet),
        kind: packet.kind,
        reviewers: [first.reviewer.trim(), second.reviewer.trim()],
        status:
            unresolvedReports.length || disagreements.length || excludedQueries.length || familyDisagreements.length
                ? "review-disagreements"
                : "submitted-consensus",
        // Attestations and exact duplicate checks are not proof of independent authorship
        // or an untouched holdout. Release/feature admission is deliberately separate.
        automaticAdmission: false,
        event: {
            pairs,
            scoredPairs: stats.pairs,
            excludedPairs: disagreements.length,
            orderDisagreements,
            metrics: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, summarizeConfusion(v)])),
            byCohort: Object.fromEntries(Object.entries(byCohort).map(([k, v]) => [k, summarizeConfusion(v)])),
            byLanguage: Object.fromEntries(Object.entries(byLanguage).map(([k, v]) => [k, summarizeConfusion(v)])),
            unresolvedReports,
            disagreements,
            familyDisagreements,
        },
        agreedQueries,
        excludedQueries,
    };
}
