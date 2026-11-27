import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { rm, mkdtemp, symlink, readFile, writeFile } from "node:fs/promises";

import { PINS, freeze, sha256, verify, auditEvidence, blankChecklist, inspectChecklist, followupReadiness } from "./holdout-admission.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
let work, frozen, dataset, capture, old, summary, blank;
before(async () => {
    work = await mkdtemp(join(tmpdir(), "holdout-admission-test-"));
    frozen = join(work, "frozen");
    summary = await freeze(root, frozen);
    dataset = await readJson(join(frozen, "candidate.json"));
    capture = await readJson(join(frozen, "current-evidence.json"));
    blank = await readJson(join(frozen, "admission-review.blank.json"));
    old = await readJson(join(root, "test/fixtures/news-event-real-corpus.json"));
});
after(async () => { if (work) await rm(work, { recursive: true, force: true }); });
const audit = (value = capture) => auditEvidence(dataset, value, old);
const mutate = (f) => {
    const value = structuredClone(capture);
    f(value);
    return value;
};

test("real candidate freeze binds all pinned inputs and is deterministic", async () => {
    assert.equal(summary.datasetSha256, PINS.candidate);
    assert.equal(summary.reports, 103);
    assert.equal(summary.queries, 48);
    assert.equal(summary.status, "blocked-draft");
    assert.equal(summary.automaticAdmission, false);
    assert.equal(summary.attempts, 201);
    assert.equal(summary.latestObservations, 194);
    assert.equal(summary.supersededObservations, 7);
    assert.equal(summary.allCurrentRolesCaptured, 79);
    assert.equal(summary.historicalFeedUnavailable, 39);
    assert.deepEqual(summary.byIdentity, { matched: 26, "not-applicable": 57, unavailable: 20 });
    assert.equal(summary.aliasRisks, 0);
    assert.equal(blank.freezeSha256, summary.freezeSha256);
    assert.equal(sha256(await readFile(join(frozen, "freeze.json"))), summary.freezeSha256);
    assert.deepEqual(await verify(root, frozen), summary);
    const another = join(work, "another");
    assert.deepEqual(await freeze(root, another), summary);
    for (const name of ["candidate.json", "maintainer-manifest.json", "current-evidence.json", "readiness.json", "freeze.json", "admission-review.blank.json"])
        assert.deepEqual(await readFile(join(another, name)), await readFile(join(frozen, name)));
    await assert.rejects(freeze(root, frozen), /EEXIST/);
});
test("freeze verification rejects changed bytes, extra files and symlinks", async () => {
    const dest = join(work, "tamper");
    await freeze(root, dest);
    const path = join(dest, "current-evidence.json"), bytes = await readFile(path);
    await writeFile(path, Buffer.concat([bytes, Buffer.from(" ")]));
    await assert.rejects(verify(root, dest), /Frozen bytes changed: current-evidence.json/);
    await writeFile(path, bytes);
    await writeFile(join(dest, "extra.json"), "{}");
    await assert.rejects(verify(root, dest), /Unexpected freeze file set/);
    await rm(join(dest, "extra.json"));
    await rm(path);
    await symlink(join(frozen, "current-evidence.json"), path);
    await assert.rejects(verify(root, dest), /Not a regular freeze file/);
});
test("self-consistent changed index is not accepted", async () => {
    const dest = join(work, "rehashed");
    await freeze(root, dest);
    const indexPath = join(dest, "freeze.json"), candidatePath = join(dest, "candidate.json");
    const index = await readJson(indexPath);
    const changed = Buffer.from((await readFile(candidatePath, "utf8")) + " ");
    index.files["candidate.json"] = { bytes: changed.length, sha256: sha256(changed) };
    await writeFile(candidatePath, changed);
    await writeFile(indexPath, JSON.stringify(index, null, 2) + "\n");
    await assert.rejects(verify(root, dest), /Frozen bytes changed/);
});
test("observation set must exactly cover the candidate roles", () => {
    assert.throws(() => audit(mutate(c => c.rows.pop())), /Missing observation/);
    assert.throws(() => audit(mutate(c => c.rows.push(c.rows[0]))), /Unknown or duplicate observation/);
    assert.throws(() => audit(mutate(c => { c.rows[0].reportId = "unknown"; })), /Unknown or duplicate observation/);
    assert.throws(() => audit(mutate(c => { c.rows[0].requestUrl = "https://example.org/"; })), /Invalid observation identity/);
});
test("reject bad chronology, fingerprints and unsubstantiated successful status", () => {
    assert.throws(() => audit(mutate(c => { c.rows[0].capturedAt = "2025-01-01T00:00:00Z"; })), /chronology/);
    assert.throws(() => audit(mutate(c => { c.rows[0].responseSha256 = "fake"; })), /fingerprint/);
    assert.throws(() => audit(mutate(c => { c.rows[0].status = 403; })), /Invalid captured response/);
    assert.throws(() => audit(mutate(c => { c.rows[0].state = "http-error"; })), /Failure cannot contain accepted metadata/);
});
test("seven previous observations remain part of the frozen audit", () => {
    assert.throws(() => audit(mutate(c => c.supersededObservations.push(c.supersededObservations[0]))), /Invalid superseded/);
    assert.throws(() => audit(mutate(c => { c.supersededObservations[0].observed.title = "short"; })), /Invalid superseded/);
    assert.throws(() => audit(mutate(c => {
        const p = c.supersededObservations[0];
        const latest = c.rows.find(r => r.reportId === p.reportId && r.role === p.role);
        latest.capturedAt = c.startedAt;
    })), /Invalid refresh chronology/);
});
test("current publisher metadata drift is reported rather than changing the candidate", () => {
    const r = audit();
    assert.deepEqual(r.reports.filter(x => x.timeSignal === "published-metadata-differs").map(x => x.reportId), ["candidate-019", "candidate-022"]);
    assert.deepEqual(r.reports.filter(x => x.titleSignal === "title-needs-review").map(x => x.reportId), ["candidate-019", "candidate-020", "candidate-022"]);
    assert(r.reports.every(x => x.historicalEvidence === "pending-human-verification" && x.eventDisjointness === "pending-human-verification"));
    assert.equal(r.status, "blocked-draft");
});
test("HN identity mismatch is not accepted as a verified submission", () => {
    const c = mutate(x => {
        const r = x.rows.find(y => y.role === "hn-item" && y.state === "captured");
        r.observed.api.title = "synthetic mismatch";
    });
    const r = audit(c);
    assert.equal(r.byIdentity.mismatch, 1);
    assert.equal(r.byIdentity.matched, 25);
    assert.equal(r.automaticAdmission, false);
});
test("redirect risks include collisions with prior articles and current aliases", () => {
    const c = mutate(x => { x.rows[0].finalUrl = old.reports[0].articleUrl; });
    assert(audit(c).aliasRisks.some(r => r.oldCorpusOverlap && r.reportIds.includes(dataset.reports[0].id)));
    const d = mutate(x => { x.rows[0].finalUrl = dataset.reports[1].articleUrl; });
    assert(audit(d).aliasRisks.some(r => r.reportIds.length === 2));
});
test("blank checklist has no invented maintainer declarations", () => {
    const r = inspectChecklist(blank, blank);
    assert.equal(blank.maintainer, "");
    assert.equal(r.resolvedDeclarations, 0);
    assert.equal(r.unresolvedDeclarations, 362);
    assert.equal(r.status, "blocked-draft");
    assert.equal(r.automaticAdmission, false);
});
test("checklist rejects wrong freeze hash, missing and duplicate IDs", () => {
    assert.throws(() => inspectChecklist(blank, { ...blank, freezeSha256: "0".repeat(64) }), /does not bind/);
    const missing = structuredClone(blank);
    missing.reports.pop();
    assert.throws(() => inspectChecklist(blank, missing), /Incomplete checklist/);
    const duplicate = structuredClone(blank);
    duplicate.reports[1].reportId = duplicate.reports[0].reportId;
    assert.throws(() => inspectChecklist(blank, duplicate), /Duplicate checklist ID/);
});
test("synthetic checklist completion never grants automatic admission", () => {
    const sample = blankChecklist({ reports: [{ id: "synthetic-r" }], queries: [{ id: "synthetic-q" }] }, "synthetic-freeze");
    const value = structuredClone(sample);
    value.reports[0].evidence.decision = "resolved";
    assert.throws(() => inspectChecklist(sample, value), /Missing decision evidence/);
    const decision = () => ({ decision: "resolved", reason: "Synthetic test only", evidenceRef: "synthetic:test" });
    value.reports[0].evidence = decision();
    assert.throws(() => inspectChecklist(sample, value), /Maintainer identity required/);
    value.maintainer = "synthetic fixture (not a real reviewer)";
    value.reports[0].timestamp = decision();
    value.reports[0].eventDisjointness = decision();
    value.queries[0].intentIndependence = decision();
    value.gates = value.gates.map(g => ({ id: g.id, ...decision() }));
    const r = inspectChecklist(sample, value);
    assert.equal(r.unresolvedDeclarations, 0);
    assert.equal(r.status, "awaiting-explicit-maintainer-decision");
    assert.equal(r.automaticAdmission, false);
});

