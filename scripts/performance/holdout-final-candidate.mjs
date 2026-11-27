// Final candidate revision for maintainer review, not approval or scoring.
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { rm, lstat, mkdir, readdir, mkdtemp, readFile, writeFile } from "node:fs/promises";

import { INPUTS, blobSha, buildDraft, normalizeUrl } from "./holdout-v2.mjs";
import { PINS, freeze, sha256, blankChecklist, inspectChecklist, followupReadiness } from "./holdout-admission.mjs";

const PLAN = "test/fixtures/news-quality-holdout-final-revision.json";
const PLAN_SHA = "538dc8d55bb260e591f650b7dc664af3b188122d3c54392a543f87ac343684a5";
const FOLLOWUP = "test/fixtures/news-quality-holdout-v2-evidence-followup.json";
const json = (x) => JSON.stringify(x, null, 2) + "\n";
const ensure = (ok, message) => { if (!ok) throw new Error(message); };
const text = (v) => typeof v === "string" && v.trim().length > 0;
const explicitTime = (v) => text(v) && /T\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));

function supplement(row, cutoff, earliestCapture) {
    const { report: r, evidence: e } = row;
    const id = r?.id;
    ensure(r && e && r.language === "zh" && ["daily", "release", "security"].includes(r.cohort) &&
        r.timeKind === "published" && r.url === r.articleUrl && r.url === r.evidenceUrl &&
        r.url === e.requestUrl && e.status === 200 && Number.isSafeInteger(e.bytes) &&
        e.bytes > 0 && e.bytes <= 2 * 1024 * 1024 && /^[a-f0-9]{64}$/.test(e.responseSha256) &&
        explicitTime(e.capturedAt) && Date.parse(e.capturedAt) >= earliestCapture &&
        explicitTime(r.reportedAt) && Date.parse(r.reportedAt) <= Date.parse(cutoff) &&
        text(e.note) && text(e.timeBasis) && text(e.observedTitle),
        "Invalid supplemental evidence: " + id);
    normalizeUrl(r.url);
    normalizeUrl(e.finalUrl);
    ensure(new URL(r.url).hostname === new URL(e.finalUrl).hostname, "Supplement redirect outside publisher: " + id);
    let matched = false;
    if (e.timeKind === "ithome-wall") {
        const m = typeof e.observedValue === "string" && /^(\d{4})\/(\d{1,2})\/(\d{1,2}) (\d{1,2}):(\d{2}):(\d{2})$/.exec(e.observedValue);
        const wall = m && m[1] + "-" + m[2].padStart(2,"0") + "-" + m[3].padStart(2,"0") + "T" +
            m[4].padStart(2,"0") + ":" + m[5] + ":" + m[6] + "+08:00";
        matched = r.source === "ithome" && new URL(r.url).hostname === "www.ithome.com" &&
            e.observedTitle === r.title + " - IT之家" && e.timeBasis === "publisher wall time; UTC+8 assumed, not independently confirmed" &&
            wall === r.reportedAt;
    } else if (e.timeKind === "tencent-epoch") {
        matched = r.source === "tencent-cloud-developer" && new URL(r.url).hostname === "developer.cloud.tencent.com" &&
            e.observedTitle === r.title + "-腾讯云开发者社区-腾讯云" &&
            Number.isSafeInteger(e.observedValue) && e.observedValue * 1000 === Date.parse(r.reportedAt);
    } else if (e.timeKind === "publisher-meta") {
        matched = r.source === "hk01" && new URL(r.url).hostname === "global.hk01.com" && e.observedTitle === r.title &&
            explicitTime(e.observedValue) && e.observedValue === r.reportedAt;
    }
    ensure(matched, "Supplement time/title evidence mismatch: " + id);
    return { ...r, publisher: r.source, note: e.note, observedLocalTime: String(e.observedValue) };
}

