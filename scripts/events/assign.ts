import { resolve } from "node:path";
import { createDatabase } from "db0";
import { parseArgs } from "node:util";
import { stat, readFile } from "node:fs/promises";
import sqliteConnector from "db0/connectors/better-sqlite3";

import { assignReviewedEvent } from "../../server/database/article-event-governance";

const { values } = parseArgs({
    options: {
        db: { type: "string" },
        urls: { type: "string" },
        actor: { type: "string" },
        evidence: { type: "string" },
        event: { type: "string" },
        confirm: { type: "boolean" },
    },
});
if (!values.db || !values.urls || !values.actor || !values.evidence || !values.confirm)
    throw new Error(
        "Usage: pnpm events:assign --db <existing sqlite file> --urls <JSON array of reviewed URLs> --actor <name> --evidence <reference> [--event <existing canonical ID>] --confirm"
    );
const path = resolve(values.db);
if (!(await stat(path)).isFile()) throw new Error("Database must be an existing file.");
const file = resolve(values.urls);
if ((await stat(file)).size > 1_000_000) throw new Error("Reviewed URL file too large.");
const urls: unknown = JSON.parse(await readFile(file, "utf8"));
if (!Array.isArray(urls) || urls.some((url) => typeof url !== "string"))
    throw new Error("Expected a JSON array of URLs.");
const db = createDatabase(sqliteConnector({ path }));
try {
    console.log(
        JSON.stringify(
            await assignReviewedEvent(db, {
                urls,
                actor: values.actor,
                evidence: values.evidence,
                eventId: values.event,
            }),
            null,
            2
        )
    );
} finally {
    await db.dispose();
}
