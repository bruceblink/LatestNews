import process from "node:process";
import { resolve } from "node:path";
import { constants } from "node:fs";
import { createDatabase } from "db0";
import { parseArgs } from "node:util";
import { stat, copyFile } from "node:fs/promises";
import sqliteConnector from "db0/connectors/better-sqlite3";

import { Cache } from "../../server/database/cache-store";

const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        db: { type: "string" },
        backup: { type: "string" },
        confirm: { type: "boolean" },
        passes: { type: "string", default: "5" },
    },
});
const [command] = positionals;
const passes = Number(values.passes);
if (
    !values.db ||
    positionals.length !== 1 ||
    !["status", "repair", "migrate", "backup", "restore-copy"].includes(command) ||
    !Number.isInteger(passes) ||
    passes < 1 ||
    passes > 100
)
    throw new Error(
        "Usage: pnpm articles:maintain --db <existing file> status|repair|migrate|backup|restore-copy [--backup <new file>] [--confirm] [--passes 1..100]"
    );
const path = resolve(values.db);
if (!(await stat(path)).isFile()) throw new Error("Database must be an existing file.");
if (command === "restore-copy") {
    if (!values.confirm || !values.backup)
        throw new Error(
            "Restore copy requires --confirm and --backup <new destination>; never overwrites an existing database."
        );
    // A backup created by SQLite's online backup API is self-contained.
    await copyFile(path, resolve(values.backup), constants.COPYFILE_EXCL);
    console.log("Created a restore copy. Validate it before replacing a stopped deployment.");
} else {
    const db = createDatabase(sqliteConnector({ path }));
    try {
        const cache = new Cache(db);
        if (command === "status") {
            await cache.check();
            console.log(JSON.stringify(await cache.getArticleIndexHealth(), null, 2));
        } else if (command === "backup" || command === "migrate") {
            if (!values.backup) throw new Error("Specify a new --backup path.");
            const target = resolve(values.backup);
            // Reserve the output name exclusively; SQLite backup includes committed WAL content.
            const { open } = await import("node:fs/promises");
            const reserved = await open(target, "wx", 0o600);
            await reserved.close();
            const sqlite = await db.getInstance();
            await sqlite.backup(target);
            const copy = createDatabase(sqliteConnector({ path: target }));
            try {
                const result = await copy.prepare("PRAGMA integrity_check").get();
                if (!result || Object.values(result)[0] !== "ok") throw new Error("Backup integrity check failed.");
            } finally {
                await copy.dispose();
            }
            console.log("SQLite backup created and integrity-checked: " + target);
            if (command === "migrate") {
                if (!values.confirm) throw new Error("Migration requires --confirm after stopping all old writers.");
                await cache.init();
                for (let i = 0; i < passes; i++) await cache.maintainArticleIndex(10);
                const status = await cache.getArticleIndexHealth();
                console.log(JSON.stringify(status, null, 2));
                if (status.status !== "ok") process.exitCode = 2;
            }
        } else {
            if (!values.confirm) throw new Error("Repair requires --confirm.");
            await cache.check();
            await cache.rebuildArticleSearchIndex();
            for (let i = 0; i < passes; i++) await cache.maintainArticleIndex(10);
            const status = await cache.getArticleIndexHealth();
            console.log(JSON.stringify(status, null, 2));
            if (status.status !== "ok") process.exitCode = 2;
        }
    } finally {
        await db.dispose();
    }
}