export function revise(base, readiness, capture, followup, old, oldQueries, plan) {
    ensure(plan.schemaVersion === 1 && plan.status === "blocked-draft" && plan.baseDatasetSha256 === PINS.candidate &&
        plan.baseFreezeSha256 === readiness.freezeSha256 && plan.baseFollowupSha256 === readiness.followupSha256 &&
        readiness.status === "blocked-draft" && readiness.automaticAdmission === false &&
        Array.isArray(plan.blockers) && plan.blockers.length > 0 && plan.blockers.every(text) &&
        Array.isArray(plan.supplements), "Invalid final revision provenance");
    const risks = new Map(readiness.reportsReadiness.map(r => [r.reportId, r]));
    for (const [id, reason] of Object.entries(plan.quarantineReports)) {
        const risk = risks.get(id);
        ensure(text(reason) && risk && (risk.article !== "captured" || risk.titleSignal === "title-needs-review" ||
            risk.timeSignal === "published-metadata-differs"), "Quarantine lacks observed risk: " + id);
    }
    // Known URL aliases of prior/retained reports plus current redirects. Check aliases
    // against each other before adding a new report; never use semantic predictions.
    const latest = new Map(capture.rows.filter(r => r.role === "article").map(r => [r.reportId, r]));
    for (const r of followup.rows.filter(r => r.role === "article")) latest.set(r.reportId, r);
    const used = new Set(old.reports.flatMap(r => [r.url, r.articleUrl].map(normalizeUrl)));
    const owners = new Map();
    function addAliases(r, finalUrl) {
        const aliases = new Set([r.url, r.articleUrl, ...(finalUrl ? [finalUrl] : [])].map(normalizeUrl));
        for (const u of aliases) {
            ensure(!used.has(u) && (!owners.has(u) || owners.get(u) === r.id), "Revision URL overlap: " + r.id);
            owners.set(u, r.id);
        }
    }
    const retained = base.reports.filter(r => !Object.hasOwn(plan.quarantineReports, r.id));
    for (const r of retained) {
        const a = latest.get(r.id);
        ensure(a?.state === "captured" && risks.get(r.id)?.article === "captured", "Unresolved retained article: " + r.id);
        addAliases(r, a.finalUrl);
    }
    const supplements = plan.supplements.map(row => {
        const s = supplement(row, base.snapshotAt, Date.parse(followup.finishedAt));
        addAliases(row.report, row.evidence.finalUrl);
        return s;
    });
    const result = buildDraft(base, old, oldQueries, {
        schemaVersion: 1, reviewDate: "2026-11-27",
        quarantineReports: plan.quarantineReports, quarantineQueries: plan.quarantineQueries,
        reportNotes: {}, supplements, queries: [], pendingSupplements: [], blockers: plan.blockers,
    });
    const dataset = result.dataset;
    dataset.selection = "Revised holdout candidate for maintainer review; known evidence risks quarantined; no formal labels or admission.";
    const historicalFeedUnavailable = retained.filter(r => risks.get(r.id)?.originalFeed === "historical-response-not-retained").length;
    const manifest = {
        schemaVersion: 1, status: "blocked-draft", automaticAdmission: false,
        baseFreezeSha256: plan.baseFreezeSha256, baseDatasetSha256: plan.baseDatasetSha256,
        baseFollowupSha256: plan.baseFollowupSha256, datasetSha256: sha256(json(dataset)),
        evaluationCutoff: dataset.snapshotAt, counts: result.manifest.counts,
        historicalFeedUnavailable, currentArticlesCaptured: dataset.reports.length,
        quarantineReports: plan.quarantineReports, quarantineQueries: plan.quarantineQueries,
        retainedReadiness: retained.map(r => risks.get(r.id)),
        supplementalEvidence: plan.supplements.map(row => ({ reportId: row.report.id, ...row.evidence })),
        blockers: plan.blockers,
        note: "Current metadata and response fingerprints only. Historical evidence, semantics, independent reviewers and explicit maintainer approval remain pending. Do not distribute this manifest to reviewers.",
    };
    return { dataset, manifest };
}

