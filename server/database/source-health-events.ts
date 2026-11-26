import type { H3Event } from "h3";
import type { Database } from "db0";
import type { SourceID } from "@shared/types";
import type { SourceHealthEvent } from "@shared/source-health-types";

import process from "node:process";
import { useDatabase } from "nitro/database";
import { describeSourceError, safeSourceErrorMessage } from "@shared/source-error";

import { logger } from "../utils/logger";
import { createRequestD1Database } from "./request-d1";

export interface SourceHealthEventRecord extends SourceHealthEvent {
    sourceId: SourceID;
}

interface SourceHealthEventRow {
    id: string;
    source_id: SourceID;
    status: SourceHealthEvent["status"];
    occurred_at: number;
    duration_ms: number;
    item_count?: number | null;
    error_message?: string | null;
}

const DEFAULT_EVENT_LIMIT = 20;

export class SourceHealthEvents {
    private db: Database;

    constructor(db: Database) {
        this.db = db;
    }

    async init() {
        await this.db
            .prepare(
                `
                  CREATE TABLE IF NOT EXISTS source_health_events (
                    id TEXT PRIMARY KEY,
                    source_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    occurred_at INTEGER NOT NULL,
                    duration_ms INTEGER NOT NULL,
                    item_count INTEGER,
                    error_message TEXT
                  );
              `
            )
            .run();
        await this.db
            .prepare(
                `
                  CREATE INDEX IF NOT EXISTS idx_source_health_events_source_time
                  ON source_health_events (source_id, occurred_at DESC);
              `
            )
            .run();
        logger.success("init source health events table");
    }

    async append(sourceId: SourceID, event: SourceHealthEvent, limit = DEFAULT_EVENT_LIMIT) {
        await this.db
            .prepare(
                `INSERT INTO source_health_events (id, source_id, status, occurred_at, duration_ms, item_count, error_message)
                 VALUES (?, ?, ?, ?, ?, ?, ?);`
            )
            .run(
                createEventId(sourceId, event),
                sourceId,
                event.status,
                event.occurredAt,
                event.durationMs,
                event.itemCount ?? null,
                event.errorMessage ? safeSourceErrorMessage(event.errorMessage) : null
            );
        await this.trim(sourceId, limit);
    }

    async listRecent(sourceId?: SourceID, limit = DEFAULT_EVENT_LIMIT): Promise<SourceHealthEventRecord[]> {
        const query = sourceId
            ? this.db
                  .prepare(
                      `SELECT id, source_id, status, occurred_at, duration_ms, item_count, error_message
                       FROM source_health_events
                       WHERE source_id = ?
                       ORDER BY occurred_at DESC, id DESC
                       LIMIT ?;`
                  )
                  .all(sourceId, limit)
            : this.db
                  .prepare(
                      `SELECT id, source_id, status, occurred_at, duration_ms, item_count, error_message
                       FROM source_health_events
                       ORDER BY occurred_at DESC, id DESC
                       LIMIT ?;`
                  )
                  .all(limit);
        const result = (await query) as any;
        const rows = (result.results ?? result) as SourceHealthEventRow[];

        return rows.map(rowToEventRecord);
    }

    async clear(sourceId: SourceID) {
        return await this.db.prepare("DELETE FROM source_health_events WHERE source_id = ?").run(sourceId);
    }

    private async trim(sourceId: SourceID, limit: number) {
        await this.db
            .prepare(
                `DELETE FROM source_health_events
                 WHERE source_id = ?
                   AND id NOT IN (
                     SELECT id
                     FROM source_health_events
                     WHERE source_id = ?
                     ORDER BY occurred_at DESC, id DESC
                     LIMIT ?
                   );`
            )
            .run(sourceId, sourceId, limit);
    }
}

let sourceHealthEventsTablePromise: Promise<SourceHealthEvents | undefined> | undefined;

export async function getSourceHealthEventsTable() {
    sourceHealthEventsTablePromise ??= (async () => {
        try {
            if (process.env.ENABLE_CACHE === "false") return undefined;

            const table = new SourceHealthEvents(useDatabase());
            if (process.env.INIT_TABLE !== "false") await table.init();
            return table;
        } catch (error) {
            sourceHealthEventsTablePromise = undefined;
            logger.error("failed to init source health events table", describeSourceError(error));
            return undefined;
        }
    })();

    return sourceHealthEventsTablePromise;
}

/** A collection owns the request that first started it, including its health write. */
export interface SourceHealthPersistence {
    append(sourceId: SourceID, event: SourceHealthEvent): Promise<void>;
    retain(work: Promise<unknown>): void;
}

const requestPersistence = new WeakMap<H3Event, SourceHealthPersistence>();

export function getRequestSourceHealthPersistence(event?: H3Event): SourceHealthPersistence | undefined {
    const cloudflare = event?.req.runtime?.cloudflare;
    if (!event || !cloudflare) return undefined;
    const existing = requestPersistence.get(event);
    if (existing) return existing;

    // Capture the binding and flags now. Neither a subsequent request nor
    // a process-global D1 connector can change the destination of this write.
    const binding = cloudflare.env.LATESTNEWS_DB;
    const enabled = (cloudflare.env.ENABLE_CACHE ?? process.env.ENABLE_CACHE) !== "false";
    const initialize = (cloudflare.env.INIT_TABLE ?? process.env.INIT_TABLE) !== "false";
    let tablePromise: Promise<SourceHealthEvents> | undefined;
    const persistence: SourceHealthPersistence = {
        async append(sourceId, sample) {
            if (!enabled) return;
            tablePromise ??= (async () => {
                const table = new SourceHealthEvents(createRequestD1Database(binding));
                if (initialize) await table.init();
                return table;
            })();
            try {
                const table = await tablePromise;
                await table.append(sourceId, sample);
            } catch (error) {
                tablePromise = undefined;
                logger.warn("Could not persist request source health", describeSourceError(error));
            }
        },
        retain(work) {
            try {
                event.waitUntil(
                    work.catch((error: unknown) => {
                        logger.warn("Source health background work failed", describeSourceError(error));
                    })
                );
            } catch (error) {
                logger.warn("Could not retain request source health work", describeSourceError(error));
            }
        },
    };
    requestPersistence.set(event, persistence);
    return persistence;
}

function rowToEventRecord(row: SourceHealthEventRow): SourceHealthEventRecord {
    return {
        sourceId: row.source_id,
        status: row.status,
        occurredAt: row.occurred_at,
        durationMs: row.duration_ms,
        ...(row.item_count !== null && row.item_count !== undefined && { itemCount: row.item_count }),
        ...(row.error_message && { errorMessage: safeSourceErrorMessage(row.error_message) }),
    };
}

function createEventId(sourceId: SourceID, event: SourceHealthEvent) {
    return [
        sourceId,
        event.status,
        event.occurredAt,
        event.durationMs,
        event.itemCount ?? 0,
        Math.random().toString(36).slice(2, 8),
    ].join(":");
}
