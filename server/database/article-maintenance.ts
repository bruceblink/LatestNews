import type { Database } from "db0";

import { randomUUID } from "node:crypto";

import { executeArticleBatch } from "./article-atomic-batch";

export const MAINTENANCE_LEASE_MS = 60_000;
export const MAINTENANCE_BUDGET_MS = 5_000;
export const SNAPSHOT_CHUNK_SIZE = 30;
export const maintenanceTables = ["article_maintenance_lease", "article_ingest_work"] as const;

export type MaintenanceBacklog = {
    pendingIngest: number;
    oldestObservedAt: number | null;
    oldestAgeMs: number | null;
    attempts: number;
    deferred: number;
};

export type MaintenanceResult = {
    status: "ok" | "pending" | "busy" | "unavailable" | "interrupted";
    attempted: number;
    completed: number;
    failed: number;
    advanced: number;
    remaining: MaintenanceBacklog | null;
    pendingFts: number | null;
    untrackedCache: number | null;
    durationMs: number;
};

export async function initArticleMaintenance(db: Database) {
    await db
        .prepare(
            "CREATE TABLE IF NOT EXISTS article_maintenance_lease(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,expires_at INTEGER NOT NULL)"
        )
        .run();
    await db
        .prepare(
            "CREATE TABLE IF NOT EXISTS article_ingest_work(id TEXT PRIMARY KEY,next_offset INTEGER NOT NULL,next_attempt_at INTEGER NOT NULL)"
        )
        .run();
}

export async function hasArticleMaintenance(db: Database) {
    const row = (await db
        .prepare(
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('article_maintenance_lease','article_ingest_work')"
        )
        .get()) as { count: number };
    return Number(row.count) === maintenanceTables.length;
}

export const leaseGuard = "EXISTS(SELECT 1 FROM article_maintenance_lease WHERE id=1 AND owner=? AND expires_at>?)";

export async function acquireMaintenanceLease(db: Database, now = Date.now()) {
    const owner = randomUUID();
    const [rows] = await executeArticleBatch(db, [
        {
            sql: `INSERT INTO article_maintenance_lease VALUES(1,?,?)
            ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at
            WHERE article_maintenance_lease.expires_at<=? RETURNING owner`,
            params: [owner, now + MAINTENANCE_LEASE_MS, now],
            rows: true,
        },
    ]);
    return rows.length ? owner : undefined;
}

export async function ownsMaintenanceLease(db: Database, owner: string, now = Date.now()) {
    const row = await db
        .prepare("SELECT owner FROM article_maintenance_lease WHERE id=1 AND owner=? AND expires_at>?")
        .get(owner, now);
    return Boolean(row);
}

export async function releaseMaintenanceLease(db: Database, owner: string) {
    await db.prepare("DELETE FROM article_maintenance_lease WHERE id=1 AND owner=?").run(owner);
}

/** First retry stays immediate for compatibility. Further failures back off, never discard. */
export function retryDelay(attempts: number) {
    return attempts < 2 ? 0 : Math.min(300_000, 1_000 * 2 ** Math.min(attempts - 2, 9));
}

export async function readMaintenanceBacklog(db: Database, now = Date.now()): Promise<MaintenanceBacklog> {
    const row = (await db
        .prepare(
            `SELECT COUNT(*) AS pending,MIN(p.observed_at) AS oldest,
            COALESCE(SUM(p.attempts),0) AS attempts,
            COALESCE(SUM(CASE WHEN w.next_attempt_at>? THEN 1 ELSE 0 END),0) AS deferred
            FROM article_ingest_pending p LEFT JOIN article_ingest_work w ON w.id=p.id`
        )
        .get(now)) as { pending: number; oldest: number | null; attempts: number; deferred: number };
    return {
        pendingIngest: Number(row.pending),
        oldestObservedAt: row.oldest,
        oldestAgeMs: row.oldest === null ? null : Math.max(0, now - row.oldest),
        attempts: Number(row.attempts),
        deferred: Number(row.deferred),
    };
}
