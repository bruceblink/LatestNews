import { createRequire } from "node:module";

interface SqliteStatement {
    run(...values: Array<number | string>): { changes: number };
}

interface SqliteDatabase {
    prepare(query: string): SqliteStatement;
    close(): void;
}

interface SqliteDatabaseConstructor {
    new (path: string): SqliteDatabase;
}

const BetterSqlite3 = createRequire(import.meta.url)("better-sqlite3") as SqliteDatabaseConstructor;

/** Limit benchmark cache mutations to the supplied isolated SQLite database. */
export function createPerformanceCacheController(databasePath: string) {
    const database = new BetterSqlite3(databasePath);
    let closed = false;

    function validateSourceIds(sourceIds: string[]) {
        if (
            closed ||
            sourceIds.length === 0 ||
            sourceIds.some((sourceId) => !sourceId.trim()) ||
            new Set(sourceIds).size !== sourceIds.length
        ) {
            throw new Error("Performance cache operations require open database state and unique source IDs.");
        }
    }

    return {
        clear(sourceIds: string[]) {
            validateSourceIds(sourceIds);
            const placeholders = sourceIds.map(() => "?").join(", ");
            database.prepare(`DELETE FROM cache WHERE id IN (${placeholders})`).run(...sourceIds);
        },
        setUpdatedAt(sourceIds: string[], updatedAt: number) {
            validateSourceIds(sourceIds);
            if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) {
                throw new Error("Performance cache timestamps must be non-negative safe integers.");
            }

            const placeholders = sourceIds.map(() => "?").join(", ");
            const result = database
                .prepare(`UPDATE cache SET updated = ? WHERE id IN (${placeholders})`)
                .run(updatedAt, ...sourceIds);
            if (result.changes !== sourceIds.length) {
                throw new Error(`Expected ${sourceIds.length} cached sources to age, found ${result.changes}.`);
            }
        },
        close() {
            if (closed) return;
            closed = true;
            database.close();
        },
    };
}

export type PerformanceCacheController = ReturnType<typeof createPerformanceCacheController>;
