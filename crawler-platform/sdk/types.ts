import type { CrawlerPluginManifest } from "./manifest";

export type CrawlerSourceKey = `${string}/${string}`;
export type CrawlerHttpMethod = "GET" | "HEAD" | "POST";
export type CrawlerTarget = "node" | "electron";

export interface CrawlerItem {
    id: string | number;
    title: string;
    url: string;
    mobileUrl?: string;
    publishedAt?: number | string;
}

export interface CrawlerHttpRequest {
    url: string;
    method?: CrawlerHttpMethod;
    headers?: Readonly<Record<string, string>>;
    body?: string;
}

export interface CrawlerHttpResponse {
    status: number;
    headers: Readonly<Record<string, string>>;
    body: string;
}

export interface CrawlerContext {
    signal: AbortSignal;
    now(): number;
    http: {
        request(request: CrawlerHttpRequest): Promise<CrawlerHttpResponse>;
    };
}

export interface CrawlerRequest {
    sourceId: string;
    parameters?: unknown;
}

export interface CrawlerPluginImplementation {
    collect(context: CrawlerContext, request: CrawlerRequest): Promise<unknown>;
}

export interface CrawlerPlugin {
    manifest: CrawlerPluginManifest;
    collect: CrawlerPluginImplementation["collect"];
}

export interface CrawlerSourceDescriptor {
    key: CrawlerSourceKey;
    pluginId: string;
    pluginVersion: string;
    id: string;
    name: string;
    kind: "timeline" | "hottest" | "realtime";
    refreshIntervalSeconds: number;
    targets: readonly CrawlerTarget[];
}
