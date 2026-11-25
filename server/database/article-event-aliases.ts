import type { Database } from "db0";

import { extractInsightTerms } from "@shared/news-insights";

export async function initArticleEventAliases(db: Database) {
    await db
        .prepare(
            `CREATE TABLE IF NOT EXISTS news_event_aliases (
            alias_id TEXT PRIMARY KEY NOT NULL,
            canonical_id TEXT NOT NULL CHECK (alias_id <> canonical_id),
            actor TEXT NOT NULL CHECK (length(trim(actor)) BETWEEN 1 AND 128),
            evidence TEXT NOT NULL CHECK (length(trim(evidence)) BETWEEN 1 AND 2000),
            approved_at INTEGER NOT NULL
        )`
        )
        .run();
    await db
        .prepare("CREATE INDEX IF NOT EXISTS idx_news_event_alias_target ON news_event_aliases(canonical_id, alias_id)")
        .run();
    await db
        .prepare(
            `CREATE TRIGGER IF NOT EXISTS trg_news_event_alias_guard
         BEFORE INSERT ON news_event_aliases
         WHEN NOT EXISTS (SELECT 1 FROM news_events WHERE event_id = NEW.alias_id)
           OR NOT EXISTS (SELECT 1 FROM news_events WHERE event_id = NEW.canonical_id)
           OR EXISTS (SELECT 1 FROM news_event_aliases WHERE alias_id = NEW.canonical_id OR canonical_id = NEW.alias_id)
         BEGIN
             SELECT RAISE(ABORT, 'Unknown event or alias chain');
         END`
        )
        .run();
    await db
        .prepare(
            `CREATE TRIGGER IF NOT EXISTS trg_news_event_alias_no_update
         BEFORE UPDATE ON news_event_aliases
         BEGIN SELECT RAISE(ABORT, 'Approved alias cannot be updated'); END`
        )
        .run();
}

export async function hasArticleEventAliases(db: Database) {
    return Boolean(
        await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'news_event_aliases'").get()
    );
}

export async function resolveArticleEventAlias(db: Database, eventId: string) {
    const row = (await db.prepare("SELECT canonical_id FROM news_event_aliases WHERE alias_id = ?").get(eventId)) as
        { canonical_id: string } | null | undefined;
    return row?.canonical_id ?? eventId;
}

export interface EventAliasApproval {
    aliasId: string;
    canonicalId: string;
    actor: string;
    evidence: string;
}

function validateEventId(id: string) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error("Invalid event ID.");
}

/** Explicit operator action only. No clustering path calls this function. */
export async function approveArticleEventAlias(db: Database, approval: EventAliasApproval) {
    const { aliasId, canonicalId } = approval;
    const actor = approval.actor.trim();
    const evidence = approval.evidence.trim();
    validateEventId(aliasId);
    validateEventId(canonicalId);
    if (aliasId === canonicalId || !actor || actor.length > 128 || !evidence || evidence.length > 2000) {
        throw new Error("Approval requires distinct IDs, actor and evidence.");
    }
    // The guard is evaluated in the same write statement. Repeated approvals retain the first audit record.
    await db
        .prepare(
            `INSERT INTO news_event_aliases(alias_id, canonical_id, actor, evidence, approved_at)
         SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM news_event_aliases WHERE alias_id = ?)`
        )
        .run(aliasId, canonicalId, actor, evidence, Date.now(), aliasId);
    const row = (await db
        .prepare("SELECT canonical_id, actor, evidence, approved_at FROM news_event_aliases WHERE alias_id = ?")
        .get(aliasId)) as
        { canonical_id: string; actor: string; evidence: string; approved_at: number } | null | undefined;
    if (!row || row.canonical_id !== canonicalId) throw new Error("Conflicting existing alias approval.");
    return { aliasId, canonicalId, actor: row.actor, evidence: row.evidence, approvedAt: row.approved_at };
}

interface EvidenceArticle {
    title: string;
    canonical_url: string;
    published_at: number | string | null;
}

/** Bounded evidence for a user-selected pair, including disjoint time windows. Never auto-approves. */
export async function compareArticleEvents(db: Database, leftId: string, rightId: string) {
    validateEventId(leftId);
    validateEventId(rightId);
    if (leftId === rightId) throw new Error("Compare two distinct events.");
    async function load(eventId: string) {
        if (!(await db.prepare("SELECT event_id FROM news_events WHERE event_id = ?").get(eventId))) {
            throw new Error("Unknown event: " + eventId);
        }
        const rows = (await db
            .prepare(
                "SELECT title, canonical_url, published_at FROM articles WHERE event_id = ? ORDER BY article_key LIMIT 21"
            )
            .all(eventId)) as EvidenceArticle[];
        return { items: rows.slice(0, 20), truncated: rows.length > 20 };
    }
    const [left, right] = await Promise.all([load(leftId), load(rightId)]);
    const terms = (items: EvidenceArticle[]) => new Set(items.flatMap((item) => extractInsightTerms(item.title)));
    const leftTerms = terms(left.items);
    const rightTerms = terms(right.items);
    const fingerprint = (title: string) => title.toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");
    const rightTitles = new Set(right.items.map((item) => fingerprint(item.title)));
    return {
        leftId,
        rightId,
        left,
        right,
        sharedTerms: [...leftTerms].filter((term) => rightTerms.has(term)).sort(),
        exactTitles: [
            ...new Set(left.items.filter((item) => rightTitles.has(fingerprint(item.title))).map((item) => item.title)),
        ],
        status: "requires-review" as const,
    };
}
