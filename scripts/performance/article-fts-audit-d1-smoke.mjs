import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { rm, mkdtemp } from "node:fs/promises";

import { ArticleIndex } from "../../server/database/article-index.ts";
import { createRequestD1Database } from "../../server/database/request-d1.ts";
import { ftsIsInconsistent, FTS_AUDIT_MAX_AGE_MS } from "../../server/database/article-recovery.ts";

const root = fileURLToPath(new URL("../..",import.meta.url));
const miniflareDir = process.env.LATESTNEWS_MINIFLARE_DIR;
if (!miniflareDir) throw new Error("Set LATESTNEWS_MINIFLARE_DIR.");
const {Miniflare} = createRequire(join(resolve(miniflareDir),"package.json"))("miniflare");
const dir=await mkdtemp(join(tmpdir(),"latestnews-n4p1-d1-"));
const options={
    modules:true,scriptPath:join(root,"dist/_worker.js/index.js"),
    compatibilityDate:process.env.LATESTNEWS_D1_TEST_COMPAT_DATE||"2026-08-06",
    compatibilityFlags:["nodejs_compat"],d1Databases:{LATESTNEWS_DB:"n4p1-isolated"},d1Persist:dir,
    outboundService:{external:{address:"127.0.0.1:1"}},
};
let mf,db,index;
async function open(autoInit){
    mf=new Miniflare({...options,bindings:{ENABLE_CACHE:"true",INIT_TABLE:String(autoInit)}});
    db=createRequestD1Database(await mf.getD1Database("LATESTNEWS_DB"));
    index=new ArticleIndex(db);
}
async function get(path){
    const response=await mf.dispatchFetch("http://localhost"+path);
    const payload=await response.json();
    assert.equal(response.status,200,JSON.stringify(payload));
    return payload.data;
}
const health=async()=>(await get("/api/v1/health/deployment")).checks.articleIndex;
const search=()=>get("/api/v1/articles/search?q=AuditAlpha");
const proof=()=>db.prepare("SELECT * FROM article_fts_audit").get();
try{
    await open(true);
    await get("/api/v1/health/deployment");
    assert.equal((await health()).ftsAudit.status,"unverified");
    await index.probe(false);
    await index.upsertSourceItems("weibo",[1,2].map(n=>({id:String(n),title:"AuditAlpha "+n,url:"https://example.test/audit/"+n,pubDate:1795550000000})));
    assert.equal((await index.continueRepair()).status,"ok");
    assert.equal((await search()).searchMode,"fts");
    const first=await proof();
    await mf.dispose(); await open(false);
    assert.deepEqual(await proof(),first);
    assert.equal((await health()).ftsAudit.status,"verified");
    assert.equal((await search()).searchMode,"fts");
    console.log("PASS actual Pages worker uses durable proof across restart without re-auditing");
    await db.prepare("DROP TABLE article_fts_audit").run();
    await db.prepare("DELETE FROM article_search WHERE canonical_url='https://example.test/audit/2'").run();
    assert.equal(await ftsIsInconsistent(db),true);
    assert.equal((await health()).ftsAudit.status,"unverified");
    assert.equal((await health()).fts,"degraded");
    assert.equal((await search()).searchMode,"like");
    assert.equal((await search()).items.length,2);
    assert.equal(await db.prepare("SELECT name FROM sqlite_master WHERE name='article_fts_audit'").get(),null);
    console.log("PASS legacy ready without evidence never advertises verified FTS; managed schema remains unchanged");
    await mf.dispose();await open(true);
    assert.equal((await health()).ftsAudit.status,"unverified");
    assert.equal(await proof(),null);
    await index.probe(false);
    for(let i=0;i<12;i++){if((await index.continueRepair(2)).status==="ok")break;}
    assert.equal(await ftsIsInconsistent(db),false);
    assert.equal((await health()).ftsAudit.status,"verified");
    assert.equal((await search()).items.length,2);
    assert.equal((await search()).searchMode,"fts");
    console.log("PASS additive Pages upgrade plus explicit bounded maintenance repairs and publishes proof");
    await db.prepare("UPDATE article_fts_audit SET audited_at=?").run(Date.now()-FTS_AUDIT_MAX_AGE_MS-1000);
    assert.equal((await health()).ftsAudit.status,"expired");
    assert.equal((await search()).searchMode,"like");
    const expired=await proof();
    await db.prepare("CREATE TRIGGER fixture_audit_error BEFORE INSERT ON article_fts_audit BEGIN SELECT RAISE(ABORT,'isolated failure'); END").run();
    assert.equal((await index.continueRepair()).status,"unavailable");
    assert.deepEqual(await proof(),expired);
    assert.equal((await health()).ftsAudit.status,"expired");
    await db.prepare("DROP TRIGGER fixture_audit_error").run();
    assert.equal((await index.continueRepair()).status,"ok");
    assert.equal((await search()).searchMode,"fts");
    console.log("PASS expired proof, failed D1 audit, and successful renewal");
    console.log(JSON.stringify({result:"passed",checks:4,compatibilityDate:options.compatibilityDate,productionD1:false}));
}finally{if(mf)await mf.dispose();await rm(dir,{recursive:true,force:true});}
