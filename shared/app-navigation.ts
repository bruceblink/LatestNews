import type { FixedColumnID } from "./types";
import type { UnifiedFeedScope } from "./unified-feed";

/** Shared route labels and line-icon names used by the application shell. */
export const appNavigation = {
    home: { label: "首页", icon: "i-ph:squares-four", path: "/insights" },
    feed: { label: "统一 Feed", icon: "i-ph:newspaper", path: "/feed" },
    history: { label: "阅读历史", icon: "i-ph:clock-counter-clockwise", path: "/history" },
    archive: { label: "新闻档案", icon: "i-ph:archive", path: "/archive" },
    health: { label: "数据源健康", icon: "i-ph:pulse", path: "/health" },
    settings: { label: "设置", icon: "i-ph:gear-six", path: "/settings" },
} as const;

export type AppNavigationKey = keyof typeof appNavigation;

export const workspaceNavigation: Array<{
    key: "home" | "feed" | "history" | "health" | "archive";
    label: string;
    icon: string;
    path: string;
}> = [
    { key: "home", ...appNavigation.home },
    { key: "feed", ...appNavigation.feed },
    { key: "history", ...appNavigation.history },
    { key: "health", ...appNavigation.health },
    { key: "archive", ...appNavigation.archive },
];

export const columnNavigation: Array<{
    id: FixedColumnID;
    label: string;
    icon: string;
}> = [
    { id: "focus", label: "我的关注", icon: "i-ph:star" },
    { id: "hottest", label: "热门", icon: "i-ph:fire" },
    { id: "realtime", label: "实时", icon: "i-ph:clock" },
];

/** The Feed route opens in the existing hottest scope; filters remain editable there. */
export const feedNavigationSearch: { q: undefined; scope: UnifiedFeedScope } = {
    q: undefined,
    scope: "hottest",
};

/** Resolve route context for the app header and the section that owns the active route. */
export function getAppNavigationContext(pathname: string) {
    if (pathname === "/" || pathname === "/insights") return appNavigation.home;
    if (pathname === "/feed" || pathname.startsWith("/c/")) {
        const column = pathname.match(/^\/c\/(focus|hottest|realtime)(?:\/|$)/)?.[1] as FixedColumnID | undefined;
        return column
            ? {
                  ...appNavigation.feed,
                  label: columnNavigation.find((item) => item.id === column)?.label ?? "统一 Feed",
              }
            : appNavigation.feed;
    }
    if (pathname === "/history") return appNavigation.history;
    if (pathname === "/archive") return appNavigation.archive;
    if (pathname === "/health" || pathname.startsWith("/source/")) {
        return pathname.startsWith("/source/") ? { ...appNavigation.health, label: "来源详情" } : appNavigation.health;
    }
    if (pathname === "/settings") return appNavigation.settings;
    return { label: "LatestNews", icon: "", path: "/" };
}

/** Detail routes stay associated with their owning workspace navigation item. */
export function isAppNavigationActive(key: AppNavigationKey, pathname: string) {
    if (key === "home") return pathname === "/" || pathname === "/insights";
    if (key === "feed") return pathname === "/feed" || pathname.startsWith("/c/");
    if (key === "health") return pathname === "/health" || pathname.startsWith("/source/");
    if (key === "settings") return pathname === "/settings";
    if (key === "archive") return pathname === "/archive";
    return pathname === "/history";
}
