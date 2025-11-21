import process from "node:process";

import { Interval } from "./consts";
import { typeSafeObjectFromEntries } from "./type.util";

import type { Source, OriginSource } from "./types";

const Time = {
    Test: 1,
    Realtime: 2 * 60 * 1000,
    Fast: 5 * 60 * 1000,
    Default: Interval, // 10min
    Common: 30 * 60 * 1000,
    Slow: 60 * 60 * 1000,
};

export const originSources = {
    v2ex: {
        name: "V2EX",
        color: "slate",
        home: "https://v2ex.com/",
        sub: {
            share: {
                title: "最新分享",
                column: "tech",
            },
        },
    },
    zhihu: {
        name: "知乎",
        type: "hottest",
        column: "china",
        color: "blue",
        home: "https://www.zhihu.com",
    },
    weibo: {
        name: "微博",
        title: "实时热搜",
        type: "hottest",
        column: "china",
        color: "red",
        interval: Time.Realtime,
        home: "https://weibo.com",
    },
    zaobao: {
        name: "联合早报",
        interval: Time.Common,
        type: "realtime",
        column: "world",
        color: "red",
        desc: "来自第三方网站: 早晨报",
        home: "https://www.zaobao.com",
    },
    coolapk: {
        name: "酷安",
        type: "hottest",
        column: "tech",
        color: "green",
        title: "今日最热",
        home: "https://coolapk.com",
    },
    mktnews: {
        name: "MKTNews",
        column: "finance",
        home: "https://mktnews.net",
        color: "indigo",
        interval: Time.Realtime,
        sub: {
            flash: {
                title: "快讯",
            },
        },
    },
    wallstreetcn: {
        name: "华尔街见闻",
        color: "blue",
        column: "finance",
        home: "https://wallstreetcn.com/",
        sub: {
            quick: {
                type: "realtime",
                interval: Time.Fast,
                title: "快讯",
            },
            news: {
                title: "最新",
                interval: Time.Common,
            },
            hot: {
                title: "热门",
                type: "hottest",
                interval: Time.Common,
            },
        },
    },
    "36kr": {
        name: "36氪",
        type: "realtime",
        color: "blue",
        // cloudflare pages cannot access
        disable: "cf",
        home: "https://36kr.com",
        column: "tech",
        sub: {
            quick: {
                title: "快讯",
            },
        },
    },
    douyin: {
        name: "抖音",
        type: "hottest",
        column: "china",
        color: "gray",
        home: "https://www.douyin.com",
    },
    hupu: {
        name: "虎扑",
        home: "https://hupu.com",
        column: "china",
        title: "主干道热帖",
        type: "hottest",
        color: "red",
    },
    tieba: {
        name: "百度贴吧",
        title: "热议",
        column: "china",
        type: "hottest",
        color: "blue",
        home: "https://tieba.baidu.com",
    },
    toutiao: {
        name: "今日头条",
        type: "hottest",
        column: "china",
        color: "red",
        home: "https://www.toutiao.com",
    },
    ithome: {
        name: "IT之家",
        color: "red",
        column: "tech",
        type: "realtime",
        home: "https://www.ithome.com",
    },
    douban: {
        name: "豆瓣",
        column: "china",
        title: "热门电影",
        color: "green",
        type: "hottest",
        home: "https://www.douban.com/",
    },
    thepaper: {
        name: "澎湃新闻",
        interval: Time.Common,
        type: "hottest",
        column: "china",
        title: "热榜",
        color: "gray",
        home: "https://www.thepaper.cn",
    },
    sputniknewscn: {
        name: "卫星通讯社",
        color: "orange",
        column: "world",
        home: "https://sputniknews.cn",
    },
    cankaoxiaoxi: {
        name: "参考消息",
        color: "red",
        column: "world",
        interval: Time.Common,
        home: "https://china.cankaoxiaoxi.com",
    },
    pcbeta: {
        name: "远景论坛",
        color: "blue",
        column: "tech",
        home: "https://bbs.pcbeta.com",
        sub: {
            windows11: {
                title: "Win11",
                type: "realtime",
                interval: Time.Fast,
            },
            windows: {
                title: "Windows 资源",
                type: "realtime",
                interval: Time.Fast,
                disable: true,
            },
        },
    },
    cls: {
        name: "财联社",
        color: "red",
        column: "finance",
        home: "https://www.cls.cn",
        sub: {
            telegraph: {
                title: "电报",
                interval: Time.Fast,
                type: "realtime",
            },
            depth: {
                title: "深度",
            },
            hot: {
                title: "热门",
                type: "hottest",
            },
        },
    },
    xueqiu: {
        name: "雪球",
        color: "blue",
        home: "https://xueqiu.com",
        column: "finance",
        sub: {
            hotstock: {
                title: "热门股票",
                interval: Time.Realtime,
                type: "hottest",
            },
        },
    },
    gelonghui: {
        name: "格隆汇",
        color: "blue",
        title: "事件",
        column: "finance",
        type: "realtime",
        interval: Time.Realtime,
        home: "https://www.gelonghui.com",
    },
    fastbull: {
        name: "法布财经",
        color: "emerald",
        home: "https://www.fastbull.cn",
        column: "finance",
        sub: {
            express: {
                title: "快讯",
                type: "realtime",
                interval: Time.Realtime,
            },
            news: {
                title: "头条",
                interval: Time.Common,
            },
        },
    },
    solidot: {
        name: "Solidot",
        color: "teal",
        column: "tech",
        home: "https://solidot.org",
        interval: Time.Slow,
    },
    hackernews: {
        name: "Hacker News",
        color: "orange",
        column: "tech",
        type: "hottest",
        home: "https://news.ycombinator.com/",
    },
    producthunt: {
        name: "Product Hunt",
        color: "red",
        column: "tech",
        type: "hottest",
        home: "https://www.producthunt.com/",
    },
    github: {
        name: "Github",
        color: "gray",
        home: "https://github.com/",
        column: "tech",
        sub: {
            "trending-today": {
                title: "Today",
                type: "hottest",
            },
        },
    },
    bilibili: {
        name: "哔哩哔哩",
        color: "blue",
        home: "https://www.bilibili.com",
        sub: {
            "hot-search": {
                title: "热搜",
                column: "china",
                type: "hottest",
            },
            "hot-video": {
                title: "热门视频",
                disable: "cf",
                column: "china",
                type: "hottest",
            },
            ranking: {
                title: "排行榜",
                column: "china",
                disable: "cf",
                type: "hottest",
                interval: Time.Common,
            },
        },
    },
    kuaishou: {
        name: "快手",
        type: "hottest",
        column: "china",
        color: "orange",
        // cloudflare pages cannot access
        disable: "cf",
        home: "https://www.kuaishou.com",
    },
    kaopu: {
        name: "靠谱新闻",
        column: "world",
        color: "gray",
        interval: Time.Common,
        desc: "不一定靠谱，多看多思考",
        home: "https://kaopu.news/",
    },
    jin10: {
        name: "金十数据",
        column: "finance",
        color: "blue",
        type: "realtime",
        home: "https://www.jin10.com",
    },
    baidu: {
        name: "百度热搜",
        column: "china",
        color: "blue",
        type: "hottest",
        home: "https://www.baidu.com",
    },
    linuxdo: {
        name: "LINUX DO",
        column: "tech",
        color: "slate",
        home: "https://linux.do/",
        disable: true,
        sub: {
            latest: {
                title: "最新",
                home: "https://linux.do/latest",
            },
            hot: {
                title: "今日最热",
                type: "hottest",
                interval: Time.Common,
                home: "https://linux.do/hot",
            },
        },
    },
    ghxi: {
        name: "果核剥壳",
        column: "china",
        color: "yellow",
        home: "https://www.ghxi.com/",
        disable: true,
    },
    smzdm: {
        name: "什么值得买",
        column: "china",
        color: "red",
        type: "hottest",
        home: "https://www.smzdm.com",
        disable: true,
    },
    nowcoder: {
        name: "牛客",
        column: "china",
        color: "blue",
        type: "hottest",
        home: "https://www.nowcoder.com",
    },
    sspai: {
        name: "少数派",
        column: "tech",
        color: "red",
        type: "hottest",
        home: "https://sspai.com",
    },
    juejin: {
        name: "稀土掘金",
        column: "tech",
        color: "blue",
        type: "hottest",
        home: "https://juejin.cn",
    },
    ifeng: {
        name: "凤凰网",
        column: "china",
        color: "red",
        type: "hottest",
        title: "热点资讯",
        home: "https://www.ifeng.com",
    },
    chongbuluo: {
        name: "虫部落",
        column: "china",
        color: "green",
        home: "https://www.chongbuluo.com",
        sub: {
            latest: {
                title: "最新",
                interval: Time.Common,
                home: "https://www.chongbuluo.com/forum.php?mod=guide&view=newthread",
            },
            hot: {
                title: "热门",
                type: "hottest",
                interval: Time.Common,
                home: "https://www.chongbuluo.com/forum.php?mod=guide&view=hot",
            },
        },
    },
    steam: {
        name: "Steam",
        column: "world",
        title: "热门游戏",
        color: "blue",
        type: "hottest",
        home: "https://store.steampowered.com",
    },
    tencent: {
        name: "腾讯新闻",
        column: "china",
        color: "blue",
        home: "https://news.qq.com",
        sub: {
            hot: {
                title: "综合早报",
                type: "hottest",
                interval: Time.Common,
                home: "https://news.qq.com/tag/aEWqxLtdgmQ=",
            },
        },
    },
    freebuf: {
        name: "Freebuf",
        column: "china",
        title: "网络安全",
        color: "green",
        type: "hottest",
        home: "https://www.freebuf.com/",
    },
} as const satisfies Record<string, OriginSource>;

