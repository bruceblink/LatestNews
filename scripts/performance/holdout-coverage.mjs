// Expand a blocked V2 draft. Never run the retriever or scoring.
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { rm, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";

import { INPUTS, blobSha, buildDraft, normalizeUrl, run as buildV2 } from "./holdout-v2.mjs";

const PLAN = "test/fixtures/news-quality-holdout-v2-plan.json";
const COVERAGE = "test/fixtures/news-quality-holdout-v2-coverage.json";
const PLAN_BLOB = "159992751a59911cc5c5cde23ee92c78d305e417";
const BASE_DIGEST = "f91e0f36afcd98ddd29d228c3179ba769e9913ab01016be582648ff748668bd8";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => JSON.stringify(value, null, 2) + "\n";
const ensure = (ok, message) => { if (!ok) throw new Error(message); };
const isText = (x) => typeof x === "string" && x.trim().length > 0;
const isHash = (x) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);

function validateCapture(c, url, id) {
    ensure(c && c.requestUrl === url && c.status === 200 && Number.isSafeInteger(c.bytes) &&
        c.bytes > 0 && isHash(c.responseSha256) && Number.isFinite(Date.parse(c.capturedAt)),
    "Invalid capture: " + id);
    normalizeUrl(c.requestUrl);
    normalizeUrl(c.finalUrl);
}

function validateRow(row) {
    const { report: r, evidence: e } = row;
    ensure(r && e && isText(e.observedTitle) && isText(e.note) && Array.isArray(e.captures),
        "Missing evidence: " + r?.id);
    ensure(["release", "security"].includes(r.cohort) &&
        /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(r.reportedAt),
        "Invalid coverage stratum or time: " + r.id);
    validateCapture(e.captures[0], r.evidenceUrl, r.id);
    switch (e.kind) {
        case "publisher-page": {
            ensure(r.source === "solidot" && r.language === "zh" && r.timeKind === "published" &&
                r.url === r.articleUrl && r.url === r.evidenceUrl && e.captures.length === 1 &&
                e.observedTitle === "奇客Solidot | " + r.title && e.timePrecision === "minute" &&
                e.timezone === "Asia/Shanghai (assumed, not confirmed by page)" &&
                /^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(e.observedWallTime) &&
                r.reportedAt === e.observedWallTime.replace(" ", "T") + ":00+08:00",
            "Invalid minute-precision publisher evidence: " + r.id);
            break;
        }
        case "hn-item-and-publisher-page": {
            const h = e.observedSubmission;
            ensure(h && Number.isSafeInteger(h.id) && h.id > 0 && h.type === "story" &&
                h.title === r.title && h.url === r.articleUrl && h.created_at === r.reportedAt &&
                r.source === "hackernews" && r.language === "en" && r.timeKind === "submission" &&
                r.url === "https://news.ycombinator.com/item?id=" + h.id &&
                r.evidenceUrl === "https://hn.algolia.com/api/v1/items/" + h.id &&
                e.captures.length === 2 && e.timePrecision === "second" && e.timezone === "UTC" &&
                r.reportedAt.endsWith("Z"), "Invalid HN evidence: " + r.id);
            validateCapture(e.captures[1], r.articleUrl, r.id);
            break;
        }
        case "github-release-and-publisher-page": {
            const g = e.observedRelease;
            ensure(g && Number.isSafeInteger(g.id) && g.id > 0 && g.name === r.title &&
                isText(g.tag_name) && g.published_at === r.reportedAt && g.html_url === r.url &&
                !g.draft && g.draft === false && g.prerelease === false &&
                r.source === "github-release" && r.language === "en" && r.timeKind === "published" &&
                r.url === r.articleUrl && r.url.startsWith("https://github.com/") &&
                r.evidenceUrl.startsWith("https://api.github.com/repos/") &&
                r.evidenceUrl.endsWith("/releases/tags/" + g.tag_name) &&
                r.url.endsWith("/releases/tag/" + g.tag_name) &&
                e.captures.length === 2 && e.timePrecision === "second" && e.timezone === "UTC" &&
                r.reportedAt.endsWith("Z"), "Invalid release evidence: " + r.id);
            validateCapture(e.captures[1], r.articleUrl, r.id);
            break;
        }
        default: throw new Error("Unknown evidence kind: " + r.id);
    }
    ensure(e.captures.every(c => Date.parse(c.capturedAt) >= Date.parse(r.reportedAt)),
        "Invalid capture chronology: " + r.id);
    return e.captures.at(-1).finalUrl;
}

