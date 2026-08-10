import { vi, it, expect, describe } from "vitest";

import { genSources } from "../shared/pre-sources";
import { FREEBUF_RSS_URL } from "../server/sources/freebuf";
import { XIANZHISHE_RSS_URL } from "../server/sources/xianzhishe";
import { SPUTNIK_TIMELINE_URL, fetchSputnikNewsItems } from "../server/sources/sputniknewscn";
import { BILIBILI_HOT_SEARCH_URL, fetchBilibiliHotSearchItems } from "../server/sources/bilibili";
import { fetchZhihuHotItems, ZHIHU_PRIMARY_HOT_URL, ZHIHU_FALLBACK_HOT_URL } from "../server/sources/zhihu";

import type { myFetch } from "../server/utils/fetch";

type SourceFetcher = typeof myFetch;

describe("source adapter regressions", () => {
    it("uses stable feed endpoints for security news sources", () => {
        expect(FREEBUF_RSS_URL).toBe("https://www.freebuf.com/rss");
        expect(XIANZHISHE_RSS_URL).toBe("https://xz.aliyun.com/feed/");
    });

    it("uses Bilibili's JSON trending API instead of the endpoint returning 412", async () => {
        const fetcher = vi.fn().mockResolvedValue({
            code: 0,
            message: "OK",
            data: {
                list: [
                    {
                        keyword: "serverless crawler",
                        show_name: "Serverless crawler",
                        icon: "https://example.com/icon.png",
                    },
                ],
            },
        }) as unknown as SourceFetcher;

        const items = await fetchBilibiliHotSearchItems(fetcher);

        expect(fetcher).toHaveBeenCalledWith(BILIBILI_HOT_SEARCH_URL, expect.any(Object));
        expect(BILIBILI_HOT_SEARCH_URL).toContain("app.bilibili.com/x/v2/search/trending/ranking");
        expect(items[0]).toMatchObject({
            title: "Serverless crawler",
            url: "https://search.bilibili.com/all?keyword=serverless%20crawler",
        });
    });

    it("falls back to Zhihu's public API host and preserves the exact question id", async () => {
        const fetcher = vi
            .fn()
            .mockRejectedValueOnce(new Error("primary returned 403"))
            .mockResolvedValueOnce({
                data: [
                    {
                        detail_text: "100 万热度",
                        target: {
                            title: "Fallback question",
                            url: "https://api.zhihu.com/questions/2070076932834550346",
                            excerpt: "Fallback excerpt",
                        },
                    },
                ],
            }) as unknown as SourceFetcher;

        const items = await fetchZhihuHotItems(fetcher);

        expect(fetcher).toHaveBeenNthCalledWith(1, ZHIHU_PRIMARY_HOT_URL, expect.any(Object));
        expect(fetcher).toHaveBeenNthCalledWith(2, ZHIHU_FALLBACK_HOT_URL, expect.any(Object));
        expect(items[0]).toMatchObject({
            title: "Fallback question",
            url: "https://www.zhihu.com/question/2070076932834550346",
            extra: {
                info: "100 万热度",
                hover: "Fallback excerpt",
            },
        });
    });

    it("fetches Sputnik directly instead of recursively calling LatestNews", async () => {
        const fetcher = vi.fn().mockResolvedValue(`
            <div class="lenta__item">
                <a href="/20260810/example.html">
                    <span class="lenta__item-text">Example headline</span>
                    <time class="lenta__item-date" data-unixtime="1786368000"></time>
                </a>
            </div>
        `) as unknown as SourceFetcher;

        const items = await fetchSputnikNewsItems(fetcher);

        expect(fetcher).toHaveBeenCalledWith(SPUTNIK_TIMELINE_URL);
        expect(items[0]).toMatchObject({
            title: "Example headline",
            url: "https://sputniknews.cn/20260810/example.html",
            extra: { date: 1_786_368_000_000 },
        });
    });

    it("removes the unavailable MKTNews upstream from generated sources", () => {
        const sources = genSources();

        expect(sources).not.toHaveProperty("mktnews");
        expect(sources).not.toHaveProperty("mktnews-flash");
        expect(sources.freebuf).not.toHaveProperty("desc");
    });
});
