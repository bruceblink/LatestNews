import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import test, { after, before } from "node:test";
import { rm, mkdtemp, readFile } from "node:fs/promises";

import { run, expand } from "./holdout-coverage.mjs";
import { INPUTS, run as buildV2 } from "./holdout-v2.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const load = async (path) => JSON.parse(await readFile(path, "utf8"));
const digest = (value) => createHash("sha256").update(JSON.stringify(value, null, 2) + "\n").digest("hex");
let work, base, manifest, old, oldQueries, extension;
before(async () => {
    work = await mkdtemp(join(tmpdir(), "holdout-coverage-test-"));
    const dest = join(work, "base");
    await buildV2(root, dest);
    base = await load(join(dest, "news-quality-holdout-candidate-v2.json"));
    manifest = await load(join(dest, "maintainer-manifest.json"));
    old = await load(join(root, INPUTS.old[0]));
    const hybrid = await load(join(root, INPUTS.hybrid[0]));
    const literal = await readFile(join(root, INPUTS.literal[0]), "utf8");
    oldQueries = [...hybrid.cases.map(q => q.query), ...Array.from(literal.matchAll(/query: ("(?:[^"\\]|\\.)*")/gu), x => JSON.parse(x[1]))];
    extension = await load(join(root, "test/fixtures/news-quality-holdout-v2-coverage.json"));
});
after(async () => { if (work) await rm(work, { recursive: true, force: true }); });
const check = (e = extension, b = base, m = manifest) => expand(b, m, old, oldQueries, e);
const mutate = (f) => {
    const e = structuredClone(extension);
    f(e);
    return e;
};

test("real extension preserves blocked base and produces 103 reports, 48 queries deterministically", () => {
    const before = JSON.stringify([base, manifest, extension]);
    const a = check(), b = check();
    assert.deepEqual(a, b);
    assert.equal(JSON.stringify([base, manifest, extension]), before);
    assert.equal(a.dataset.reports.length, 103);
    assert.equal(a.dataset.queries.length, 48);
    assert.deepEqual(a.dataset.reports.slice(0, base.reports.length), base.reports);
    assert.deepEqual(a.dataset.queries.slice(0, base.queries.length), base.queries);
    assert.equal(a.dataset.snapshotAt, base.snapshotAt);
    assert.equal(a.dataset.labelStatus, "unreviewed-candidate");
    assert.equal(a.manifest.status, "blocked-draft");
    assert.equal(a.manifest.automaticAdmission, false);
    assert.equal(a.manifest.baseDatasetSha256, manifest.datasetSha256);
    assert.equal(a.manifest.datasetSha256, digest(a.dataset));
    assert.deepEqual(a.manifest.counts.byCohortLanguage, { "daily:en": 30, "daily:zh": 17, "release:en": 25, "release:zh": 11, "security:en": 14, "security:zh": 6 });
    assert.equal(a.manifest.expansion.evidence.length, 40);
});
test("projection drops proposed labels, predictions and extra review fields", () => {
    const e = mutate(x => {
        Object.assign(x.rows[0].report, { event: "synthetic", relevant: ["synthetic"], prediction: 1 });
        Object.assign(x.queries[0], { relevant: ["synthetic"], noAnswer: false });
    });
    const { dataset } = check(e);
    assert.deepEqual(Object.keys(dataset.reports.at(-40)).sort(), ["id", "cohort", "source", "language", "title", "url", "articleUrl", "reportedAt", "timeKind", "evidenceUrl"].sort());
    assert.deepEqual(Object.keys(dataset.queries.at(-15)).sort(), ["id", "query"]);
});
test("rejects changed base digest and premature admission", () => {
    assert.throws(() => check(extension, { ...base, snapshotAt: "2026-11-24T00:00:00Z" }), /Base draft\/manifest mismatch/);
    assert.throws(() => check(extension, base, { ...manifest, automaticAdmission: true }), /Base draft\/manifest mismatch/);
    assert.throws(() => check(mutate(e => { e.status = "approved"; })), /Invalid expansion/);
});
test("rejects missing, invalid or chronologically impossible capture metadata", () => {
    for (const f of [
        e => { e.rows[0].evidence.captures[0].responseSha256 = "unknown"; },
        e => { e.rows[0].evidence.captures[0].status = 403; },
        e => { e.rows[0].evidence.captures[0].capturedAt = "2020-01-01T00:00:00Z"; },
        e => { e.rows[0].evidence.captures[0].requestUrl = "https://example.com"; },
    ]) assert.throws(() => check(mutate(f)), /capture/i);
});
test("minute precision is not represented as an invented second", () => {
    assert.throws(() => check(mutate(e => { e.rows[0].report.reportedAt = e.rows[0].report.reportedAt.replace(":00+08:00", ":37+08:00"); })), /minute-precision/);
    assert.throws(() => check(mutate(e => { e.rows[0].evidence.timePrecision = "second"; })), /minute-precision/);
});
test("HN submission identity, URL and time must match the observed item", () => {
    const n = extension.rows.findIndex(r => r.evidence.kind === "hn-item-and-publisher-page");
    for (const f of [
        e => { e.rows[n].evidence.observedSubmission.id += 1; },
        e => { e.rows[n].report.timeKind = "published"; },
        e => { e.rows[n].evidence.observedSubmission.title = "unverified"; },
        e => { e.rows[n].evidence.observedSubmission.created_at = "2026-01-01T00:00:00Z"; },
    ]) assert.throws(() => check(mutate(f)), /HN evidence/);
});
test("version-specific GitHub release evidence cannot silently become a draft or another tag", () => {
    const n = extension.rows.findIndex(r => r.evidence.kind === "github-release-and-publisher-page");
    assert.throws(() => check(mutate(e => { e.rows[n].evidence.observedRelease.draft = true; })), /release evidence/);
    assert.throws(() => check(mutate(e => { e.rows[n].evidence.observedRelease.tag_name = "v9.9.9"; })), /release evidence/);
});
test("redirect aliases cannot overlap old, base or another expansion article", () => {
    for (const url of [old.reports[0].articleUrl, base.reports[0].articleUrl, extension.rows[1].report.articleUrl]) {
        assert.throws(() => check(mutate(e => { e.rows[0].evidence.captures[0].finalUrl = url; })), /Underlying redirect overlap/);
    }
});
test("duplicate queries and post-cutoff reports are rejected", () => {
    assert.throws(() => check(mutate(e => { e.queries[0].query = base.queries[0].query; })), /Duplicate query text/);
    assert.throws(() => check(mutate(e => {
        const r = e.rows[0];
        r.report.reportedAt = "2026-11-26T12:00:00+08:00";
        r.evidence.observedWallTime = "2026-11-26 12:00";
    })), /Invalid report time/);
});
test("CLI writes a deterministic blocked draft and refuses existing output", async () => {
    const a = join(work, "expanded-a"), b = join(work, "expanded-b");
    const result = await run(root, a);
    assert.deepEqual(await run(root, b), result);
    assert.equal(result.status, "blocked-draft");
    assert.equal(result.counts.reports, 103);
    const name = "news-quality-holdout-candidate-v2-expanded.json";
    assert.equal(await readFile(join(a, name), "utf8"), await readFile(join(b, name), "utf8"));
    assert.equal(await readFile(join(a, "maintainer-manifest.json"), "utf8"), await readFile(join(b, "maintainer-manifest.json"), "utf8"));
    await assert.rejects(run(root, a), /EEXIST/);
});
