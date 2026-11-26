import type { Database } from "db0";

/** The only database targets of ArticleIndex are better-sqlite3 and Cloudflare D1.
 * Never use an async BEGIN/COMMIT sequence on a shared connection. */
type Value = string | number | null;
export interface AtomicStatement {
    sql: string;
    params?: Value[];
    rows?: boolean;
}
interface LocalStatement {
    run(...params: Value[]): unknown;
    all(...params: Value[]): unknown[];
}
interface LocalSqlite {
    prepare(sql: string): LocalStatement;
    transaction<T>(run: () => T): { immediate(): T };
}
interface D1Statement {
    bind(...params: Value[]): D1Statement;
}
interface D1Binding {
    prepare(sql: string): D1Statement;
    batch(statements: D1Statement[]): Promise<Array<{ success: boolean; results?: unknown[] }>>;
}

export async function executeArticleBatch(
    db: Database,
    statements: AtomicStatement[],
    maintenanceOwner?: string
): Promise<unknown[][]> {
    // A stale maintenance worker must not mutate articles after another owner
    // has acquired the lease. The sentinel deliberately violates CHECK(id=1)
    // only on a lost lease, aborting the whole atomic SQLite/D1 batch.
    const fenced = maintenanceOwner !== undefined;
    if (fenced)
        statements = [
            {
                sql: `INSERT INTO article_maintenance_lease(id,owner,expires_at)
            SELECT 0,'',0 WHERE NOT EXISTS(SELECT 1 FROM article_maintenance_lease
                WHERE id=1 AND owner=? AND expires_at>?)`,
                params: [maintenanceOwner, Date.now()],
            },
            ...statements,
        ];
    const instance = await db.getInstance();
    if (db.connector === "sqlite") {
        const sqlite = instance as LocalSqlite;
        return sqlite
            .transaction(() =>
                statements.map(({ sql, params = [], rows }) => {
                    const statement = sqlite.prepare(sql);
                    if (rows) return statement.all(...params);
                    statement.run(...params);
                    return [];
                })
            )
            .immediate()
            .slice(fenced ? 1 : 0);
    }
    if (db.connector === "cloudflare-d1") {
        const binding = instance as D1Binding;
        const results = await binding.batch(
            statements.map(({ sql, params = [] }) => {
                const statement = binding.prepare(sql);
                return params.length ? statement.bind(...params) : statement;
            })
        );
        if (results.length !== statements.length || results.some((result) => !result.success)) {
            throw new Error("Article database batch failed.");
        }
        return results.slice(fenced ? 1 : 0).map((result) => result.results ?? []);
    }
    throw new Error("Unsupported article database connector.");
}
