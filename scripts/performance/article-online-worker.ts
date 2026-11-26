import { createDatabase } from "db0";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import sqliteConnector from "db0/connectors/better-sqlite3";

import { logger } from "../../server/utils/logger";
import { slotExpired } from "./article-online-gate";
import { Cache } from "../../server/database/cache-store";
import { ArticleIndex } from "../../server/database/article-index";
import { slowSpans, captureSpan } from "./article-online-diagnostics";
import { isBusy, runtimeMetrics, instrumentSqlite, type NativeSqlite } from "./article-online-metrics";

import type { NewsItem, SourceID } from "../../shared/types";
import type { SqliteBuildPage } from "../../server/database/article-recovery";

export interface OnlineSample {
    sequence: number;
    startedAt: number;
    endedAt: number;
    durationMs: number;
    schedulingLagMs: number;
    retries: number;
    ok: boolean;
    mode?: string;
}
export interface OnlineStart {
    startAt: number;
    endAt: number;
}
export const ONLINE_SOURCE_COUNT = 4;
export const ITEMS_PER_SNAPSHOT = 30;
export const sourceFor = (sequence: number) => ("load-" + (sequence % ONLINE_SOURCE_COUNT)) as SourceID;
const loadUrl = "https://example.test/online-load/";
export function snapshot(sequence: number): NewsItem[] {
    const source = sourceFor(sequence);
    return Array.from({ length: ITEMS_PER_SNAPSHOT }, (_, i) => {
        const id = i === 0 ? "marker-" + sequence : source + "-" + i;
        return { id, url: loadUrl + id, title: "Load observation " + sequence + " " + id, pubDate: 1795550000000 };
    });
}

export async function runOnlineWorker(
    path: string,
    role: "write" | "read",
    rate: number,
    size: number,
    page: SqliteBuildPage
) {
    logger.level = 2;
    const db = createDatabase(sqliteConnector({ path }));
    try {
        const native = (await db.getInstance()) as NativeSqlite;
        native.pragma("synchronous = FULL");
        const cache = new Cache(db, { sqliteBuildPage: page });
        await cache.check(false);
        const index = new ArticleIndex(db);
        assert.equal(await index.probe(false), true);
        const metrics = instrumentSqlite(native);
        const start = new Promise<OnlineStart>((resolve) =>
            process.once("message", (message) => resolve(message as OnlineStart))
        );
        process.send?.({ kind: "ready" });
        const { startAt, endAt } = await start;
        const runtime = runtimeMetrics();
        const samples: OnlineSample[] = [];
        const slow = slowSpans();
        const interval = 1000 / rate;
        const slots = Math.round(((endAt - startAt) / 1000) * rate);
        let skipped = 0;
        let sequence = 0;
        while (sequence < slots) {
            const due = startAt + sequence * interval;
            if (slotExpired(Date.now(), due, interval, endAt)) {
                sequence++;
                skipped++;
                continue;
            }
            if (due > Date.now()) await delay(due - Date.now());
            // Timer callbacks can resume after a scheduler/storage stall.
            // Never execute an expired slot just because its sleep completed.
            if (slotExpired(Date.now(), due, interval, endAt)) {
                sequence++;
                skipped++;
                continue;
            }
            const startedAt = Date.now();
            const t = performance.now();
            const done = captureSpan(role);
            let ok = false;
            let retries = 0;
            let mode: string | undefined;
            for (;;) {
                try {
                    if (role === "write") await cache.set(sourceFor(sequence), snapshot(sequence));
                    else {
                        const result = await index.search({ query: "uniqueauditneedle", limit: 2 });
                        assert.equal(result.status, "ok");
                        assert.equal(result.items.length, 1);
                        assert.equal(String(result.items[0].item.id), "seed-" + (size - 1));
                        mode = result.mode;
                    }
                    ok = true;
                    break;
                } catch (error) {
                    if (!isBusy(error) || retries >= 2) {
                        console.error("Online benchmark operation failed:", error);
                        break;
                    }
                    retries++;
                    await delay(10 * retries);
                }
            }
            slow.record(done());
            samples.push({
                sequence,
                startedAt,
                endedAt: Date.now(),
                durationMs: performance.now() - t,
                schedulingLagMs: Math.max(0, startedAt - due),
                retries,
                ok,
                mode,
            });
            runtime.sample();
            sequence++;
        }
        return {
            role,
            rate,
            slots: sequence,
            skipped,
            samples,
            metrics: metrics(),
            runtime: runtime.finish(),
            slow: slow.finish(),
        };
    } finally {
        await db.dispose();
    }
}
