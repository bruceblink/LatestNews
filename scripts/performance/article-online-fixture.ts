import { createDatabase } from "db0";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import sqliteConnector from "db0/connectors/better-sqlite3";

import { Cache } from "../../server/database/cache-store";
import { snapshot, sourceFor } from "./article-online-worker";
import { ArticleIndex } from "../../server/database/article-index";
import { ftsIsInconsistent } from "../../server/database/article-recovery";

import type { OnlineSample } from "./article-online-worker";
import type { NativeSqlite } from "./article-online-metrics";

export async function initializeOnlineFixture(path: string, size: number, journal: "delete" | "wal" = "delete") {
    const db = createDatabase(sqliteConnector({ path }));
    try {
        const native = (await db.getInstance()) as NativeSqlite;
        native.pragma("journal_mode = " + journal);
        native.pragma("synchronous = FULL");
        assert.deepEqual(native.pragma("journal_mode"), [{ journal_mode: journal }]);
        await new Cache(db).init();
        const insert = native.prepare("INSERT INTO articles VALUES(?,?,?,?,?,?,?,?,?)");
        const mapping = native.prepare("INSERT INTO article_sources VALUES(?,?,?,?,?)");
        const fts = native.prepare("INSERT INTO article_search VALUES(?,?,?)");
        const time = 1795550000000;
        for (let offset = 0; offset < size; offset += 500) {
            native
                .transaction(() => {
                    for (let i = offset; i < Math.min(size, offset + 500); i++) {
                        const url = "https://example.test/online-seed/" + i;
                        const key = "article-v2-" + createHash("sha256").update(url).digest("hex");
                        const title = i === size - 1 ? "uniqueauditneedle fixture" : "Benchmark article " + i;
                        const payload = JSON.stringify({ id: "seed-" + i, url, title, pubDate: time - i });
                        insert.run(key, url, title, time - i, key, null, payload, time, time);
                        mapping.run(key, "seed", "seed-" + i, time, time);
                        fts.run(key, title, url);
                    }
                })
                .immediate();
        }
        await new ArticleIndex(db).init();
        assert.equal(await ftsIsInconsistent(db), false);
        return {
            sqlite: native.prepare("SELECT sqlite_version() AS version").get(),
            journal: native.pragma("journal_mode"),
            synchronous: native.pragma("synchronous"),
            busyTimeout: native.pragma("busy_timeout"),
        };
    } finally {
        await db.dispose();
    }
}

export async function verifyOnlineFixture(path: string, size: number, writes: OnlineSample[]) {
    const db = createDatabase(sqliteConnector({ path }));
    try {
        const cache = new Cache(db);
        await cache.check(false);
        const expected = new Map<string, { title: string; source: string }>();
        const latest = new Map<string, ReturnType<typeof snapshot>>();
        for (const row of writes) {
            if (!row.ok) continue;
            const source = sourceFor(row.sequence);
            const items = snapshot(row.sequence);
            latest.set(source, items);
            for (const item of items) expected.set(item.url, { title: item.title, source });
        }
        const actual = (await db
            .prepare(
                "SELECT a.canonical_url,a.title,s.source_id FROM articles a JOIN article_sources s ON a.article_key=s.article_key WHERE a.canonical_url LIKE 'https://example.test/online-load/%'"
            )
            .all()) as Array<{ canonical_url: string; title: string; source_id: string }>;
        assert.equal(actual.length, expected.size, "all acknowledged observations must be indexed");
        for (const row of actual)
            assert.deepEqual({ title: row.title, source: row.source_id }, expected.get(row.canonical_url));
        for (const [source, items] of latest) assert.deepEqual((await cache.get(source))?.items, items);
        const count = (await db.prepare("SELECT COUNT(*) AS n FROM articles").get()) as { n: number };
        assert.equal(count.n, size + expected.size);
        const mappings = (await db.prepare("SELECT COUNT(*) AS n FROM article_sources").get()) as { n: number };
        assert.equal(mappings.n, count.n);
        assert.equal(await ftsIsInconsistent(db), false);
        const health = await cache.getArticleIndexHealth();
        assert.deepEqual(
            {
                status: health.status,
                fts: health.fts,
                pendingIngest: health.pendingIngest,
                pendingFts: health.pendingFts,
                untrackedCache: "untrackedCache" in health ? health.untrackedCache : null,
                audit: health.ftsAudit?.status,
            },
            { status: "ok", fts: "ok", pendingIngest: 0, pendingFts: 0, untrackedCache: 0, audit: "verified" }
        );
        return {
            articles: count.n,
            acknowledgedSnapshots: writes.filter((x) => x.ok).length,
            uniqueLoadArticles: expected.size,
            health,
        };
    } finally {
        await db.dispose();
    }
}
