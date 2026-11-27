// Offline evidence freeze; no reviewer labels, scoring or production changes.
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { rm, lstat, mkdir, readdir, mkdtemp, readFile, writeFile } from "node:fs/promises";

import { normalizeUrl } from "./holdout-v2.mjs";
import { run as buildCoverage } from "./holdout-coverage.mjs";

export const PINS = Object.freeze({
    candidate: "43fd4e225559996704ecc6fd504a152c7b4011325ca6b2ca2cdd5b90f5671c79",
    manifest: "713ea328593f52fec466e173e799070f1689f7c8d7dd7648d52a2d1068e1eefc",
    evidence: "9215e597254f3f4b5b9e90e12e314cd228890fc98de5123015242e11aaa58010",
});
const SOURCE = "test/fixtures/news-quality-holdout-v2-current-evidence.json";
const OLD = "test/fixtures/news-event-real-corpus.json";
const MAX_BYTES = 2 * 1024 * 1024;
const json = (x) => JSON.stringify(x, null, 2) + "\n";
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const ensure = (ok, message) => { if (!ok) throw new Error(message); };
const text = (v) => typeof v === "string" && v.trim().length > 0;
const hash = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const key = (s) => s.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
const titleKey = (s) => key(s).replace(/[‘’]/gu, "'").replace(/[“”]/gu, '"');
const timestamp = (s) => typeof s === "string" && /T\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(s) && Number.isFinite(Date.parse(s));
const counts = (rows, get) => Object.fromEntries([...rows.reduce((m, r) => m.set(get(r), (m.get(get(r)) ?? 0) + 1), new Map())].sort());
const pairKey = (id, role) => id + ":" + role;
const roles = (r) => [
    ["article", r.articleUrl],
    ...(r.timeKind === "submission" ? [["discussion", r.url], ["hn-item", r.evidenceUrl]]
        : r.source === "github-release" ? [["release-api", r.evidenceUrl]] : []),
];
const states = new Set(["captured", "http-error", "network-error", "too-large", "metadata-error", "empty"]);
const timeFields = new Set(["article:published_time", "og:published_time", "datepublished", "publishdate", "pubdate", "dc.date.issued"]);

