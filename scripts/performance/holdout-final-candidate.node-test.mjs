import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { rm, mkdtemp, symlink, readFile, writeFile } from "node:fs/promises";

import { INPUTS } from "./holdout-v2.mjs";
import { revise, freezeFinal, verifyFinal } from "./holdout-final-candidate.mjs";
import { freeze, verify, inspectChecklist, followupReadiness } from "./holdout-admission.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const load = async path => JSON.parse(await readFile(path, "utf8"));
let work, baseDir, finalDir, base, capture, followup, readiness, plan, old, oldQueries, final, manifest, summary;
before(async () => {
    work = await mkdtemp(join(tmpdir(), "holdout-final-test-"));
    baseDir = join(work, "base");
    finalDir = join(work, "final");
    await freeze(root, baseDir);
    readiness = await followupReadiness(root, baseDir);
    base = await load(join(baseDir, "candidate.json"));
    capture = await load(join(baseDir, "current-evidence.json"));
    followup = await load(join(root, "test/fixtures/news-quality-holdout-v2-evidence-followup.json"));
    plan = await load(join(root, "test/fixtures/news-quality-holdout-final-revision.json"));
    old = await load(join(root, INPUTS.old[0]));
    const hybrid = await load(join(root, INPUTS.hybrid[0]));
    const literal = await readFile(join(root, INPUTS.literal[0]), "utf8");
    oldQueries = [...hybrid.cases.map(q => q.query), ...Array.from(literal.matchAll(/query: ("(?:[^"\\]|\\.)*")/gu), m => JSON.parse(m[1]))];
    summary = await freezeFinal(root, finalDir);
    final = await load(join(finalDir, "candidate.json"));
    manifest = await load(join(finalDir, "maintainer-manifest.json"));
});
after(async () => { if (work) await rm(work, { recursive: true, force: true }); });
const apply = (p = plan, r = readiness) => revise(base, r, capture, followup, old, oldQueries, p);
const mutate = f => {
    const p = structuredClone(plan);
    f(p);
    return p;
};

test("pinned revision replaces four high-risk reports, retains queries and improves language coverage", () => {
    assert.equal(summary.status, "blocked-draft");
    assert.equal(summary.automaticAdmission, false);
    assert.equal(final.reports.length, 103);
    assert.equal(final.queries.length, 48);
    assert.deepEqual(final.queries, base.queries);
    assert.equal(final.snapshotAt, base.snapshotAt);
    assert.equal(final.labelStatus, "unreviewed-candidate");
    const ids = new Set(final.reports.map(r => r.id));
    for (const id of ["candidate-019", "candidate-020", "candidate-022", "candidate-060"]) assert(!ids.has(id));
    for (const r of plan.supplements) assert(ids.has(r.report.id));
    assert.equal(final.reports.filter(r => r.language === "zh").length, 38);
    assert.equal(final.reports.filter(r => r.language === "en").length, 65);
    assert.equal(manifest.historicalFeedUnavailable, 36);
    assert.equal(manifest.currentArticlesCaptured, 103);
    assert.equal(manifest.retainedReadiness.length, 99);
    assert(manifest.retainedReadiness.every(r => r.eventDisjointness === "pending-human-verification"));
    assert.deepEqual(summary.counts.byCohortLanguage, {
        "daily:en": 27, "daily:zh": 18, "release:en": 25, "release:zh": 14, "security:en": 13, "security:zh": 6,
    });
});
test("revision is deterministic and never changes the previous frozen candidate", async () => {
    assert.deepEqual(await verifyFinal(root, finalDir), summary);
    assert.equal((await verify(root, baseDir)).freezeSha256, plan.baseFreezeSha256);
    const second = join(work, "second");
    assert.deepEqual(await freezeFinal(root, second), summary);
    for (const name of ["candidate.json", "maintainer-manifest.json", "freeze.json", "admission-review.blank.json"])
        assert.deepEqual(await readFile(join(second, name)), await readFile(join(finalDir, name)));
    await assert.rejects(freezeFinal(root, finalDir), /EEXIST/);
});
test("rejects quarantine without observed evidence risk", () => {
    assert.throws(() => apply(mutate(p => { p.quarantineReports["candidate-001"] = "synthetic"; })), /Quarantine lacks observed risk/);
    const r = structuredClone(readiness);
    r.freezeSha256 = "0".repeat(64);
    assert.throws(() => apply(plan, r), /Invalid final revision provenance/);
});
test("unavailable retained article cannot be silently approved", () => {
    assert.throws(() => apply(mutate(p => { delete p.quarantineReports["candidate-060"]; })), /Unresolved retained article/);
});
test("validates source-specific title/time evidence and capture integrity", () => {
    for (const f of [
        p => { p.supplements[0].evidence.observedValue = "2025/8/10 16:05:32"; },
        p => { p.supplements[0].report.reportedAt = "2025-08-10T16:05:31Z"; },
        p => { p.supplements[2].evidence.observedValue++; },
        p => { p.supplements[3].evidence.observedValue = "2026-11-25T02:53:15Z"; },
        p => { p.supplements[0].report.title = "synthetic"; },
    ]) assert.throws(() => apply(mutate(f)), /Supplement time\/title evidence mismatch/);
    for (const f of [
        p => { p.supplements[0].evidence.status = 403; },
        p => { p.supplements[0].evidence.responseSha256 = "unknown"; },
        p => { p.supplements[0].evidence.capturedAt = "2020-01-01T00:00:00Z"; },
        p => { p.supplements[0].report.reportedAt = "2026-11-26T00:00:00Z"; },
    ]) assert.throws(() => apply(mutate(f)), /Invalid supplemental evidence/);
});
test("rejects redirect conflicts with retained and old reports", () => {
    const urls = [base.reports.find(r => r.source === "ithome").articleUrl, old.reports.find(r => r.source === "ithome").articleUrl];
    for (const url of urls) assert.throws(() => apply(mutate(p => { p.supplements[0].evidence.finalUrl = url; })), /Revision URL overlap/);
    assert.throws(() => apply(mutate(p => { p.supplements[0].evidence.finalUrl = "https://example.org/"; })), /Supplement redirect outside publisher/);
});
test("projection strips answer fields and never imports maintainer notes into candidate", () => {
    const result = apply(mutate(p => {
        p.supplements[0].report.event = "synthetic";
        p.supplements[0].report.relevant = ["synthetic"];
    }));
    const r = result.dataset.reports.find(r => r.id === "final-zh-001");
    assert.deepEqual(Object.keys(r).sort(), ["id","cohort","source","language","title","url","articleUrl","reportedAt","timeKind","evidenceUrl"].sort());
    assert(!("supplementalEvidence" in result.dataset));
});
test("new blank checklist is fully unresolved and cannot reuse a prior freeze", async () => {
    const blank = await load(join(finalDir, "admission-review.blank.json"));
    const before = await load(join(baseDir, "admission-review.blank.json"));
    const status = inspectChecklist(blank, blank);
    assert.equal(status.resolvedDeclarations, 0);
    assert.equal(status.unresolvedDeclarations, 362);
    assert.equal(status.automaticAdmission, false);
    assert.throws(() => inspectChecklist(blank, before), /does not bind/);
});
test("final verification rejects changed bytes, added files and symlinks", async () => {
    const dir = join(work, "tamper");
    await freezeFinal(root, dir);
    const path = join(dir, "candidate.json"), raw = await readFile(path);
    await writeFile(path, Buffer.concat([raw, Buffer.from(" ")]));
    await assert.rejects(verifyFinal(root, dir), /Final frozen bytes changed/);
    await writeFile(path, raw);
    await writeFile(join(dir, "other.json"), "{}");
    await assert.rejects(verifyFinal(root, dir), /Unexpected final freeze file set/);
    await rm(join(dir, "other.json"));
    await rm(path);
    await symlink(join(finalDir, "candidate.json"), path);
    await assert.rejects(verifyFinal(root, dir), /Final frozen bytes changed/);
});