export function genSources() {
    // 创建基础配置的辅助函数
    function createBaseConfig(source: OriginSource): Source {
        return {
            name: source.name,
            interval: source.interval ?? Time.Default,
            color: source.color ?? "primary",
            ...(source.type && { type: source.type }),
            ...(source.desc && { desc: source.desc }),
            ...(source.column && { column: source.column }),
            ...(source.home && { home: source.home }),
            ...(source.disable && { disable: source.disable }),
            ...(source.title && { title: source.title }),
        } as Source;
    }

    // 处理子源的辅助函数
    function processSubSources(
        id: string,
        baseConfig: Source,
        subSources: NonNullable<OriginSource["sub"]>
    ): Array<[string, Source]> {
        const entries: Array<[string, Source]> = [];

        Object.entries(subSources).forEach(([subId, subSource], index) => {
            // 第一个子源作为父级重定向目标
            if (index === 0) {
                entries.push([
                    id,
                    {
                        ...baseConfig,
                        ...subSource,
                        redirect: `${id}-${subId}`,
                    } as Source,
                ]);
            }

            // 添加子源配置
            entries.push([
                `${id}-${subId}`,
                {
                    ...baseConfig,
                    ...subSource,
                } as Source,
            ]);
        });

        return entries;
    }

    // 检查源是否已禁用
    function isSourceEnabled(source: Source): boolean {
        if (source.disable === "cf" && process.env.CF_PAGES) {
            return false;
        }
        return source.disable !== true;
    }

    // 主处理逻辑
    const sources: Array<[string, Source]> = Object.entries(originSources).flatMap(([id, source]) => {
        const baseConfig = createBaseConfig(source);

        // 处理有子源的情况
        if ("sub" in source && source.sub) {
            return processSubSources(id, baseConfig, source.sub);
        }

        // 处理无子源的情况
        return [[id, baseConfig]];
    });

    // 过滤并返回最终结果
    return typeSafeObjectFromEntries(sources.filter(([, source]) => isSourceEnabled(source))) as Record<string, Source>;
}
