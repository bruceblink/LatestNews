import { join } from "node:path";
import process from "node:process";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { CHINESE_SEARCH_CASES } from "./chinese-search-cases";
import { scoreReviewedRetrieval } from "./quality-review-retrieval";
import { packetDigest, compareReviews, blankSubmission, prepareReviewPacket } from "./quality-review";

import type { NewsEventCorpus } from "./news-event-evaluation";
import type { ReviewPacket, ReviewDataset, ReviewSubmission } from "./quality-review";

const read = async <T>(path: string | URL): Promise<T> => JSON.parse(await readFile(path, "utf8")) as T;
const corpus = await read<NewsEventCorpus>(new URL("../../test/fixtures/news-event-real-corpus.json", import.meta.url));
const hybrid = await read<{ cases: Array<{ query: string }> }>(
    new URL("../../test/fixtures/news-hybrid-search-queries.json", import.meta.url)
);
const cohorts = new Map(corpus.events.map((event) => [event.id, event.cohort]));
const baseline: ReviewDataset = {
    snapshotAt: corpus.snapshotAt,
    reports: corpus.reports.map((report) => ({ ...report, cohort: cohorts.get(report.event)! })),
    queries: [...new Set([...hybrid.cases, ...CHINESE_SEARCH_CASES].map((row) => row.query))].map((query, i) => ({
        id: "query-" + (i + 1),
        query,
    })),
};
const [command, ...args] = process.argv.slice(2);
async function writePacket(packet: ReviewPacket, out: string) {
    await mkdir(out, { recursive: false });
    const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
    await writeFile(join(out, "packet.json"), json(packet), { flag: "wx" });
    for (const reviewer of ["a", "b"])
        await writeFile(join(out, "review-" + reviewer + ".json"), json(blankSubmission(packet)), { flag: "wx" });
    console.log(
        JSON.stringify({
            kind: packet.kind,
            packetSha256: packetDigest(packet),
            reports: packet.reports.length,
            queries: packet.queries.length,
            status: "awaiting-independent-review",
        })
    );
}
if (command === "prepare" && args.length === 1) {
    await writePacket(prepareReviewPacket(baseline, "regression"), args[0]);
} else if (command === "prepare-holdout" && args.length === 2) {
    await writePacket(prepareReviewPacket(await read<ReviewDataset>(args[0]), "holdout", [baseline]), args[1]);
} else if (command === "score" && args.length === 3) {
    const raw = await read<ReviewPacket>(args[0]);
    const packet = prepareReviewPacket(raw, raw.kind, [baseline]);
    if (raw.schemaVersion !== 1 || JSON.stringify(raw) !== JSON.stringify(packet))
        throw new Error("Review packet changed or contains extra fields.");
    const comparison = compareReviews(
        packet,
        await read<ReviewSubmission>(args[1]),
        await read<ReviewSubmission>(args[2])
    );
    console.log(
        JSON.stringify(
            { ...comparison, retrieval: await scoreReviewedRetrieval(packet, comparison.agreedQueries) },
            null,
            2
        )
    );
} else {
    throw new Error(
        "Usage: pnpm performance:quality-review prepare <new-output-directory> | prepare-holdout <unlabeled-dataset.json> <new-output-directory> | score <packet.json> <review-a.json> <review-b.json>"
    );
}
