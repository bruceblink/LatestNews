import type { NewsItem, SourceID } from "@shared/types";

export interface RSSInfo {
    title: string;
    description: string;
    link: string;
    image: string;
    updatedTime: string;
    items: RSSItem[];
}
export interface RSSItem {
    title: string;
    description: string;
    link: string;
    created?: string;
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
    email?: string | null;
    username?: string | null;
    password?: string | null;
    display_name?: string | null;
    avatar_url?: string | null;
    type?: string | null; // 原来固定 github，现在可动态
    data?: any; // JSON 对象或字符串
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

export interface UserDTO {
    provide_id?: string | null;
    email?: string | null;
    username: string;
    password?: string | null;
    display_name?: string | null;
    avatar_url?: string | null;
    type: string; //原来固定 github，现在可动态
    data?: any; // JSON 对象或字符串
}
