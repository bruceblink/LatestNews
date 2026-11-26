import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { rm, mkdtemp, readFile } from "node:fs/promises";

import { ArticleIndex } from "../../server/database/article-index.ts";
import { createRequestD1Database } from "../../server/database/request-d1.ts";
import { ftsIsInconsistent } from "../../server/database/article-recovery.ts";
import { executeArticleBatch } from "../../server/database/article-atomic-batch.ts";
import { acquireMaintenanceLease, releaseMaintenanceLease } from "../../server/database/article-maintenance.ts";

const root=fileURLToPath(new URL("../..",import.meta.url));
const config=JSON.parse(await readFile(join(root,"wrangler.json"),"utf8"));
const {Miniflare}=createRequire(join(resolve(process.env.LATESTNEWS_MINIFLARE_DIR),"package.json"))("miniflare");
const dir=await mkdtemp(join(tmpdir(),"ln-maintenance-d1-"));
const token="isolated-maintenance-fixture-token";
const options={
    modules:true,scriptPath:join(root,"dist/_worker.js/index.js"),
    compatibilityDate:process.env.LATESTNEWS_D1_TEST_COMPAT_DATE||config.compatibility_date,
    compatibilityFlags:["nodejs_compat"],
    d1Databases:{LATESTNEWS_DB:"maintenance-fixture"},d1Persist:dir,
    bindings:{ENABLE_CACHE:"true",INIT_TABLE:"true",LATESTNEWS_REFRESH_TOKEN:token},
    outboundService:{external:{address:"127.0.0.1:1"}},
};
let mf=new Miniflare(options);
let db;
const makeItem=(id,round)=>({id,title:"Maintenance fixture round "+round+" item "+id,url:"https://example.test/maintenance/"+id});
async function request(path, status=200, credential=token, method="GET"){
    const response=await mf.dispatchFetch("http://localhost"+path,{
        method,headers:credential?{authorization:"Bearer "+credential}:{},
        signal:AbortSignal.timeout(30000),
    });
    const payload=await response.json();
    assert.equal(response.status,status,JSON.stringify(payload));
    if(method==="POST" && (status===200 || status===409))assert.equal(response.headers.get("cache-control"),"no-store");
    return payload.data;
}
const maintenance=(limit=5,status=200,credential=token)=>request("/api/v1/articles/maintenance?limit="+limit,status,credential,"POST");
const health=async()=>(await request("/api/v1/health/deployment")).checks.articleIndex;
const count=async(table)=>(await db.prepare("SELECT COUNT(*) AS count FROM "+table).get()).count;
async function restart(){
    await mf.dispose();mf=new Miniflare(options);
    db=createRequestD1Database(await mf.getD1Database("LATESTNEWS_DB"));
}
try{
    await maintenance(5,401,null);
    await maintenance(21,400);
    await request("/api/v1/health/deployment");
    db=createRequestD1Database(await mf.getD1Database("LATESTNEWS_DB"));
    const owner=await acquireMaintenanceLease(db);
    assert.ok(owner);
    assert.equal((await maintenance(5,409)).status,"busy");
    await releaseMaintenanceLease(db,owner);
    console.log("PASS authenticated maintenance, bounded limit and active lease rejection");
    for(let round=0;round<3;round++){
        for(let i=0;i<30;i++){
            const source="fixture-"+i, observed=Date.now()+round;
            const payload=JSON.stringify(Array.from({length:30},(_,j)=>makeItem(i+"-"+j,round)));
            await executeArticleBatch(db,[
                {sql:"INSERT INTO cache VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET updated=excluded.updated,data=excluded.data",params:[source,observed,payload]},
                {sql:"INSERT INTO article_ingest_pending(id,source_id,payload,observed_at) VALUES(?,?,?,?)",params:["round-"+round+"-"+i,source,payload,observed]},
            ]);
        }
        assert.equal(await count("article_ingest_pending"),30);
        let completed=0;
        for(let pass=0;pass<30;pass++){
            const result=await maintenance();
            assert.ok(result.attempted<=5);
            completed+=result.completed;
            if(result.status==="ok")break;
        }
        assert.equal(completed,30);
        assert.equal(await count("article_ingest_pending"),0);
        assert.equal((await health()).status,"ok");
    }
    assert.equal(await count("articles"),900);
    assert.equal(await count("article_sources"),900);
    assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM articles WHERE title LIKE 'Maintenance fixture round 2%'").get()).count,900);
    assert.equal(await ftsIsInconsistent(db),false);
    console.log("PASS three 30-source rounds converge without UI or upstream collection");
    await db.prepare("INSERT INTO article_ingest_pending(id,source_id,payload,observed_at) VALUES(?,?,?,?)").run("large","fixture-large",JSON.stringify(Array.from({length:65},(_,i)=>makeItem("large-"+i,0))),Date.now());
    assert.equal((await maintenance(1)).advanced,1);
    const abandoned=await acquireMaintenanceLease(db);
    assert.ok(abandoned);
    await restart();
    assert.equal((await maintenance(1,409)).status,"busy");
    await db.prepare("UPDATE article_maintenance_lease SET expires_at=0").run();
    assert.equal((await maintenance(1)).advanced,1);
    assert.equal((await maintenance(1)).completed,1);
    assert.equal(await count("article_ingest_work"),0);
    assert.equal(await count("articles"),965);
    console.log("PASS restart resumes durable chunk offset and expired lease");
    const stale=await acquireMaintenanceLease(db);
    await db.prepare("UPDATE article_maintenance_lease SET expires_at=0").run();
    const replacement=await acquireMaintenanceLease(db);
    const index=new ArticleIndex(db);
    await index.probe(false);
    await index.upsertSourceItems("fixture-fenced",[{...makeItem("fenced",0),title:"Replacement owner"}],1,replacement);
    await assert.rejects(index.upsertSourceItems("fixture-fenced",[{...makeItem("fenced",0),title:"Stale owner"}],1,stale));
    assert.equal((await db.prepare("SELECT title FROM articles WHERE canonical_url=?").get(makeItem("fenced",0).url)).title,"Replacement owner");
    await releaseMaintenanceLease(db,replacement);
    console.log("PASS stale owner write aborts atomically on actual D1");

    await db.prepare("INSERT INTO article_ingest_pending(id,source_id,payload,observed_at) VALUES(?,?,?,?)").run("poison","broken","{",1);
    assert.equal((await maintenance(1)).failed,1);
    assert.equal((await maintenance(1)).failed,1);
    const poison=await db.prepare("SELECT attempts FROM article_ingest_pending WHERE id='poison'").get();
    assert.equal(poison.attempts,2);
    await db.prepare("INSERT INTO article_ingest_pending(id,source_id,payload,observed_at) VALUES(?,?,?,?)").run("good","fixture-good",JSON.stringify([makeItem("good",0)]),2);
    const good=await maintenance(1);
    assert.equal(good.completed,1);
    assert.equal(good.remaining.pendingIngest,1);
    assert.equal((await db.prepare("SELECT payload FROM article_ingest_pending WHERE id='poison'").get()).payload,"{");
    assert.equal((await health()).status,"degraded");
    console.log("PASS poison retained with retries, valid work advances, degraded status remains");
    console.log(JSON.stringify({result:"passed",checks:5,productionD1:false,compatibilityDate:options.compatibilityDate}));
}finally{await mf.dispose();await rm(dir,{recursive:true,force:true});}
