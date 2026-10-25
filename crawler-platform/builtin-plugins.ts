/** First-party packages included in the desktop app and enabled for new profiles. */
export const builtinCrawlerPlugins = [
    { id: "org.latestnews.pcbeta", sourceDirectory: "pcbeta" },
    { id: "org.latestnews.freebuf", sourceDirectory: "freebuf" },
    { id: "org.latestnews.juejin", sourceDirectory: "juejin" },
    { id: "org.latestnews.hackernews", sourceDirectory: "hackernews" },
] as const;
