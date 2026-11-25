import { resolve } from "node:path";
import { createDatabase } from "db0";
import { parseArgs } from "node:util";
import { stat } from "node:fs/promises";
import sqliteConnector from "db0/connectors/better-sqlite3";

import {
    compareArticleEvents,
    hasArticleEventAliases,
    approveArticleEventAlias,
} from "../../server/database/article-event-aliases";

const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        db: { type: "string" },
        actor: { type: "string" },
        evidence: { type: "string" },
        confirm: { type: "boolean" },
    },
});
const [command, aliasId, canonicalId] = positionals;
if (!values.db || positionals.length !== 3 || !["compare", "approve"].includes(command)) {
    throw new Error("Usage: pnpm events:review --db <existing sqlite file> compare|approve <aliasId> <canonicalId>");
}
const path = resolve(values.db);
if (!(await stat(path)).isFile()) throw new Error("Database must be an existing file.");
const db = createDatabase(sqliteConnector({ path }));
try {
    if (command === "compare") {
        console.log(JSON.stringify(await compareArticleEvents(db, aliasId, canonicalId), null, 2));
    } else {
        if (!values.confirm || !values.actor || !values.evidence) {
            throw new Error(
                "Approval requires --confirm, --actor and --evidence; review and back up the database first."
            );
        }
        if (!(await hasArticleEventAliases(db))) throw new Error("Initialize the N4-I schema first.");
        console.log(
            JSON.stringify(
                await approveArticleEventAlias(db, {
                    aliasId,
                    canonicalId,
                    actor: values.actor,
                    evidence: values.evidence,
                }),
                null,
                2
            )
        );
    }
} finally {
    await db.dispose();
}
