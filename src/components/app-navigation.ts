import type { UnifiedFeedScope } from "@shared/unified-feed";

/** 统一应用导航的可见文案和图标，侧栏与洞察工作区共用同一份定义。 */
export const appNavigation = {
    home: { label: "首页", icon: "i-ph:house-duotone", path: "/insights" },
    feed: { label: "统一 Feed", icon: "i-ph:fire-duotone", path: "/feed" },
    history: { label: "阅读历史", icon: "i-ph:article-duotone", path: "/history" },
    health: { label: "数据源健康", icon: "i-ph:stack-duotone", path: "/health" },
    settings: { label: "设置", icon: "i-ph:gear-six-duotone", path: "/settings" },
} as const;

export type AppNavigationKey = keyof typeof appNavigation;

/** 热点入口固定进入热门范围，其余筛选由页面内控件继续调整。 */
export const feedNavigationSearch: { q: undefined; scope: UnifiedFeedScope } = {
    q: undefined,
    scope: "hottest",
};

/** 根据当前路径计算导航激活项，详情页归入对应的列表流程。 */
export function isAppNavigationActive(key: AppNavigationKey, pathname: string) {
    if (key === "home") return pathname === "/" || pathname === "/insights";
    if (key === "feed") return pathname === "/feed" || pathname.startsWith("/c/");
    if (key === "health") return pathname === "/health" || pathname.startsWith("/source/");
    if (key === "settings") return pathname === "/settings";
    return pathname === "/history";
}
