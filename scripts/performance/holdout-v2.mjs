// Offline draft builder only. Never invokes scoring or a production retriever.
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { rm, mkdir, readFile, writeFile } from "node:fs/promises";

export const INPUTS = {
    v1: ["test/fixtures/news-quality-holdout-candidate.json", "568b289ad198e7fa99503eac10bede855d824566"],
    old: ["test/fixtures/news-event-real-corpus.json", "dccb262113b8992b1de6b38744cf4b6384800bc3"],
    hybrid: ["test/fixtures/news-hybrid-search-queries.json", "d96899ee4f8f31000228c8a2410089e9d2319b7d"],
    literal: ["scripts/performance/chinese-search-cases.ts", "6bf8f2de0b4d5f92221fbc38721974fa55deb99b"],
};
const PLAN = "test/fixtures/news-quality-holdout-v2-plan.json";
const reportFields = ["id", "cohort", "source", "language", "title", "url", "articleUrl", "reportedAt", "timeKind", "evidenceUrl"];
const textKey = (s) => s.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
const nonempty = (x) => typeof x === "string" && x.trim() !== "";
const ensure = (ok, message) => { if (!ok) throw new Error(message); };
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const blobSha = (bytes) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const idValid = (s) => typeof s === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(s);
// Same normalization rules as shared/news-insights.ts at the pinned baseline.
// This is an additional local gate, not a replacement for the official guard.
export function normalizeUrl(value) {
    const u = new URL(value.trim());
    ensure(u.protocol === "https:" && !u.username && !u.password, "Expected HTTPS URL without credentials");
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^m\./, "").replace(/^www\./, "");
    for (const key of [...u.searchParams.keys()]) {
        if (/^(utm_|spm$|from$|ref$|source$|share$|fbclid$|gclid$|igshid$|yclid$)/i.test(key)) u.searchParams.delete(key);
    }
    const s = u.toString();
    return s.endsWith("/") && u.pathname !== "/" ? s.slice(0, -1) : s;
}
function unique(items, key, name) {
    const seen = new Set();
    for (const item of items) {
        const k = key(item);
        ensure(!seen.has(k), `Duplicate ${name}: ${k}`);
        seen.add(k);
    }
    return seen;
}
const counts = (items, key) => Object.fromEntries([...items.reduce((m, r) => m.set(key(r), (m.get(key(r)) ?? 0) + 1), new Map())].sort());
const project = (r, fields) => Object.fromEntries(fields.map(k => [k, r[k]]));
const json = (value) => JSON.stringify(value, null, 2) + "\n";

