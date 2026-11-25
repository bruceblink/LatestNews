import { normalizeNewsUrl, createTopicEvents, collectInsightItems } from "../../shared/news-insights";

import type { SourceID, SourceResponse } from "../../shared/types";

export interface EventLabel {
    id: string;
    cohort: string;
    family: string;
    note: string;
}

export interface LabeledReport {
    id: string;
    event: string;
    source: string;
    language: string;
    title: string;
    url: string;
    articleUrl: string;
    reportedAt: string;
    timeKind: string;
    evidenceUrl: string;
}

export interface NewsEventCorpus {
    schemaVersion: number;
    selection: string;
    snapshotDate: string;
    snapshotAt: string;
    labelStatus: "proposed" | "human-reviewed";
    sourceNotes: string;
    events: EventLabel[];
    reports: LabeledReport[];
}

export interface Confusion {
    tp: number;
    fp: number;
    tn: number;
    fn: number;
}

interface PairError {
    left: string;
    right: string;
    expected: "same" | "different";
    actual: "same" | "different";
    language: string;
    hard: boolean;
}

const emptyConfusion = (): Confusion => ({ tp: 0, fp: 0, tn: 0, fn: 0 });

export function summarizeConfusion(c: Confusion) {
    const precision = c.tp + c.fp === 0 ? null : c.tp / (c.tp + c.fp);
    const recall = c.tp + c.fn === 0 ? null : c.tp / (c.tp + c.fn);
    return {
        ...c,
        pairs: c.tp + c.fp + c.tn + c.fn,
        positives: c.tp + c.fn,
        precision,
        recall,
        f1: 2 * c.tp + c.fp + c.fn === 0 ? null : (2 * c.tp) / (2 * c.tp + c.fp + c.fn),
    };
}

export function validateCorpus(corpus: NewsEventCorpus) {
    if (
        corpus.schemaVersion !== 1 ||
        !corpus.selection ||
        !corpus.sourceNotes ||
        !["proposed", "human-reviewed"].includes(corpus.labelStatus) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(corpus.snapshotDate) ||
        !Number.isFinite(Date.parse(corpus.snapshotAt)) ||
        !corpus.snapshotAt.startsWith(corpus.snapshotDate + "T")
    ) {
        throw new Error("Unsupported or incomplete event corpus metadata.");
    }
    const events = new Map(corpus.events.map((event) => [event.id, event]));
    if (events.size !== corpus.events.length || events.size === 0)
        throw new Error("Duplicate or missing event labels.");
    const ids = new Set<string>();
    const urls = new Set<string>();
    const representedEvents = new Set<string>();
    for (const report of corpus.reports) {
        if (!report.id || ids.has(report.id) || urls.has(report.url))
            throw new Error("Duplicate or missing report identity.");
        if (
            !events.has(report.event) ||
            !report.title.trim() ||
            !report.source.trim() ||
            !["zh", "en"].includes(report.language)
        ) {
            throw new Error("Invalid report label or content: " + report.id);
        }
        if (
            !["published", "submission"].includes(report.timeKind) ||
            !Number.isFinite(Date.parse(report.reportedAt)) ||
            Date.parse(report.reportedAt) > Date.parse(corpus.snapshotAt)
        ) {
            throw new Error("Invalid report time: " + report.id);
        }
        for (const value of [report.url, report.articleUrl, report.evidenceUrl]) {
            if (new URL(value).protocol !== "https:")
                throw new Error("Non-HTTPS evidence or article link: " + report.id);
        }
        ids.add(report.id);
        urls.add(report.url);
        representedEvents.add(report.event);
    }
    for (const event of corpus.events) {
        if (!event.id || !event.cohort || !event.family || !event.note || !representedEvents.has(event.id)) {
            throw new Error("Empty or unrepresented event label: " + event.id);
        }
    }
}

type TimeMode = "recorded" | "adapter-daily";

function cluster(reports: LabeledReport[], mode: TimeMode, observedAt: number) {
    const generatedAt = Math.max(...reports.map((report) => Date.parse(report.reportedAt)));
    const responses: SourceResponse[] = reports.map((report) => ({
        id: report.source as SourceID,
        name: report.source,
        status: "success",
        updatedTime: mode === "adapter-daily" ? observedAt : Date.parse(report.reportedAt),
        items: [
            {
                id: report.id,
                title: report.title,
                url: report.url,
                ...(mode === "adapter-daily" && report.timeKind === "submission"
                    ? {}
                    : { pubDate: Date.parse(report.reportedAt) }),
            },
        ],
    }));
    const options = {
        generatedAt: mode === "adapter-daily" ? observedAt : generatedAt,
        minTopicItems: 1,
        topicLimit: reports.length,
    };
    const result = createTopicEvents(collectInsightItems(responses, options), options);
    const membership = new Map<string, number>();
    result.forEach((group, index) => {
        for (const item of group.items) {
            if (membership.has(item.id)) throw new Error("Report appears more than once: " + item.id);
            membership.set(item.id, index);
        }
    });
    if (membership.size !== reports.length || reports.some((report) => !membership.has(report.id))) {
        throw new Error("Clustering evaluation lost report membership.");
    }
    return membership;
}

function same(membership: Map<string, number>, left: LabeledReport, right: LabeledReport) {
    return membership.get(left.id) === membership.get(right.id);
}

