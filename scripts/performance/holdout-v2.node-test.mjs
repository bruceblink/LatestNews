import test from "node:test";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { rm, mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";

import { run, INPUTS, blobSha, buildDraft, normalizeUrl } from "./holdout-v2.mjs";

function report(id, url, extra = {}) {
    return { id, cohort: "daily", source: "example", language: "en", title: `Title ${id}`, url, articleUrl: url, reportedAt: "2026-11-24T00:00:00Z", timeKind: "published", evidenceUrl: url, ...extra };
}
function fixture() {
    const v1 = { snapshotAt: "2026-11-25T12:00:15.000793Z", labelStatus: "unreviewed-candidate", captures: [{ rawSha256: "synthetic" }], reports: [report("r1","https://example.com/a"), report("r2","https://example.com/b"), report("r3","https://example.com/c")], queries: [{id:"q1",query:"query one"}, {id:"q2",query:"query two"}] };
    const old = { reports: [report("o1","https://example.net/a")] };
    const plan = { schemaVersion: 1, reviewDate:"2026-11-27", quarantineReports:{r2:"Synthetic test quarantine"}, quarantineQueries:{q2:"Synthetic test quarantine"}, reportNotes:{r1:"Pending evidence"}, supplements:[{id:"s1",cohort:"release",source:"test-cn",language:"zh",title:"测试文档",url:"https://example.org/new",reportedAt:"2026-11-24T08:00:00+08:00",publisher:"Synthetic publisher",observedLocalTime:"2026-11-24 08:00:00",note:"Synthetic evidence"}], queries:[{id:"sq1",query:"测试 查询"}], pendingSupplements:[], blockers:["Independent review not performed"] };
    return {v1,old,oldQueries:["old query"],plan};
}
const build = ({v1,old,oldQueries,plan}) => buildDraft(v1,old,oldQueries,plan);

test("quarantine and supplement deterministically without mutating sources", () => {
    const f=fixture(); const before=JSON.stringify(f); const a=build(f), b=build(f);
    assert.deepEqual(a,b); assert.equal(JSON.stringify(f),before);
    assert.deepEqual(a.dataset.reports.map(r=>r.id),["r1","r3","s1"]);
    assert.deepEqual(a.dataset.queries.map(r=>r.id),["q1","sq1"]);
    assert.equal(a.manifest.counts.reports,3); assert.equal(a.manifest.counts.queries,2);
    assert.equal(a.manifest.counts.byCohortLanguage["release:zh"],1);
    assert.equal(a.manifest.datasetSha256.length,64);
});
test("admission always blocked and evidence state is explicit",()=>{
    const {dataset,manifest}=build(fixture());
    assert.equal(dataset.labelStatus,"unreviewed-candidate"); assert.equal(manifest.status,"blocked-draft"); assert.equal(manifest.automaticAdmission,false);
    assert.equal(manifest.evidence.find(r=>r.reportId==="s1").evidenceState,"page-inspected-metadata-pending");
    assert.equal(manifest.evidence.find(r=>r.reportId==="r1").evidenceState,"inherited-unverified");
    assert(manifest.evidence.every(r=>r.rawResponseSha256===null && r.immutableCapture===null));
    assert.equal(manifest.inheritedCaptureMetadata[0].rawSha256,"synthetic");
});
test("whitelist excludes event and retrieval labels and arbitrary input fields",()=>{
    const f=fixture(); Object.assign(f.v1.reports[0],{event:"synthetic",family:"synthetic",group:"synthetic",prediction:1});
    Object.assign(f.v1.queries[0],{relevant:["r1"],noAnswer:false});
    Object.assign(f.plan.supplements[0],{group:"synthetic"});
    const {dataset}=build(f);
    assert.deepEqual(Object.keys(dataset.reports[0]).sort(),["id","cohort","source","language","title","url","articleUrl","reportedAt","timeKind","evidenceUrl"].sort());
    assert.deepEqual(Object.keys(dataset.queries[0]).sort(),["id","query"]);
    assert(!("evidence" in dataset)); assert(!("captures" in dataset));
});
test("URL normalization agrees on tracking and host aliases",()=>{
    assert.equal(normalizeUrl("https://www.example.com/path/?utm_source=x#ref"),"https://example.com/path");
    assert.equal(normalizeUrl("https://m.example.com/?id=42&ref=x"),"https://example.com/?id=42");
    assert.throws(()=>normalizeUrl("http://example.com"),/HTTPS/);
    assert.throws(()=>normalizeUrl("https://user:pass@example.com"),/credentials/);
});
test("reject duplicate underlying article after quarantine",()=>{
    const f=fixture(); f.v1.reports[2].articleUrl="https://www.example.com/a?utm_source=dup";
    assert.throws(()=>build(f),/Duplicate article URL/);
});
test("reject duplicate normalized report URL",()=>{
    const f=fixture(); f.v1.reports[2].url="https://example.com/a#discussion";
    assert.throws(()=>build(f),/Duplicate report URL/);
});
test("reject baseline overlap through original article URL",()=>{
    const f=fixture(); f.v1.reports[0].articleUrl=f.old.reports[0].url;
    assert.throws(()=>build(f),/Exact baseline overlap/);
});
test("reject exact baseline title overlap with normalization",()=>{
    const f=fixture(); f.v1.reports[0].title="  TITLE Ｏ1 ";
    assert.throws(()=>build(f),/Exact baseline overlap/);
});
test("reject normalized old query overlap",()=>{
    const f=fixture(); f.plan.queries[0].query="ＯＬＤ   QUERY";
    assert.throws(()=>build(f),/Exact baseline query overlap/);
});
test("reject normalized query duplicates",()=>{
    const f=fixture(); f.plan.queries[0].query=" Query   ONE ";
    assert.throws(()=>build(f),/Duplicate query text/);
});
test("reject unknown quarantine ID",()=>{
    const f=fixture(); f.plan.quarantineReports.r9="unknown";
    assert.throws(()=>build(f),/Unknown\/unexplained quarantined report/);
});
test("reject supplement reusing quarantined ID",()=>{
    const f=fixture(); f.plan.supplements[0].id="r2";
    assert.throws(()=>build(f),/Invalid supplement/);
});
test("reject date-only supplement rather than invent midnight",()=>{
    const f=fixture(); f.plan.supplements[0].reportedAt="2026-11-24";
    assert.throws(()=>build(f),/Missing precise timestamp/);
});
test("reject future article timestamp",()=>{
    const f=fixture(); f.plan.supplements[0].reportedAt="2026-11-26T00:00:00Z";
    assert.throws(()=>build(f),/Invalid report time/);
});
test("git blob hash uses byte length",()=>{
    assert.equal(blobSha(Buffer.from("test\n")), "9daeafb9864cf43055ae93beb0afd6c7d144bfa4");
});
test("CLI refuses changed upstream blobs before writing output",async()=>{
    const root=await mkdtemp(join(tmpdir(),"holdout-test-")); const output=join(root,"output");
    try {
        for (const [path] of Object.values(INPUTS)) { const file=join(root,path); await mkdir(dirname(file),{recursive:true}); await writeFile(file,"changed\n"); }
        await writeFile(join(root,"test/fixtures/news-quality-holdout-v2-plan.json"),"{}");
        await assert.rejects(run(root,output),/Baseline changed:/);
        assert(!(await readdir(root)).includes("output"));
    } finally { await rm(root,{recursive:true,force:true}); }
});