function validateObservation(row, expected, capture) {
    const name = pairKey(row.reportId, row.role);
    ensure(row.requestUrl === expected && states.has(row.state) &&
        timestamp(row.capturedAt) && Date.parse(row.capturedAt) >= Date.parse(capture.startedAt) &&
        Date.parse(row.capturedAt) <= Date.parse(capture.finishedAt),
    "Invalid observation identity or chronology: " + name);
    normalizeUrl(row.requestUrl);
    if (row.finalUrl !== null) normalizeUrl(row.finalUrl);
    ensure(row.status === null || Number.isInteger(row.status) && row.status >= 100 && row.status <= 599,
        "Invalid HTTP status: " + name);
    ensure(row.bytes === null && row.responseSha256 === null ||
        Number.isSafeInteger(row.bytes) && row.bytes >= 0 && row.bytes <= MAX_BYTES && hash(row.responseSha256),
    "Invalid response fingerprint: " + name);
    if (row.state === "captured") {
        ensure(row.status === 200 && row.finalUrl && row.bytes > 0 && hash(row.responseSha256) &&
            row.error === null && row.observed && typeof row.observed === "object",
        "Invalid captured response: " + name);
        if (row.role === "article" || row.role === "discussion") {
            const o = row.observed;
            ensure(o.title === null || text(o.title) && o.title.length <= 500, "Invalid observed title: " + name);
            ensure(Array.isArray(o.publishedMetadata) && o.publishedMetadata.length <= 12 &&
                o.publishedMetadata.every(v => text(v.field) && text(v.value) && v.value.length <= 160) &&
                (o.solidotWallTime === null || /^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(o.solidotWallTime)),
            "Invalid observed page metadata: " + name);
        } else ensure(row.observed.api && typeof row.observed.api === "object" && !Array.isArray(row.observed.api),
            "Missing API metadata: " + name);
    } else {
        ensure(row.observed === null, "Failure cannot contain accepted metadata: " + name);
        if (row.state === "http-error") ensure(row.status !== null && row.status !== 200, "Invalid HTTP failure: " + name);
        if (row.state === "network-error") ensure(text(row.error), "Missing network error: " + name);
    }
}
function checkHn(r, item) {
    if (item?.state !== "captured") return "unavailable";
    const a = item.observed.api;
    const id = new URL(r.url).searchParams.get("id");
    if (String(a.id) !== id || a.type !== "story" || !text(a.title) || !text(a.url) || !timestamp(a.created_at)) return "mismatch";
    try {
        return key(a.title) === key(r.title) && normalizeUrl(a.url) === normalizeUrl(r.articleUrl) &&
            Date.parse(a.created_at) === Date.parse(r.reportedAt) ? "matched" : "mismatch";
    } catch { return "mismatch"; }
}
function checkRelease(r, item) {
    if (item?.state !== "captured") return "unavailable";
    const a = item.observed.api;
    return Number.isSafeInteger(a.id) && a.id > 0 && a.name === r.title && text(a.tag_name) &&
        r.url.endsWith("/releases/tag/" + a.tag_name) && r.evidenceUrl.endsWith("/releases/tags/" + a.tag_name) &&
        a.html_url === r.articleUrl && a.draft === false && a.prerelease === false &&
        timestamp(a.published_at) && Date.parse(a.published_at) === Date.parse(r.reportedAt) ? "matched" : "mismatch";
}
function pageTime(r, article) {
    if (article?.state !== "captured") return "unavailable";
    const o = article.observed;
    if (o.solidotWallTime !== null) return "wall-minute-timezone-unconfirmed";
    const explicit = [...new Set(o.publishedMetadata.filter(x => timeFields.has(x.field) && timestamp(x.value)).map(x => Date.parse(x.value)))];
    if (explicit.length > 1) return "ambiguous-publisher-time";
    if (explicit.length === 1) return explicit[0] === Date.parse(r.reportedAt) ? "published-metadata-matched" : "published-metadata-differs";
    return "publisher-time-unconfirmed";
}

