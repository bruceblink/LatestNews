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

export async function executeArticleBatch(db: Database, statements: AtomicStatement[]): Promise<unknown[][]> {
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
            .immediate();
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
        return results.map((result) => result.results ?? []);
    }
    throw new Error("Unsupported article database connector.");
}
