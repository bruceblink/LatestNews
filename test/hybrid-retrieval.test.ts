import { it, expect, describe } from "vitest";

import { measureRanking, reciprocalRankFusion, CharacterTitleRetriever } from "../scripts/performance/hybrid-retrieval";

describe("offline hybrid retrieval", () => {
    it("fuses ranks and counts a repeated document only once per channel", () => {
        const result = reciprocalRankFusion(
            [
                ["a", "a", "b"],
                ["b", "c"],
            ],
            3
        );
        expect(result.map((row) => row.id)).toEqual(["b", "a", "c"]);
        expect(result[0].score).toBeCloseTo(1 / 62 + 1 / 61);
        expect(result[1].score).toBeCloseTo(1 / 61);
    });

    it("handles empty channels, deterministic ties, limits and invalid configurations", () => {
        expect(reciprocalRankFusion([[], []], 2)).toEqual([]);
        expect(reciprocalRankFusion([["b"], ["a"]], 1).map((row) => row.id)).toEqual(["a"]);
        expect(() => reciprocalRankFusion([["a"]], 0)).toThrow();
        expect(() => reciprocalRankFusion([["a"]], 1, 0)).toThrow();
    });

    it("finds mixed-script substrings and approximate terms without ranking unrelated titles", () => {
        const retriever = new CharacterTitleRetriever([
            { id: "a", title: "Firefox 161 发布" },
            { id: "b", title: "腾讯混元 GGUF 量化权重" },
            { id: "c", title: "海洋气象报告" },
        ]);
        expect(retriever.search("Firefx 161", 3).map((row) => row.id)).toEqual(["a"]);
        expect(retriever.search("混元 GGUF", 3).map((row) => row.id)).toEqual(["b"]);
        expect(retriever.search("Elixir", 3)).toEqual([]);
        expect(retriever.search("!!!", 3)).toEqual([]);
        expect(
            () =>
                new CharacterTitleRetriever([
                    { id: "a", title: "x" },
                    { id: "a", title: "y" },
                ])
        ).toThrow();
    });

    it("does not count duplicate hits and distinguishes no-answer queries", () => {
        const score = measureRanking(["x", "x", "a", "b"], ["a", "c"], 3);
        expect(score).toMatchObject({ hits: 1, returned: 3, relevant: 2, recall: 0.5, mrr: 0.5 });
        expect(score.ndcg).toBeCloseTo(1 / Math.log2(3) / (1 + 1 / Math.log2(3)));
        expect(measureRanking(["x"], [], 5)).toMatchObject({ recall: null, ndcg: null, falsePositiveNoAnswer: true });
        expect(measureRanking([], [], 5)).toMatchObject({ precision: null, falsePositiveNoAnswer: false });
    });
});