// Audit signals only. A matching title, time or HTTP 200 is not a semantic judgment.
export function auditEvidence(dataset, capture, old) {
    ensure(capture.schemaVersion === 1 && capture.datasetSha256 === PINS.candidate &&
        timestamp(capture.startedAt) && timestamp(capture.finishedAt) &&
        Date.parse(capture.startedAt) >= Date.parse(dataset.snapshotAt) &&
        Date.parse(capture.finishedAt) >= Date.parse(capture.startedAt) &&
        capture.maxBytes === MAX_BYTES && Array.isArray(capture.rows), "Invalid current capture header");
    const expected = new Map(dataset.reports.flatMap(r => roles(r).map(([role, url]) => [pairKey(r.id, role), url])));
    const records = new Map();
    for (const row of capture.rows) {
        const k = pairKey(row.reportId, row.role);
        ensure(expected.has(k) && !records.has(k), "Unknown or duplicate observation: " + k);
        validateObservation(row, expected.get(k), capture);
        records.set(k, row);
    }
    ensure(records.size === expected.size, "Missing observation rows");
    const prior = capture.supersededObservations ?? [];
    ensure(Array.isArray(prior), "Invalid superseded observations");
    const priorKeys = new Set();
    for (const row of prior) {
        const k = pairKey(row.reportId, row.role);
        ensure(expected.has(k) && !priorKeys.has(k) && row.role === "article" &&
            row.state === "captured" && row.observed?.title?.length === 500,
        "Invalid superseded observation: " + k);
        validateObservation(row, expected.get(k), capture);
        ensure(Date.parse(row.capturedAt) <= Date.parse(records.get(k).capturedAt), "Invalid refresh chronology: " + k);
        priorKeys.add(k);
    }
    const oldUrls = new Set(old.reports.flatMap(r => [normalizeUrl(r.url), normalizeUrl(r.articleUrl)]));
    const owners = new Map();
    function addOwner(url, id) {
        const alias = normalizeUrl(url);
        if (!owners.has(alias)) owners.set(alias, new Set());
        owners.get(alias).add(id);
    }
    for (const r of dataset.reports) {
        addOwner(r.url, r.id);
        addOwner(r.articleUrl, r.id);
        const a = records.get(pairKey(r.id, "article"));
        if (a.state === "captured") addOwner(a.finalUrl, r.id);
    }
    const aliasRisks = [...owners.entries()].filter(([url, ids]) => ids.size > 1 || oldUrls.has(url))
        .map(([url, ids]) => ({ url, reportIds: [...ids].sort(), oldCorpusOverlap: oldUrls.has(url) }))
        .sort((a, b) => a.url.localeCompare(b.url, "en"));
    const reports = dataset.reports.map(r => {
        const a = records.get(pairKey(r.id, "article"));
        const d = records.get(pairKey(r.id, "discussion"));
        const h = records.get(pairKey(r.id, "hn-item"));
        const g = records.get(pairKey(r.id, "release-api"));
        const observedTitle = a.observed?.title ?? null;
        const titleSignal = a.state !== "captured" ? "unavailable" : !observedTitle ? "no-title"
            : r.timeKind === "submission" ? "hn-title-not-publisher-title"
            : titleKey(observedTitle).includes(titleKey(r.title)) ? "candidate-title-contained" : "title-needs-review";
        const identity = h ? checkHn(r, h) : g ? checkRelease(r, g) : "not-applicable";
        return {
            reportId: r.id,
            article: a.state,
            discussion: d?.state ?? "not-applicable",
            api: h?.state ?? g?.state ?? "not-applicable",
            titleSignal, identity,
            timeSignal: h ? "hn-submission-" + identity : g ? "release-publication-" + identity : pageTime(r, a),
            originalFeed: !h && !g && r.evidenceUrl !== r.articleUrl ? "historical-response-not-retained" : "not-applicable",
            aliasRisk: aliasRisks.some(x => x.reportIds.includes(r.id)),
            historicalEvidence: "pending-human-verification",
            eventDisjointness: "pending-human-verification",
        };
    });
    return {
        status: "blocked-draft", automaticAdmission: false,
        datasetSha256: capture.datasetSha256,
        attempts: capture.rows.length + prior.length, latestObservations: capture.rows.length,
        supersededObservations: prior.length, byAttemptState: counts([...capture.rows, ...prior], r => r.state),
        byRoleState: counts(capture.rows, r => r.role + ":" + r.state),
        byIdentity: counts(reports, r => r.identity),
        byTimeSignal: counts(reports, r => r.timeSignal),
        byTitleSignal: counts(reports, r => r.titleSignal),
        historicalFeedUnavailable: reports.filter(r => r.originalFeed === "historical-response-not-retained").length,
        allCurrentRolesCaptured: reports.filter(r => [r.article, r.discussion, r.api].every(v => ["captured", "not-applicable"].includes(v))).length,
        aliasRisks, reports,
        note: "Current extracted metadata is not historical evidence; no event/relevance/no-answer labels or admission decision.",
    };
}
const globalGates = [
    "historical-evidence-and-capture-policy",
    "tuning-exposure-and-independence",
    "language-source-hard-case-coverage",
    "single-primary-action-and-query-intent-rules",
    "separate-reviewers-and-blind-packet-distribution",
];
const pending = () => ({ decision: "pending", reason: "", evidenceRef: "" });
export function blankChecklist(dataset, freezeSha) {
    return {
        schemaVersion: 1, freezeSha256: freezeSha, maintainer: "",
        reports: dataset.reports.map(r => ({ reportId: r.id, evidence: pending(), timestamp: pending(), eventDisjointness: pending() })),
        queries: dataset.queries.map(q => ({ queryId: q.id, intentIndependence: pending() })),
        gates: globalGates.map(id => ({ id, ...pending() })),
    };
}
// This only validates completeness of a maintainer-authored checklist.
// Even fully resolved declarations do not authorize review or prove authenticity.
export function inspectChecklist(blank, review) {
    ensure(review.schemaVersion === 1 && review.freezeSha256 === blank.freezeSha256 &&
        typeof review.maintainer === "string", "Checklist does not bind to this freeze");
    const unresolved = [];
    const resolved = [];
    let submitted = 0;
    function decision(d, name) {
        ensure(d && ["pending", "resolved", "blocked"].includes(d.decision) &&
            typeof d.reason === "string" && typeof d.evidenceRef === "string", "Invalid checklist decision: " + name);
        if (d.decision !== "pending") {
            ensure(text(d.reason) && text(d.evidenceRef), "Missing decision evidence: " + name);
            submitted++;
        }
        (d.decision === "resolved" ? resolved : unresolved).push(name);
    }
    function match(expected, actual, field, visit) {
        ensure(Array.isArray(actual) && actual.length === expected.length, "Incomplete checklist: " + field);
        const map = new Map(actual.map(row => [row[field], row]));
        ensure(map.size === actual.length, "Duplicate checklist ID: " + field);
        for (const row of expected) {
            const r = map.get(row[field]);
            ensure(r, "Unknown/missing checklist ID: " + row[field]);
            visit(r);
        }
    }
    match(blank.reports, review.reports, "reportId", r => {
        for (const field of ["evidence", "timestamp", "eventDisjointness"]) decision(r[field], r.reportId + ":" + field);
    });
    match(blank.queries, review.queries, "queryId", q => decision(q.intentIndependence, q.queryId + ":intent"));
    match(blank.gates, review.gates, "id", g => decision(g, "gate:" + g.id));
    if (submitted) ensure(text(review.maintainer), "Maintainer identity required for submitted entries");
    return {
        status: unresolved.length ? "blocked-draft" : "awaiting-explicit-maintainer-decision",
        automaticAdmission: false, freezeSha256: blank.freezeSha256,
        resolvedDeclarations: resolved.length, unresolvedDeclarations: unresolved.length, unresolved,
        note: "Declaration completeness only; does not authenticate a maintainer or authorize scoring/packet distribution.",
    };
}

