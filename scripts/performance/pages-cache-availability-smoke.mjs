import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { rm, mkdtemp, readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import { ArticleIndex } from "../../server/database/article-index.ts";
import { createRequestD1Database } from "../../server/database/request-d1.ts";
import { executeArticleBatch } from "../../server/database/article-atomic-batch.ts";

const root=fileURLToPath(new URL("../..",import.meta.url));
const config=JSON.parse(await readFile(join(root,"wrangler.json"),"utf8"));
const {Miniflare}=createRequire(join(resolve(process.env.LATESTNEWS_MINIFLARE_DIR),"package.json"))("miniflare");
const dir=await mkdtemp(join(tmpdir(),"latestnews-pages-availability-"));
const options={
    modules:true,scriptPath:join(root,"dist/_worker.js/index.js"),
    compatibilityDate:process.env.LATESTNEWS_D1_TEST_COMPAT_DATE||config.compatibility_date,
    compatibilityFlags:["nodejs_compat"],
    d1Databases:{LATESTNEWS_DB:"pages-availability-fixture"},d1Persist:dir,
    bindings:{ENABLE_CACHE:"true",INIT_TABLE:"true"},
    outboundService:{external:{address:"127.0.0.1:1"}},
};
let mf=new Miniflare(options);
const now=Date.now();
const makeItem=(id)=>({id,title:"Availability fixture "+id,url:"https://example.test/"+id,pubDate:now});
async function request(path,body){
    const timeoutMs=path.endsWith("/insights")?12000:5000;
    const start=performance.now();
    const response=await mf.dispatchFetch("http://localhost"+path,{
        ...(body?{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}:{}),
        signal:AbortSignal.timeout(timeoutMs),
    });
    const value=await response.json();
    assert.equal(response.status,200,JSON.stringify(value));
    const elapsed=performance.now()-start;
    assert.ok(elapsed<timeoutMs,`Availability deadline exceeded: ${path}, ${elapsed} ms`);
    return {value,ms:Math.round(elapsed*1000)/1000};
}
try{
    // Actual cold worker with a new database; no external schema initializer.
    const initial=await request("/api/v1/health/deployment");
    assert.equal(initial.value.data.checks.cache.status,"ok");
    const db=createRequestD1Database(await mf.getD1Database("LATESTNEWS_DB"));
    const index=new ArticleIndex(db);
    await index.probe();
    await index.upsertSourceItems("hackernews",Array.from({length:818},(_,i)=>makeItem("indexed-"+i)));
    const catalog=(await request("/api/v1/sources")).value.data.sources;
    const ids=catalog.filter(source=>!source.disabled && !source.redirect).map(source=>source.id);
    assert.ok(ids.length>=40);
    const keys=[...new Set([...ids,...Array.from({length:71},(_,i)=>"legacy-"+i)])].slice(0,Math.max(71,ids.length));
    assert.equal(keys.length,71);
    const pendingIds=new Set(keys.slice(0,21));
    for(const [i,key] of keys.entries()){
        const payload=JSON.stringify(Array.from({length:30},(_,j)=>makeItem("cached-"+i+"-"+j)));
        await executeArticleBatch(db,[
            {sql:"INSERT INTO cache VALUES(?,?,?)",params:[key,now,payload]},
            ...(pendingIds.has(key)
                ? [{sql:"INSERT INTO article_ingest_pending(id,source_id,payload,observed_at) VALUES(?,?,?,?)",params:["pending-"+i,key,payload,now]}]
                : [{sql:"INSERT INTO article_ingest_checkpoint VALUES(?,?,?)",params:[key,payload,now]}]),
        ]);
    }
    await mf.dispose();
    mf=new Miniflare(options);
    const reopened=createRequestD1Database(await mf.getD1Database("LATESTNEWS_DB"));
    const counts=async()=>await reopened.prepare("SELECT (SELECT count(*) FROM cache) AS cache_count,(SELECT count(*) FROM articles) AS articles,(SELECT count(*) FROM article_ingest_pending) AS pending").get();
    assert.deepEqual(await counts(),{cache_count:71,articles:818,pending:21});
    const parallel=await Promise.all(Array.from({length:4},()=>[
        request("/api/v1/health/deployment"),
        request("/api/v1/articles/search?q=Availability&limit=5"),
        request("/api/v1/sources/hackernews/items"),
    ]).flat());
    for(const [i,r] of parallel.entries()){
        if(i%3===0){assert.equal(r.value.data.checks.cache.status,"ok");assert.equal(r.value.data.checks.articleIndex.pendingIngest,21);}
        if(i%3===1)assert.equal(r.value.data.items.length,5);
        if(i%3===2)assert.equal(r.value.data.items.length,30);
    }
    assert.deepEqual(await counts(),{cache_count:71,articles:818,pending:21});
    console.log("PASS 12 concurrent database-backed reads with 71 caches, 818 indexed articles and 21 pending snapshots; no journal replay",JSON.stringify(parallel.map(r=>r.ms)));
    const insight=await request("/api/v1/insights",{sources:ids,minTopicItems:1});
    assert.equal(insight.value.meta.resolvedSourceCount,ids.length);
    assert.equal(insight.value.meta.partial,false);
    assert.ok(insight.value.data.hotRankings.length>0);
    // The request can return while one deferred snapshot is being repaired.
    for(let i=0;i<100;i++){
        if((await counts()).pending===20)break;
        await delay(50);
    }
    const after=await counts();
    assert.deepEqual(after,{cache_count:71,articles:848,pending:20});
    assert.equal((await request("/api/v1/articles/search?q=cached-0&limit=5")).value.data.status,"ok");
    console.log("PASS full cached insights returns all selected sources; exactly one deferred journal snapshot recovered",JSON.stringify({sources:ids.length,ms:insight.ms,after}));
    // Recover another snapshot on a later request; demonstrate retained work.
    await request("/api/v1/insights",{sources:ids.slice(0,2)});
    for(let i=0;i<100;i++){if((await counts()).pending===19)break;await delay(50);}
    assert.equal((await counts()).pending,19);
    console.log("PASS subsequent request advances backlog without clearing other snapshots");
    const native=await mf.getD1Database("LATESTNEWS_DB");
    let batchCalls=0,statements=0;
    const counted=createRequestD1Database({
        prepare:sql=>native.prepare(sql),exec:sql=>native.exec(sql),
        batch:async rows=>{batchCalls++;statements+=rows.length;return native.batch(rows);}
    });
    const batched=new ArticleIndex(counted);await batched.probe(false);
    const fixture=Array.from({length:29},(_,i)=>makeItem("batched-"+i));
    fixture.push({...fixture[0],id:"last-observation",title:"Batched duplicate final title"});
    const collision="article-v2-"+createHash("sha256").update(fixture[1].url).digest("hex");
    const occupied=makeItem("occupied-candidate");
    await reopened.prepare("INSERT INTO articles VALUES(?,?,?,?,?,?,?,?,?)").run(
        collision,occupied.url,occupied.title,now,"old",null,JSON.stringify(occupied),now,now
    );
    assert.deepEqual(await batched.upsertSourceItems("hackernews",fixture),{inserted:29,updated:1});
    assert.equal(batchCalls,2);assert.equal(statements,7);
    const stored=await reopened.prepare("SELECT article_key,title FROM articles WHERE canonical_url=?").get(fixture[1].url);
    assert.notEqual(stored.article_key,collision);
    assert.equal((await reopened.prepare("SELECT canonical_url FROM articles WHERE article_key=?").get(collision)).canonical_url,occupied.url);
    assert.equal((await reopened.prepare("SELECT title FROM articles WHERE canonical_url=?").get(fixture[0].url)).title,"Batched duplicate final title");
    const mapping=await reopened.prepare("SELECT raw_item_id FROM article_sources WHERE article_key=(SELECT article_key FROM articles WHERE canonical_url=?) AND source_id=?").get(fixture[0].url,"hackernews");
    assert.equal(mapping.raw_item_id,"last-observation");
    console.log("PASS D1 30-item snapshot uses two batches/seven statements; duplicate and candidate-key collision preserve identity");

}finally{await mf.dispose();await rm(dir,{recursive:true,force:true});}
