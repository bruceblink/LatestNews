import type { Database } from "db0";

import { hasArticleEventAliases } from "./article-event-aliases";

/** Reuse an existing identity only when all persisted members agree. Never rewrite assigned rows. */
export async function reconcileArticleEventId(db: Database, canonicalUrls: string[], candidateId: string) {
    const urls = JSON.stringify([...new Set(canonicalUrls.filter(Boolean))]);
    if (urls === "[]") return candidateId;

    const aliases = await hasArticleEventAliases(db);
    // Preserve legacy IDs on existing rows. Approved aliases only affect resolution.
    const membership = aliases
        ? "SELECT COALESCE(alias.canonical_id, article.event_id) AS event_id FROM articles article LEFT JOIN news_event_aliases alias ON alias.alias_id = article.event_id WHERE article.canonical_url IN (SELECT value FROM members)"
        : "SELECT event_id FROM articles WHERE canonical_url IN (SELECT value FROM members)";
    // Resolve and assign in a single statement, including across concurrent requests.
    // JSON keeps the bind count fixed even for topics with more than 100 articles.
    await db
        .prepare(
            `WITH members AS (SELECT value FROM json_each(?)),
                  known AS MATERIALIZED (
                      SELECT COUNT(DISTINCT event_id) AS id_count, MIN(event_id) AS event_id
                      FROM (${membership})
                  )
             UPDATE articles
             SET event_id = COALESCE((SELECT event_id FROM known), ?)
             WHERE event_id IS NULL
               AND canonical_url IN (SELECT value FROM members)
               AND (SELECT id_count FROM known) <= 1`
        )
        .run(urls, candidateId);

    const row = (await db
        .prepare(
            `WITH members AS (SELECT value FROM json_each(?))
             SELECT COUNT(DISTINCT event_id) AS id_count, MIN(event_id) AS event_id FROM (${membership})`
        )
        .get(urls)) as { id_count: number; event_id: string | null } | undefined;

    // No indexed member or conflicting persisted IDs: keep the provisional candidate.
    return row && Number(row.id_count) === 1 && row.event_id ? row.event_id : candidateId;
}