function update(c: Confusion, expected: boolean, actual: boolean) {
    if (expected) {
        if (actual) c.tp += 1;
        else c.fn += 1;
    } else if (actual) c.fp += 1;
    else c.tn += 1;
}

function evaluateCohort(reports: LabeledReport[], events: Map<string, EventLabel>, mode: TimeMode, observedAt: number) {
    const forward = cluster(reports, mode, observedAt);
    const reverse = cluster([...reports].reverse(), mode, observedAt);
    const totals = {
        pair: emptyConfusion(),
        batch: emptyConfusion(),
        hardBatch: emptyConfusion(),
        crossSourceBatch: emptyConfusion(),
        distinctArticleBatch: emptyConfusion(),
    };
    const languages = { "en-en": emptyConfusion(), "zh-zh": emptyConfusion(), "en-zh": emptyConfusion() };
    const errors: PairError[] = [];
    const pairErrors: PairError[] = [];
    const orderDisagreements: Array<{ left: string; right: string }> = [];
    for (let i = 0; i < reports.length; i += 1) {
        const left = reports[i];
        for (const right of reports.slice(i + 1)) {
            const expected = left.event === right.event;
            const actual = same(forward, left, right);
            const isolated = same(cluster([left, right], mode, observedAt), left, right);
            const hard = events.get(left.event)!.family === events.get(right.event)!.family;
            const language = (
                left.language === right.language ? left.language + "-" + right.language : "en-zh"
            ) as keyof typeof languages;
            update(totals.pair, expected, isolated);
            update(totals.batch, expected, actual);
            if (hard) update(totals.hardBatch, expected, actual);
            if (left.source !== right.source) update(totals.crossSourceBatch, expected, actual);
            if (normalizeNewsUrl(left.articleUrl) !== normalizeNewsUrl(right.articleUrl)) {
                update(totals.distinctArticleBatch, expected, actual);
            }
            update(languages[language], expected, actual);
            const describeError = (predicted: boolean): PairError => ({
                left: left.id,
                right: right.id,
                expected: expected ? "same" : "different",
                actual: predicted ? "same" : "different",
                language,
                hard,
            });
            if (actual !== expected) errors.push(describeError(actual));
            if (isolated !== expected) pairErrors.push(describeError(isolated));
            if (actual !== same(reverse, left, right)) orderDisagreements.push({ left: left.id, right: right.id });
        }
    }
    const expectedGroups = new Map<string, string[]>();
    for (const report of reports) {
        expectedGroups.set(report.event, [...(expectedGroups.get(report.event) ?? []), report.id]);
    }
    const actualGroups = new Map<number, string[]>();
    for (const report of reports) {
        const id = forward.get(report.id)!;
        actualGroups.set(id, [...(actualGroups.get(id) ?? []), report.id]);
    }
    const key = (ids: string[]) => [...ids].sort().join("|");
    const actualKeys = new Set([...actualGroups.values()].map(key));
    const exactGroups = [...expectedGroups.values()].filter((ids) => actualKeys.has(key(ids))).length;
    return {
        reportCount: reports.length,
        labeledEvents: expectedGroups.size,
        predictedEvents: actualGroups.size,
        exactGroups,
        ...(Object.fromEntries(Object.entries(totals).map(([name, c]) => [name, summarizeConfusion(c)])) as Record<
            keyof typeof totals,
            ReturnType<typeof summarizeConfusion>
        >),
        languages: Object.fromEntries(
            Object.entries(languages).map(([language, c]) => [language, summarizeConfusion(c)])
        ),
        errors,
        pairErrors,
        orderDisagreements,
    };
}

export function evaluateNewsEventCorpus(corpus: NewsEventCorpus) {
    validateCorpus(corpus);
    const events = new Map(corpus.events.map((event) => [event.id, event]));
    const cohorts = [...new Set(corpus.events.map((event) => event.cohort))];
    const observedAt = Date.parse(corpus.snapshotAt);
    const recorded = Object.fromEntries(
        cohorts.map((cohort) => [
            cohort,
            evaluateCohort(
                corpus.reports.filter((report) => events.get(report.event)?.cohort === cohort),
                events,
                "recorded",
                observedAt
            ),
        ])
    );
    const totals = {
        pair: emptyConfusion(),
        batch: emptyConfusion(),
        hardBatch: emptyConfusion(),
        crossSourceBatch: emptyConfusion(),
        distinctArticleBatch: emptyConfusion(),
    };
    for (const result of Object.values(recorded)) {
        for (const name of Object.keys(totals) as Array<keyof typeof totals>) {
            for (const key of ["tp", "fp", "tn", "fn"] as const) totals[name][key] += result[name][key];
        }
    }
    const daily = corpus.reports.filter((report) => events.get(report.event)?.cohort === "daily");
    return {
        schemaVersion: corpus.schemaVersion,
        reportCount: corpus.reports.length,
        eventCount: corpus.events.length,
        sourceCount: new Set(corpus.reports.map((report) => report.source)).size,
        distinctArticleCount: new Set(corpus.reports.map((report) => normalizeNewsUrl(report.articleUrl))).size,
        labelStatus: corpus.labelStatus,
        snapshotAt: corpus.snapshotAt,
        recorded,
        totals: Object.fromEntries(Object.entries(totals).map(([name, c]) => [name, summarizeConfusion(c)])),
        // Sensitivity only: historical searches were not captured as one front page.
        adapterDaily: daily.length ? evaluateCohort(daily, events, "adapter-daily", observedAt) : null,
    };
}
