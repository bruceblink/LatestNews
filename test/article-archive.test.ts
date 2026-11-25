import { it, expect, describe } from "vitest";
import { validArchiveKey, archiveErrorLabel, normalizeArchiveSearch } from "@shared/article-archive";

describe("archive input and error semantics", () => {
    it("normalizes bookmarkable search and rejects invalid dates", () => {
        expect(normalizeArchiveSearch({ q: "  中文  ", source: "hackernews", since: "2026-11-01" })).toEqual({
            q: "中文",
            source: "hackernews",
            since: "2026-11-01",
        });
        expect(normalizeArchiveSearch({ q: "x", since: "2026-02-30" })).toEqual({ q: "x" });
        expect(normalizeArchiveSearch({ q: "x".repeat(300) }).q).toHaveLength(256);
    });
    it("allows registered event navigation but not candidate keys or path traversal", () => {
        expect(normalizeArchiveSearch({ event: "event-v2-abc", q: "x" })).toEqual({ event: "event-v2-abc" });
        expect(normalizeArchiveSearch({ event: "candidate-v2-abc" })).toEqual({});
        expect(validArchiveKey("../etc")).toBe(false);
    });
    it("distinguishes authorization, rate-limit and unavailable states", () => {
        expect(archiveErrorLabel({ status: 403 }, false)).toContain("拒绝访问");
        expect(archiveErrorLabel({ status: 429 }, false)).toContain("频繁");
        expect(archiveErrorLabel({ status: 503 }, true)).toContain("暂不可用");
        expect(archiveErrorLabel({ status: 404 }, true)).toContain("事件不存在");
        expect(archiveErrorLabel({ code: "ARCHIVE_REMOTE_REQUIRED" }, false)).toContain("本地采集模式");
    });
});