async function expectedFiles(root) {
    const work = await mkdtemp(join(tmpdir(), "latestnews-admission-"));
    try {
        const input = join(work, "coverage");
        await buildCoverage(root, input);
        const [candidate, manifest, evidence, old] = await Promise.all([
            readFile(join(input, "news-quality-holdout-candidate-v2-expanded.json")),
            readFile(join(input, "maintainer-manifest.json")),
            readFile(resolve(root, SOURCE)),
            readFile(resolve(root, OLD), "utf8"),
        ]);
        for (const [name, bytes] of Object.entries({ candidate, manifest, evidence }))
            ensure(sha256(bytes) === PINS[name], "Pinned input changed: " + name);
        const dataset = JSON.parse(candidate), m = JSON.parse(manifest);
        ensure(dataset.labelStatus === "unreviewed-candidate" && m.status === "blocked-draft" &&
            m.automaticAdmission === false && m.datasetSha256 === PINS.candidate, "Unexpected candidate status");
        const audit = auditEvidence(dataset, JSON.parse(evidence), JSON.parse(old));
        const files = {
            "candidate.json": candidate,
            "maintainer-manifest.json": manifest,
            "current-evidence.json": evidence,
            "readiness.json": Buffer.from(json(audit)),
        };
        const descriptor = {
            schemaVersion: 1, kind: "blocked-holdout-freeze", status: "blocked-draft", automaticAdmission: false,
            datasetSha256: PINS.candidate, files: Object.fromEntries(Object.entries(files).map(([name, bytes]) =>
                [name, { bytes: bytes.length, sha256: sha256(bytes) }])),
        };
        files["freeze.json"] = Buffer.from(json(descriptor));
        files["admission-review.blank.json"] = Buffer.from(json(blankChecklist(dataset, sha256(files["freeze.json"]))));
        return { files, audit };
    } finally { await rm(work, { recursive: true, force: true }); }
}
function summary(files, audit) {
    return { status: "blocked-draft", automaticAdmission: false, freezeSha256: sha256(files["freeze.json"]),
        datasetSha256: PINS.candidate, reports: audit.reports.length, queries: JSON.parse(files["candidate.json"]).queries.length,
        attempts: audit.attempts, latestObservations: audit.latestObservations,
        supersededObservations: audit.supersededObservations, byAttemptState: audit.byAttemptState,
        byRoleState: audit.byRoleState, byIdentity: audit.byIdentity,
        byTimeSignal: audit.byTimeSignal, byTitleSignal: audit.byTitleSignal,
        historicalFeedUnavailable: audit.historicalFeedUnavailable, allCurrentRolesCaptured: audit.allCurrentRolesCaptured,
        aliasRisks: audit.aliasRisks.length };
}
export async function freeze(root, output) {
    const { files, audit } = await expectedFiles(root);
    const dest = resolve(output);
    await mkdir(dest, { mode: 0o700 });
    try {
        for (const [name, bytes] of Object.entries(files)) await writeFile(join(dest, name), bytes, { flag: "wx", mode: 0o600 });
    } catch (e) {
        await rm(dest, { recursive: true, force: true });
        throw e;
    }
    return summary(files, audit);
}
export async function verify(root, dir) {
    const { files, audit } = await expectedFiles(root);
    ensure((await lstat(dir)).isDirectory(), "Expected real freeze directory");
    const actual = (await readdir(dir)).sort();
    const expected = Object.keys(files).sort();
    ensure(JSON.stringify(actual) === JSON.stringify(expected), "Unexpected freeze file set");
    for (const [name, bytes] of Object.entries(files)) {
        const path = join(dir, name);
        ensure((await lstat(path)).isFile(), "Not a regular freeze file: " + name);
        ensure((await readFile(path)).equals(bytes), "Frozen bytes changed: " + name);
    }
    return summary(files, audit);
}
// Supplemental evidence is a separately pinned derived view. Never replace the freeze.
const FOLLOWUP = "test/fixtures/news-quality-holdout-v2-evidence-followup.json";
const FOLLOWUP_SHA = "a6226f00df1f49955a349358b9b44a1f7724044c20ecd652300418c399786be2";
export async function followupReadiness(root, dir) {
    const base = await verify(root, dir);
    const [datasetBytes, captureBytes, oldBytes, followupBytes] = await Promise.all([
        readFile(join(dir, "candidate.json")),
        readFile(join(dir, "current-evidence.json")),
        readFile(resolve(root, OLD)),
        readFile(resolve(root, FOLLOWUP)),
    ]);
    ensure(sha256(followupBytes) === FOLLOWUP_SHA, "Pinned follow-up evidence changed");
    ensure(sha256(datasetBytes) === PINS.candidate && sha256(captureBytes) === PINS.evidence,
        "Frozen input changed after verification");
    const dataset = JSON.parse(datasetBytes), capture = JSON.parse(captureBytes);
    const supplement = JSON.parse(followupBytes);
    ensure(supplement.schemaVersion === 1 && supplement.datasetSha256 === PINS.candidate &&
        supplement.baseEvidenceSha256 === PINS.evidence && supplement.baseFreezeSha256 === base.freezeSha256 &&
        timestamp(supplement.startedAt) && timestamp(supplement.finishedAt) &&
        Date.parse(supplement.startedAt) >= Date.parse(capture.finishedAt) &&
        Date.parse(supplement.finishedAt) >= Date.parse(supplement.startedAt), "Invalid follow-up provenance");
    const failed = new Map(capture.rows.filter(r => r.state !== "captured").map(r => [pairKey(r.reportId, r.role), r]));
    const updates = new Map(), alternatives = new Set();
    for (const r of supplement.rows) {
        if (r.role === "hn-firebase") {
            ensure(failed.has(pairKey(r.reportId, "hn-item")) && !alternatives.has(r.reportId),
                "Unexpected alternate HN observation");
            alternatives.add(r.reportId);
            continue; // Only the original role can replace a failed original position.
        }
        const k = pairKey(r.reportId, r.role);
        ensure(failed.has(k) && !updates.has(k) && r.requestUrl === failed.get(k).requestUrl,
            "Unexpected primary follow-up observation");
        updates.set(k, r);
    }
    ensure(updates.size === failed.size && alternatives.size === [...failed.values()].filter(r => r.role === "hn-item").length,
        "Incomplete follow-up observation set");
    const derived = {
        ...capture,
        finishedAt: supplement.finishedAt,
        rows: capture.rows.map(r => updates.get(pairKey(r.reportId, r.role)) ?? r),
    };
    const audit = auditEvidence(dataset, derived, JSON.parse(oldBytes));
    // Original RSS UTC times provide a cross-check; expansion timestamps were
    // constructed using the assumption itself and are not independent evidence.
    const articleById = new Map(derived.rows.filter(r => r.role === "article").map(r => [r.reportId, r]));
    const solidotTimeChecks = dataset.reports.filter(r => r.source === "solidot").map(r => {
        const wall = articleById.get(r.id)?.observed?.solidotWallTime ?? null;
        const plusEight = new Date(Date.parse(r.reportedAt) + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", " ");
        return {
            reportId: r.id,
            basis: r.evidenceUrl !== r.articleUrl ? "original-rss-derived-utc" : "assumed-utc-plus-eight",
            observedWallTime: wall, utcPlusEightMinute: plusEight,
            matches: wall === null ? null : wall === plusEight,
        };
    });
    return {
        status: "blocked-draft", automaticAdmission: false,
        freezeSha256: base.freezeSha256, followupSha256: FOLLOWUP_SHA,
        reports: base.reports, queries: base.queries,
        baseAttempts: base.attempts, followupAttempts: supplement.rows.length,
        totalObservationAttempts: base.attempts + supplement.rows.length,
        originalPositions: derived.rows.length,
        originalPositionsCaptured: derived.rows.filter(r => r.state === "captured").length,
        byRoleState: audit.byRoleState, byIdentity: audit.byIdentity, byTimeSignal: audit.byTimeSignal,
        byTitleSignal: audit.byTitleSignal, allCurrentRolesCaptured: audit.allCurrentRolesCaptured,
        historicalFeedUnavailable: audit.historicalFeedUnavailable, aliasRisks: audit.aliasRisks,
        reportsReadiness: audit.reports, solidotTimeChecks,
        note: "Derived current observation view only. Alternate API identity is checked by the separate follow-up verifier; historical evidence and human declarations remain pending.",
    };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const [command, root, dir, reviewPath, ...rest] = process.argv.slice(2);
    if (!root || !dir || rest.length || !["freeze", "verify", "inspect-review", "followup"].includes(command) ||
        (command === "inspect-review" ? !reviewPath : reviewPath !== undefined)) {
        console.error("Usage: node scripts/performance/holdout-admission.mjs freeze|verify|followup <repo-root> <freeze-dir> | inspect-review <repo-root> <freeze-dir> <maintainer-review.json>");
        process.exitCode = 2;
    } else {
        (async () => {
            if (command === "freeze") return freeze(root, dir);
            if (command === "followup") return followupReadiness(root, dir);
            const result = await verify(root, dir);
            if (command === "verify") return result;
            const blank = JSON.parse(await readFile(join(dir, "admission-review.blank.json"), "utf8"));
            return inspectChecklist(blank, JSON.parse(await readFile(reviewPath, "utf8")));
        })().then(r => console.log(json(r))).catch(e => { console.error(e.message); process.exitCode = 1; });
    }
}