export function buildDraft(v1, old, oldQueries, plan) {
    ensure(v1.labelStatus === "unreviewed-candidate", "Unexpected V1 label status");
    ensure(plan.schemaVersion === 1 && Array.isArray(plan.blockers) && plan.blockers.length > 0, "Invalid plan");
    ensure(Number.isFinite(Date.parse(v1.snapshotAt)), "Invalid evaluation cutoff");
    const reportIds = unique(v1.reports, r => r.id, "V1 report ID");
    const queryIds = unique(v1.queries, q => q.id, "V1 query ID");
    const qr = plan.quarantineReports, qq = plan.quarantineQueries;
    for (const [id, reason] of Object.entries(qr)) ensure(reportIds.has(id) && nonempty(reason), `Unknown/unexplained quarantined report: ${id}`);
    for (const [id, reason] of Object.entries(qq)) ensure(queryIds.has(id) && nonempty(reason), `Unknown/unexplained quarantined query: ${id}`);
    for (const id of Object.keys(plan.reportNotes)) ensure(reportIds.has(id), `Unknown report note: ${id}`);
    const reports = v1.reports.filter(r => !Object.hasOwn(qr, r.id)).map(r => project(r, reportFields));
    for (const s of plan.supplements) {
        ensure(!reportIds.has(s.id) && nonempty(s.publisher) && nonempty(s.note) && nonempty(s.observedLocalTime), `Invalid supplement: ${s.id}`);
        ensure(/T\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(s.reportedAt), `Missing precise timestamp: ${s.id}`);
        reports.push(project({ ...s, articleUrl: s.url, evidenceUrl: s.url, timeKind: "published" }, reportFields));
    }
    const queries = v1.queries.filter(q => !Object.hasOwn(qq, q.id)).map(q => project(q, ["id","query"]));
    for (const q of plan.queries) {
        ensure(!queryIds.has(q.id), `Reused V1 query ID: ${q.id}`);
        queries.push(project(q, ["id","query"]));
    }
    ensure(reports.length >= 2 && reports.length <= 500 && queries.length >= 1 && queries.length <= 200, "Draft exceeds packet bounds");
    for (const r of reports) {
        ensure(idValid(r.id) && idValid(r.cohort) && nonempty(r.source) && nonempty(r.title) && ["zh","en"].includes(r.language) && ["published","submission"].includes(r.timeKind), `Invalid report: ${r.id}`);
        ensure(typeof r.reportedAt === "string" && Number.isFinite(Date.parse(r.reportedAt)) && Date.parse(r.reportedAt) <= Date.parse(v1.snapshotAt), `Invalid report time: ${r.id}`);
        [r.url, r.articleUrl, r.evidenceUrl].forEach(normalizeUrl);
    }
    for (const q of queries) ensure(idValid(q.id) && nonempty(q.query) && q.query.length <= 256, `Invalid query: ${q.id}`);
    unique(reports, r => r.id, "report ID");
    unique(reports, r => normalizeUrl(r.url), "report URL");
    unique(reports, r => normalizeUrl(r.articleUrl), "article URL");
    unique(queries, q => q.id, "query ID");
    unique(queries, q => textKey(q.query), "query text");
    const oldUrls = new Set(old.reports.flatMap(r => [normalizeUrl(r.url), normalizeUrl(r.articleUrl)]));
    const oldTitles = new Set(old.reports.map(r => textKey(r.title)));
    const oldTexts = new Set(oldQueries.map(textKey));
    for (const r of reports) ensure(!oldUrls.has(normalizeUrl(r.url)) && !oldUrls.has(normalizeUrl(r.articleUrl)) && !oldTitles.has(textKey(r.title)), `Exact baseline overlap: ${r.id}`);
    for (const q of queries) ensure(!oldTexts.has(textKey(q.query)), `Exact baseline query overlap: ${q.id}`);
    const dataset = { snapshotAt: v1.snapshotAt, selection: "V2 unreviewed draft; original evaluation cutoff retained. Not random production traffic. See restricted maintainer manifest.", labelStatus: "unreviewed-candidate", reports, queries };
    const additions = new Map(plan.supplements.map(s => [s.id, s]));
    const evidence = reports.map(r => {
        const s = additions.get(r.id);
        return { reportId: r.id, articleUrl: r.articleUrl, reportUrl: r.url, evidenceUrl: r.evidenceUrl, reportedAt: r.reportedAt, timeKind: r.timeKind,
            evidenceState: s ? "page-inspected-metadata-pending" : "inherited-unverified",
            rawResponseSha256: null, immutableCapture: null, finalUrl: null,
            note: s?.note ?? plan.reportNotes[r.id] ?? "Recheck original page and, for HN, submission evidence separately.",
            ...(s ? { publisher: s.publisher, observedLocalTime: s.observedLocalTime, reviewDate: plan.reviewDate } : {}) };
    });
    const manifest = { schemaVersion: 1, status: "blocked-draft", automaticAdmission: false, labelStatus: "unreviewed-candidate",
        evaluationCutoff: v1.snapshotAt, reviewDate: plan.reviewDate, datasetSha256: digest(json(dataset)),
        counts: { reports: reports.length, queries: queries.length, byCohortLanguage: counts(reports, r => `${r.cohort}:${r.language}`), bySource: counts(reports, r => r.source), queryLanguage: counts(queries, q => /\p{Script=Han}/u.test(q.query) ? /[a-z]/i.test(q.query) ? "mixed" : "zh" : "latin") },
        quarantineReports: qr, quarantineQueries: qq, evidence, inheritedCaptureMetadata: v1.captures ?? [], pendingSupplements: plan.pendingSupplements,
        blockers: plan.blockers, note: "Static checks only. Not reviewer evidence of independence, labels, predictions, or a packet digest. Do not distribute to reviewers." };
    return { dataset, manifest };
}

async function pinnedRead(root, name) {
    const [path, sha] = INPUTS[name];
    const bytes = await readFile(resolve(root, path));
    ensure(blobSha(bytes) === sha, `Baseline changed: ${path}; re-audit instead of silently reusing plan`);
    return bytes.toString("utf8");
}
export async function run(root, output) {
    const [v, o, h, l, p] = await Promise.all([pinnedRead(root,"v1"), pinnedRead(root,"old"), pinnedRead(root,"hybrid"), pinnedRead(root,"literal"), readFile(resolve(root, PLAN),"utf8")]);
    const oldQueries = [...JSON.parse(h).cases.map(q => q.query), ...Array.from(l.matchAll(/query: ("(?:[^"\\]|\\.)*")/gu), m => JSON.parse(m[1]))];
    ensure(oldQueries.length === 36, "Unexpected old query count");
    const v1 = JSON.parse(v), old = JSON.parse(o);
    ensure(v1.reports.length === 63 && v1.queries.length === 22 && old.reports.length === 73, "Unexpected baseline size");
    const { dataset, manifest } = buildDraft(v1, old, oldQueries, JSON.parse(p));
    manifest.inputBlobs = Object.fromEntries(Object.values(INPUTS));
    manifest.planSha256 = digest(p);
    // Fail if output already exists; never modify V1 or write labels. Create a private,
    // exclusive directory, clean up only our own directory on a write failure.
    const dest = resolve(output);
    await mkdir(dest, { mode: 0o700 });
    try {
        await writeFile(join(dest, "news-quality-holdout-candidate-v2.json"), json(dataset), { flag: "wx", mode: 0o600 });
        await writeFile(join(dest, "maintainer-manifest.json"), json(manifest), { flag: "wx", mode: 0o600 });
    } catch (e) { await rm(dest, { recursive: true, force: true }); throw e; }
    return { status: manifest.status, automaticAdmission: false, counts: manifest.counts, datasetSha256: manifest.datasetSha256 };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const [root, output, ...rest] = process.argv.slice(2);
    if (!root || !output || rest.length) { console.error("Usage: node scripts/performance/holdout-v2.mjs <repo-root> <new-output-directory>"); process.exitCode = 2; }
    else run(root, output).then(result => console.log(json(result))).catch(e => { console.error(e.message); process.exitCode = 1; });
}