// Reuse the strict V2 projection and baseline checks for the combined corpus.
// Only the private manifest carries candidate provenance; it is not a reviewer input.
export function expand(base, baseManifest, old, oldQueries, extension) {
    ensure(base.labelStatus === "unreviewed-candidate" && baseManifest.status === "blocked-draft" &&
        baseManifest.automaticAdmission === false && baseManifest.datasetSha256 === sha(json(base)),
        "Base draft/manifest mismatch");
    ensure(extension.schemaVersion === 1 && extension.status === "blocked-draft" &&
        Array.isArray(extension.rows) && extension.rows.length > 0 &&
        Array.isArray(extension.queries) && Array.isArray(extension.blockers) &&
        extension.blockers.length > 0 && extension.blockers.every(isText) && Array.isArray(extension.excluded),
        "Invalid expansion");
    const existingUrls = new Set([...old.reports, ...base.reports].flatMap(r =>
        [normalizeUrl(r.url), normalizeUrl(r.articleUrl)]));
    const aliases = new Set();
    for (const row of extension.rows) {
        const final = validateRow(row);
        const urls = new Set([row.report.url, row.report.articleUrl, final].map(normalizeUrl));
        for (const url of urls) {
            ensure(!existingUrls.has(url) && !aliases.has(url), "Underlying redirect overlap: " + row.report.id);
            aliases.add(url);
        }
    }
    const combined = {
        ...base,
        reports: [...base.reports, ...extension.rows.map(r => r.report)],
        queries: [...base.queries, ...extension.queries],
    };
    const { dataset, manifest: checked } = buildDraft(combined, old, oldQueries, {
        schemaVersion: 1, reviewDate: baseManifest.reviewDate,
        quarantineReports: {}, quarantineQueries: {}, reportNotes: {}, supplements: [],
        queries: [], pendingSupplements: [], blockers: extension.blockers,
    });
    dataset.selection = "Expanded blocked V2 draft; historical targeted coverage, original cutoff retained. No event or relevance labels.";
    const manifest = {
        ...baseManifest,
        status: "blocked-draft", automaticAdmission: false,
        baseDatasetSha256: baseManifest.datasetSha256,
        datasetSha256: sha(json(dataset)),
        counts: checked.counts,
        expansion: {
            reports: extension.rows.length, queries: extension.queries.length,
            excluded: extension.excluded, selection: extension.selection,
            evidence: extension.rows.map(row => ({ ...row.evidence, reportId: row.report.id })),
        },
        blockers: [...baseManifest.blockers, ...extension.blockers],
        note: "Static data and current capture checks only. No historical proof or independent labels. Do not distribute manifest to reviewers.",
    };
    return { dataset, manifest };
}

export async function run(root, output) {
    const [plan, rawExtension] = await Promise.all([readFile(resolve(root, PLAN)), readFile(resolve(root, COVERAGE), "utf8")]);
    ensure(blobSha(plan) === PLAN_BLOB, "Base V2 plan changed; re-audit");
    const work = await mkdtemp(join(tmpdir(), "latestnews-coverage-"));
    try {
        const baseDir = join(work, "base");
        const original = await buildV2(root, baseDir);
        ensure(original.datasetSha256 === BASE_DIGEST, "Unexpected base V2 dataset digest");
        const [b, m, o, h, l] = await Promise.all([
            readFile(join(baseDir, "news-quality-holdout-candidate-v2.json"), "utf8"),
            readFile(join(baseDir, "maintainer-manifest.json"), "utf8"),
            ...["old", "hybrid", "literal"].map(async key => {
                const [path, expected] = INPUTS[key];
                const bytes = await readFile(resolve(root, path));
                ensure(blobSha(bytes) === expected, "Baseline changed: " + path);
                return bytes.toString("utf8");
            }),
        ]);
        const oldQueries = [...JSON.parse(h).cases.map(q => q.query), ...Array.from(l.matchAll(/query: ("(?:[^"\\]|\\.)*")/gu), x => JSON.parse(x[1]))];
        ensure(oldQueries.length === 36, "Unexpected baseline queries");
        const { dataset, manifest } = expand(JSON.parse(b), JSON.parse(m), JSON.parse(o), oldQueries, JSON.parse(rawExtension));
        manifest.expansion.fixtureSha256 = sha(rawExtension);
        const dest = resolve(output);
        await mkdir(dest, { mode: 0o700 });
        try {
            await writeFile(join(dest, "news-quality-holdout-candidate-v2-expanded.json"), json(dataset), { flag: "wx", mode: 0o600 });
            await writeFile(join(dest, "maintainer-manifest.json"), json(manifest), { flag: "wx", mode: 0o600 });
        } catch (e) {
            await rm(dest, { recursive: true, force: true });
            throw e;
        }
        return { status: manifest.status, automaticAdmission: false, counts: manifest.counts, datasetSha256: manifest.datasetSha256, baseDatasetSha256: manifest.baseDatasetSha256 };
    } finally {
        await rm(work, { recursive: true, force: true });
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const [root, output, ...rest] = process.argv.slice(2);
    if (!root || !output || rest.length) {
        console.error("Usage: node scripts/performance/holdout-coverage.mjs <repo-root> <new-output-directory>");
        process.exitCode = 2;
    } else {
        run(root, output).then(r => console.log(json(r))).catch(e => { console.error(e.message); process.exitCode = 1; });
    }
}
