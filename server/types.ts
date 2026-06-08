import type { NewsItem, SourceID } from "@shared/types";

export interface RSSInfo {
    title: string;
    description: string;
    link: string;
    image: string;
    category: unknown[];
    updatedTime: string;
    items: RSSItem[];
}
export interface RSSItem {
    [key: string]: unknown;
    id?: string;
    title: string;
    description: string;
    link: string;
    author?: string;
    created?: string;
    category?: unknown[];
    content?: string;
    enclosures?: unknown[];
    media?: Record<string, unknown>;
}

export interface CacheInfo {
    id: SourceID;
    items: NewsItem[];
    updated: number;
}

export interface CacheRow {
    id: SourceID;
    data: string;
    updated: number;
}

export interface RSSHubInfo {
    title: string;
    home_page_url: string;
    description: string;
    items: RSSHubItem[];
}

export interface RSSHubItem {
    id: string;
    url: string;
    title: string;
    content_html: string;
    date_published: string;
}

export interface UserInfo {
    id: string;
    email: string;
    type: "github";
    data: string;
    created: number;
    updated: number;
}

export interface RSSHubOption {
    // default: true
    sorted?: boolean;
    // default: 20
    limit?: number;
}

export interface SourceOption {
    // default: false
    hiddenDate?: boolean;
}

export type SourceGetter = () => Promise<NewsItem[]>;
