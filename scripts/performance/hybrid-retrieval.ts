/**
 * Offline retrieval experiment. No external model, service, or production API dependency.
 */
export interface RetrievalDocument {
    id: string;
    title: string;
}

export interface RankedCandidate {
    id: string;
    score: number;
}

function compareId(left: string, right: string) {
    return left < right ? -1 : left > right ? 1 : 0;
}

/** RRF uses ranks, not incompatible raw scores. Duplicate IDs vote once per channel. */
export function reciprocalRankFusion(
    channels: readonly (readonly string[])[],
    limit: number,
    k = 60
): RankedCandidate[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isFinite(k) || k <= 0)
        throw new Error("Invalid RRF configuration.");
    const scores = new Map<string, number>();
    for (const channel of channels) {
        const unique = [...new Set(channel)];
        for (let i = 0; i < unique.length; i++) {
            const id = unique[i];
            scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
        }
    }
    return [...scores]
        .map(([id, score]) => ({ id, score }))
        .sort((a, b) => b.score - a.score || compareId(a.id, b.id))
        .slice(0, limit);
}

/** Fixed lexical approximation: Han bigrams, Latin/numeric trigrams; no semantic claims. */
function grams(text: string, query: boolean): Set<string> {
    const result = new Set<string>();
    const words =
        text
            .normalize("NFKC")
            .toLowerCase()
            .match(/[\p{Script=Han}]+|[a-z0-9]+(?:[.-][a-z0-9]+)*/gu) ?? [];
    for (const word of words) {
        const chars = [...word];
        const max = /\p{Script=Han}/u.test(word) ? 2 : 3;
        const sizes = query
            ? [Math.min(max, chars.length)]
            : Array.from({ length: Math.min(max, chars.length) }, (_, i) => i + 1);
        for (const size of sizes) {
            for (let offset = 0; offset + size <= chars.length; offset++) {
                result.add(size + ":" + chars.slice(offset, offset + size).join(""));
            }
        }
    }
    return result;
}

export class CharacterTitleRetriever {
    private readonly docs: Array<{ id: string; grams: Set<string> }>;
    private readonly documentFrequency = new Map<string, number>();

    constructor(documents: readonly RetrievalDocument[]) {
        if (new Set(documents.map((document) => document.id)).size !== documents.length)
            throw new Error("Duplicate document ID.");
        this.docs = documents.map((document) => ({ id: document.id, grams: grams(document.title, false) }));
        for (const doc of this.docs) {
            for (const gram of doc.grams) this.documentFrequency.set(gram, (this.documentFrequency.get(gram) ?? 0) + 1);
        }
    }

    search(query: string, limit: number, minCoverage = 0.5): RankedCandidate[] {
        if (
            !Number.isSafeInteger(limit) ||
            limit < 1 ||
            !Number.isFinite(minCoverage) ||
            minCoverage <= 0 ||
            minCoverage > 1
        )
            throw new Error("Invalid character retrieval configuration.");
        const queryGrams = [...grams(query, true)];
        if (queryGrams.length === 0) return [];
        const weights = queryGrams.map((gram) => ({
            gram,
            weight: Math.log((this.docs.length + 1) / ((this.documentFrequency.get(gram) ?? 0) + 1)) + 1,
        }));
        const totalWeight = weights.reduce((sum, item) => sum + item.weight, 0);
        return this.docs
            .flatMap((doc) => {
                const coverage =
                    weights.reduce((sum, item) => sum + (doc.grams.has(item.gram) ? item.weight : 0), 0) / totalWeight;
                return coverage >= minCoverage ? [{ id: doc.id, score: coverage }] : [];
            })
            .sort((a, b) => b.score - a.score || compareId(a.id, b.id))
            .slice(0, limit);
    }
}

export function measureRanking(retrieved: readonly string[], relevantIds: readonly string[], limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Invalid evaluation depth.");
    const relevant = new Set(relevantIds);
    const ranking = [...new Set(retrieved)].slice(0, limit);
    let hits = 0;
    let reciprocalRank = 0;
    let dcg = 0;
    for (let i = 0; i < ranking.length; i++) {
        if (!relevant.has(ranking[i])) continue;
        hits++;
        if (reciprocalRank === 0) reciprocalRank = 1 / (i + 1);
        dcg += 1 / Math.log2(i + 2);
    }
    const ideal = Array.from({ length: Math.min(limit, relevant.size) }, (_, i) => 1 / Math.log2(i + 2)).reduce(
        (sum, n) => sum + n,
        0
    );
    return {
        hits,
        returned: ranking.length,
        relevant: relevant.size,
        recall: relevant.size === 0 ? null : hits / relevant.size,
        precision: ranking.length === 0 ? null : hits / ranking.length,
        mrr: relevant.size === 0 ? null : reciprocalRank,
        ndcg: ideal === 0 ? null : dcg / ideal,
        falsePositiveNoAnswer: relevant.size === 0 && ranking.length > 0,
    };
}