test("pinned follow-up derives current availability without modifying the freeze", async () => {
    const result = await followupReadiness(root, frozen);
    assert.equal(result.status, "blocked-draft");
    assert.equal(result.automaticAdmission, false);
    assert.equal(result.totalObservationAttempts, 247);
    assert.equal(result.originalPositions, 194);
    assert.equal(result.originalPositionsCaptured, 193);
    assert.equal(result.allCurrentRolesCaptured, 102);
    assert.deepEqual(result.byRoleState, {
        "article:captured": 102, "article:network-error": 1,
        "discussion:captured": 45, "hn-item:captured": 45, "release-api:captured": 1,
    });
    assert.deepEqual(result.byIdentity, { matched: 46, "not-applicable": 57 });
    assert.equal(result.historicalFeedUnavailable, 39);
    const rss = result.solidotTimeChecks.filter(r => r.basis === "original-rss-derived-utc");
    const assumption = result.solidotTimeChecks.filter(r => r.basis === "assumed-utc-plus-eight");
    assert.equal(rss.length, 8);
    assert(rss.every(r => r.matches === true));
    assert.equal(assumption.length, 14);
    assert(assumption.every(r => r.matches === true));
    assert.deepEqual(result.aliasRisks, []);
    assert.deepEqual(result.reportsReadiness.filter(x => x.article !== "captured").map(x => x.reportId), ["candidate-060"]);
    assert(result.reportsReadiness.every(x => x.eventDisjointness === "pending-human-verification"));
    assert.deepEqual(await verify(root, frozen), summary);
});
