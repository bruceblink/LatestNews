import type { RSSHubOption, SourceGetter, SourceOption, RSSHubInfo as RSSHubResponse } from "#/types";

import defu from "defu";
import process from "node:process";

import { myFetch } from "./fetch";
import { rss2json } from "./rss2json";

export function defineSource(source: SourceGetter): SourceGetter {
    return source;
}

export function defineRSSSource(url: string, option?: SourceOption): SourceGetter {
    return async () => {
        const data = await rss2json(url);
        if (!data?.items.length) throw new Error("Cannot fetch rss data");
        return data.items.map((item) => ({
            title: item.title,
            url: item.link,
            id: item.link,
            pubDate: !option?.hiddenDate ? item.created : undefined,
        }));
    };
}

export function defineRSSHubSource(
    route: string,
    RSSHubOptions?: RSSHubOption,
    sourceOption?: SourceOption
): SourceGetter {
    return async () => {
        // "https://rsshub.pseudoyu.com"
        const RSSHubBase = "https://rsshub.rssforever.com";
        const url = new URL(route, RSSHubBase);
        url.searchParams.set("format", "json");
        RSSHubOptions = defu<RSSHubOption, RSSHubOption[]>(RSSHubOptions, {
            sorted: true,
        });

        Object.entries(RSSHubOptions).forEach(([key, value]) => {
            url.searchParams.set(key, value.toString());
        });
        // @ts-ignore
        const data: RSSHubResponse = await myFetch(url);
        return data.items.map((item) => ({
            title: item.title,
            url: item.url,
            id: item.id ?? item.url,
            pubDate: !sourceOption?.hiddenDate ? item.date_published : undefined,
        }));
    };
}

export function proxySource(proxyUrl: string, source: SourceGetter) {
    return process.env.CF_PAGES
        ? defineSource(async () => {
              const data = await myFetch(proxyUrl);
              // @ts-ignore
              return data.items;
          })
        : source;
}
