import { z } from "zod";
import { safeNewsUrl } from "@shared/news-url-policy";
import { describeSourceError } from "@shared/source-error";

const str = z.string();
const num = z.number();
const strings = z.array(str);
const date = z.union([num, str]);
const url = str.refine((value) => safeNewsUrl(value) !== undefined);
const optionalNumber = num.optional();
const optionalString = str.optional();
const item = z.object({
    id: z.union([str, num]),
    title: str,
    url,
    mobileUrl: url.optional(),
    pubDate: date.optional(),
    extra: z
        .object({
            hover: optionalString,
            date: date.optional(),
            info: z.union([z.literal(false), str]).optional(),
            diff: optionalNumber,
            icon: z.union([z.literal(false), str, z.object({ url: str, scale: num })]).optional(),
        })
        .optional(),
});
const status = z.enum(["success", "cache", "degraded-cache", "stale-cache", "empty"]);
const source = z.object({ id: str, name: optionalString, updatedTime: date, status, items: z.array(item) });
const freshSource = source.refine((s) => ["success", "cache"].includes(s.status) && s.items.length > 0);
const meta = z
    .object({
        generatedAt: num,
        requestedSourceCount: num,
        resolvedSourceCount: num,
        partial: z.boolean(),
        omittedSourceIds: strings,
    })
    .refine(
        (m) =>
            m.resolvedSourceCount > 0 &&
            m.requestedSourceCount >= m.resolvedSourceCount &&
            (m.partial || (m.requestedSourceCount === m.resolvedSourceCount && m.omittedSourceIds.length === 0))
    );
const bucket = z.object({ startAt: num, endAt: num, itemCount: num, sourceCount: num });
const sourceFields = { sources: strings, sourceNames: strings, itemCount: num, keywords: strings };
const articleFields = {
    id: str,
    title: str,
    url,
    sourceId: str,
    sourceName: optionalString,
    publishedAt: optionalNumber,
};
const insights = z.object({
    data: z.object({
        generatedAt: num,
        sourceCount: num,
        // A resolved source can legitimately contain no visible articles.
        // Total failure is rejected independently by the envelope metadata.
        itemCount: num.int().nonnegative(),
        hotRankings: z.array(
            z.object({
                ...articleFields,
                ...sourceFields,
                rank: num,
                score: num,
                mobileUrl: url.optional(),
                signals: z.object({
                    sourceCoverage: num,
                    duplicateCount: num,
                    recencyScore: num,
                    sourceWeight: num,
                    categoryWeight: num,
                    readPenalty: num,
                    rankingReason: str,
                    categoryDistribution: z.array(
                        z.object({ categoryId: str, categoryName: str, itemCount: num, sourceCount: num })
                    ),
                }),
            })
        ),
        topicEvents: z.array(
            z.object({
                id: str,
                eventId: str,
                title: str,
                ...sourceFields,
                canonicalUrl: url.optional(),
                identityStatus: optionalString,
                firstPublishedAt: optionalNumber,
                latestPublishedAt: optionalNumber,
                items: z.array(z.object(articleFields)),
            })
        ),
        wordCloud: z.array(
            z.object({ term: str, count: num, weight: num, sources: strings, latestPublishedAt: optionalNumber })
        ),
        sourceActivity: z.array(
            z.object({ sourceId: str, sourceName: optionalString, itemCount: num, latestPublishedAt: optionalNumber })
        ),
        categoryShares: z.array(
            z.object({
                categoryId: str,
                categoryName: str,
                itemCount: num,
                sourceCount: num,
                ratio: num,
                latestPublishedAt: optionalNumber,
            })
        ),
        updateFrequency: z.array(bucket),
        keywordTrends: z.array(
            z.object({
                term: str,
                totalCount: num,
                sourceCount: num,
                latestPublishedAt: optionalNumber,
                buckets: z.array(bucket),
            })
        ),
    }),
    meta,
    errors: z.array(
        z.object({ sourceId: optionalString, message: str, code: optionalString }).transform((error) => ({
            ...(error.sourceId ? { sourceId: error.sourceId } : {}),
            ...describeSourceError(error),
        }))
    ),
});
const batch = z
    .object({
        data: z.array(source).min(1),
        meta: z.object({
            generatedAt: num,
            requestedSourceCount: num,
            resolvedSourceCount: num,
            partial: z.literal(false),
            omittedSourceIds: strings,
            itemCount: num,
            unfilteredItemCount: num,
            filters: z.object({
                sourceIds: strings,
                columns: strings,
                types: strings,
                since: optionalNumber,
                limit: optionalNumber,
            }),
        }),
        errors: z.array(z.unknown()).length(0),
    })
    .refine(
        (r) =>
            r.data.some((s) => s.items.length > 0) &&
            r.data.every((s) => ["success", "cache", "empty"].includes(s.status)) &&
            r.meta.requestedSourceCount === r.meta.resolvedSourceCount &&
            r.meta.omittedSourceIds.length === 0
    );
const sourceItems = z.object({
    data: freshSource,
    meta: z.object({
        generatedAt: num,
        sourceId: str,
        status,
        itemCount: num,
        unfilteredItemCount: num,
        since: optionalNumber,
        limit: optionalNumber,
    }),
    errors: z.array(z.unknown()).length(0),
});
const metadataItem = z.object({
    id: str,
    name: str,
    interval: num,
    color: str,
    type: z.enum(["normal", "hottest", "realtime"]),
    disabled: z.boolean(),
    column: optionalString,
    columnName: optionalString,
    title: optionalString,
    description: optionalString,
    home: optionalString,
    redirectTo: optionalString,
    disableReason: optionalString,
});
const metadata = z.object({
    data: z.object({
        sources: z.array(metadataItem),
        columns: z.array(z.object({ id: str, name: str, sourceIds: strings })),
    }),
    meta: z.object({ generatedAt: num, sourceCount: num, redirectCount: num, disabledCount: num, columnCount: num }),
});
const metadataDetail = z.object({
    data: metadataItem,
    meta: z.object({ generatedAt: num, sourceId: str, canonicalSourceId: str, redirected: z.boolean() }),
    errors: z.array(z.unknown()).length(0),
});

const validators = {
    insights,
    source: freshSource,
    "source-items": sourceItems,
    feed: batch,
    metadata,
    "metadata-item": metadataDetail,
};
export type NewsReloadKind = keyof typeof validators;
export function projectNewsReloadData(kind: NewsReloadKind, data: unknown) {
    const result = validators[kind].safeParse(data);
    return result.success ? result.data : undefined;
}
export function validNewsReloadData(kind: NewsReloadKind, data: unknown) {
    return projectNewsReloadData(kind, data) !== undefined;
}
