import type { Database } from "db0";
import type { TopicEvent } from "@shared/news-insights";

import { createHash, randomUUID } from "node:crypto";
import { safeNewsUrl } from "@shared/news-url-policy";
import { normalizeNewsItemUrlKey } from "@shared/news-item-schema";

import { executeArticleBatch } from "./article-atomic-batch";
import { hasArticleEventAliases } from "./article-event-aliases";

export async function initEventApprovals(db: Database) {
    await db
        .prepare(
            `CREATE TABLE IF NOT EXISTS news_event_approvals (
        approval_id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        actor TEXT NOT NULL,
        evidence TEXT NOT NULL,
        members_json TEXT NOT NULL,
        approved_at INTEGER NOT NULL
    )`
        )
        .run();
}

function canonicalMembers(urls: string[]) {
    return [
        ...new Set(
            urls
                .map(safeNewsUrl)
                .filter((url): url is string => Boolean(url))
                .map(normalizeNewsItemUrlKey)
        ),
    ].sort();
}

function provisionalId(urls: string[]) {
    return "candidate-v2-" + createHash("sha256").update(JSON.stringify(urls)).digest("hex");
}

export function provisionalTopicEvent(
    topic: TopicEvent,
    identityStatus: "candidate" | "partial" | "conflict" | "unavailable" = "candidate"
): TopicEvent {
    const urls = canonicalMembers(topic.items.map((item) => item.url));
    return { ...topic, eventId: provisionalId(urls), identityStatus };
}

/** Read-only identity resolution. A display group must have every distinct member
 * registered under one canonical event before it can claim a persistent ID. */
export async function resolveTopicEvent(db: Database, topic: TopicEvent): Promise<TopicEvent> {
    const urls = canonicalMembers(topic.items.map((item) => item.url));
    if (!urls.length) return provisionalTopicEvent(topic);
    const aliases = await hasArticleEventAliases(db);
    const root = aliases ? "COALESCE(alias.canonical_id,a.event_id)" : "a.event_id";
    const join = aliases ? "LEFT JOIN news_event_aliases alias ON alias.alias_id=a.event_id" : "";
    const row = (await db
        .prepare(
            `WITH members AS (SELECT value FROM json_each(?)),
      known AS (SELECT a.canonical_url, ${root} AS event_id FROM articles a ${join} WHERE a.canonical_url IN (SELECT value FROM members))
      SELECT COUNT(*) AS found,COUNT(event_id) AS assigned,COUNT(DISTINCT event_id) AS roots,MIN(event_id) AS event_id FROM known`
        )
        .get(JSON.stringify(urls))) as { found: number; assigned: number; roots: number; event_id: string | null };
    if (Number(row.roots) > 1) return provisionalTopicEvent(topic, "conflict");
    if (!row.event_id) return provisionalTopicEvent(topic);
    if (Number(row.found) !== urls.length || Number(row.assigned) !== urls.length)
        return provisionalTopicEvent(topic, "partial");
    if (!(await db.prepare("SELECT event_id FROM news_events WHERE event_id=?").get(row.event_id)))
        return provisionalTopicEvent(topic, "unavailable");
    return { ...topic, eventId: row.event_id, identityStatus: "registered" };
}

export interface ReviewedEventAssignment {
    urls: string[];
    actor: string;
    evidence: string;
    /** Omit to create a NEW event only when every member is unassigned. */
    eventId?: string;
}

/** Explicit, audited operator action. No public insights or collection path calls it. */
export async function assignReviewedEvent(db: Database, input: ReviewedEventAssignment) {
    const urls = canonicalMembers(input.urls);
    if (!urls.length || input.urls.length > 200 || input.urls.some((url) => !safeNewsUrl(url)))
        throw new Error("Provide 1–200 valid article URLs.");
    const actor = input.actor.trim(),
        evidence = input.evidence.trim();
    if (!actor || actor.length > 128 || !evidence || evidence.length > 2000)
        throw new Error("An actor and reviewed evidence are required.");
    if (input.eventId !== undefined && !/^[a-zA-Z0-9_-]{1,128}$/.test(input.eventId))
        throw new Error("Invalid event ID.");
    const existing = input.eventId !== undefined;
    const eventId = input.eventId ?? "event-v2-" + randomUUID();
    const approvalId = randomUUID(),
        approvedAt = Date.now(),
        members = JSON.stringify(urls);
    // Validate all members and target in the same transaction as the audit row
    // and assignment. Never treat a caller-supplied candidate as a new event ID.
    const statements = await executeArticleBatch(db, [
        {
            sql: `WITH members AS (SELECT value FROM json_each(?)),
          known AS (
            SELECT a.canonical_url,a.event_id,COALESCE(alias.canonical_id,a.event_id) AS root
            FROM articles a LEFT JOIN news_event_aliases alias ON alias.alias_id=a.event_id
            WHERE a.canonical_url IN (SELECT value FROM members)
          )
          INSERT INTO news_event_approvals(approval_id,event_id,actor,evidence,members_json,approved_at)
          SELECT ?,?,?,?,?,?
          WHERE (SELECT COUNT(*) FROM known)=?
          AND ${
              existing
                  ? "EXISTS(SELECT 1 FROM news_events WHERE event_id=?) AND NOT EXISTS(SELECT 1 FROM news_event_aliases WHERE alias_id=?) AND NOT EXISTS(SELECT 1 FROM known WHERE root IS NOT NULL AND root<>?)"
                  : "NOT EXISTS(SELECT 1 FROM known WHERE event_id IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM news_events WHERE event_id=?) AND NOT EXISTS(SELECT 1 FROM news_event_aliases WHERE alias_id=? OR canonical_id=?)"
          }
          `,
            params: [
                members,
                approvalId,
                eventId,
                actor,
                evidence,
                members,
                approvedAt,
                urls.length,
                eventId,
                eventId,
                eventId,
            ],
        },
        {
            sql: "INSERT OR IGNORE INTO news_events(event_id,registered_at) SELECT event_id,approved_at FROM news_event_approvals WHERE approval_id=?",
            params: [approvalId],
        },
        {
            sql: "UPDATE articles SET event_id=? WHERE event_id IS NULL AND canonical_url IN (SELECT value FROM json_each(?)) AND EXISTS(SELECT 1 FROM news_event_approvals WHERE approval_id=?)",
            params: [eventId, members, approvalId],
        },
        {
            sql: "SELECT approval_id,event_id,actor,evidence,approved_at FROM news_event_approvals WHERE approval_id=?",
            params: [approvalId],
            rows: true,
        },
    ]);
    const record = statements[3][0];
    if (!record)
        throw new Error(
            "Event assignment rejected: missing article, existing assignment, unknown target, or conflict."
        );
    return { approvalId, eventId, approvedAt, memberCount: urls.length };
}