async function filesFor(root) {
    const temp = await mkdtemp(join(tmpdir(), "latestnews-final-candidate-"));
    try {
        const baseDir = join(temp, "base");
        await freeze(root, baseDir);
        const readiness = await followupReadiness(root, baseDir);
        const [baseRaw, captureRaw, followupRaw, planRaw] = await Promise.all([
            readFile(join(baseDir, "candidate.json")), readFile(join(baseDir, "current-evidence.json")),
            readFile(resolve(root, FOLLOWUP)), readFile(resolve(root, PLAN)),
        ]);
        ensure(sha256(baseRaw) === PINS.candidate && sha256(captureRaw) === PINS.evidence &&
            sha256(followupRaw) === readiness.followupSha256 && sha256(planRaw) === PLAN_SHA,
            "Pinned revision inputs changed");
        const [old, hybrid, literal] = await Promise.all(["old", "hybrid", "literal"].map(async name => {
            const [path, expected] = INPUTS[name];
            const raw = await readFile(resolve(root, path));
            ensure(blobSha(raw) === expected, "Old baseline changed: " + path);
            return raw.toString("utf8");
        }));
        const oldQueries = [...JSON.parse(hybrid).cases.map(q => q.query), ...Array.from(literal.matchAll(/query: ("(?:[^"\\]|\\.)*")/gu), m => JSON.parse(m[1]))];
        ensure(oldQueries.length === 36, "Old query inventory changed");
        const { dataset, manifest } = revise(JSON.parse(baseRaw), readiness, JSON.parse(captureRaw), JSON.parse(followupRaw),
            JSON.parse(old), oldQueries, JSON.parse(planRaw));
        manifest.revisionPlanSha256 = PLAN_SHA;
        const files = {
            "candidate.json": Buffer.from(json(dataset)),
            "maintainer-manifest.json": Buffer.from(json(manifest)),
        };
        files["freeze.json"] = Buffer.from(json({
            schemaVersion: 1, kind: "blocked-holdout-final-candidate", status: "blocked-draft", automaticAdmission: false,
            baseFreezeSha256: manifest.baseFreezeSha256,
            files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, { bytes: bytes.length, sha256: sha256(bytes) }])),
        }));
        const freezeSha256 = sha256(files["freeze.json"]);
        files["admission-review.blank.json"] = Buffer.from(json(blankChecklist(dataset, freezeSha256)));
        return {
            files,
            summary: { status: "blocked-draft", automaticAdmission: false, freezeSha256, datasetSha256: manifest.datasetSha256,
                counts: manifest.counts, historicalFeedUnavailable: manifest.historicalFeedUnavailable,
                currentArticlesCaptured: manifest.currentArticlesCaptured,
                quarantined: Object.keys(manifest.quarantineReports), added: manifest.supplementalEvidence.map(r => r.reportId) },
        };
    } finally { await rm(temp, { recursive: true, force: true }); }
}

export async function freezeFinal(root, output) {
    const { files, summary } = await filesFor(root);
    const dest = resolve(output);
    await mkdir(dest, { mode: 0o700 });
    try {
        for (const [name, bytes] of Object.entries(files)) await writeFile(join(dest, name), bytes, { flag: "wx", mode: 0o600 });
    } catch (e) {
        await rm(dest, { recursive: true, force: true });
        throw e;
    }
    return summary;
}
export async function verifyFinal(root, dir) {
    const { files, summary } = await filesFor(root);
    ensure((await lstat(dir)).isDirectory(), "Expected real freeze directory");
    ensure(JSON.stringify((await readdir(dir)).sort()) === JSON.stringify(Object.keys(files).sort()), "Unexpected final freeze file set");
    for (const [name, bytes] of Object.entries(files)) {
        const path = join(dir, name);
        ensure((await lstat(path)).isFile() && (await readFile(path)).equals(bytes), "Final frozen bytes changed: " + name);
    }
    return summary;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const [command, root, dir, reviewPath, ...rest] = process.argv.slice(2);
    if (!root || !dir || rest.length || !["freeze", "verify", "inspect-review"].includes(command) ||
        (command === "inspect-review" ? !reviewPath : reviewPath !== undefined)) {
        console.error("Usage: holdout-final-candidate.mjs freeze|verify <repo-root> <new/frozen-dir> | inspect-review <repo-root> <freeze-dir> <maintainer-review.json>");
        process.exitCode = 2;
    } else {
        (async () => {
            if (command === "freeze") return freezeFinal(root, dir);
            const result = await verifyFinal(root, dir);
            if (command === "verify") return result;
            return inspectChecklist(JSON.parse(await readFile(join(dir, "admission-review.blank.json"), "utf8")),
                JSON.parse(await readFile(reviewPath, "utf8")));
        })().then(r => console.log(json(r))).catch(e => { console.error(e.message); process.exitCode = 1; });
    }
}
