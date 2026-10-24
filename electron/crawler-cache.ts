import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { rm, stat, mkdir, rename, readFile, writeFile } from "node:fs/promises";

import type { NewsItem } from "../shared/types";

const CACHE_VERSION = 1;
const MAX_SOURCE_ID_LENGTH = 128;

export interface CrawlerCacheOptions {
    path: string;
    maxSources?: number;
    maxItemsPerSource?: number;
    maxFileBytes?: number;
}

export interface CrawlerCacheEntry {
    updatedTime: number;
    items: NewsItem[];
}

interface CrawlerCacheFile {
    version: typeof CACHE_VERSION;
    entries: Record<string, CrawlerCacheEntry>;
}

/** Stores only normalized items from trusted desktop crawler packages. */
export class CrawlerCacheStore {
    private readonly maxSources: number;
    private readonly maxItemsPerSource: number;
    private readonly maxFileBytes: number;
    private entries = new Map<string, CrawlerCacheEntry>();
    private loadPromise: Promise<void> | undefined;
    private writeQueue = Promise.resolve();

    constructor(private readonly options: CrawlerCacheOptions) {
        this.maxSources = options.maxSources ?? 64;
        this.maxItemsPerSource = options.maxItemsPerSource ?? 100;
        this.maxFileBytes = options.maxFileBytes ?? 2 * 1024 * 1024;
    }

    async read(sourceId: string): Promise<CrawlerCacheEntry | undefined> {
        if (!isSafeSourceId(sourceId)) return undefined;
        await this.ensureLoaded();
        const entry = this.entries.get(sourceId);
        return entry ? { updatedTime: entry.updatedTime, items: [...entry.items] } : undefined;
    }

    async write(sourceId: string, items: NewsItem[], updatedTime = Date.now()): Promise<void> {
        if (!isSafeSourceId(sourceId) || items.length === 0) return;
        await this.ensureLoaded();
        const safeItems = items.filter(isNewsItem).slice(0, this.maxItemsPerSource);
        if (safeItems.length === 0) return;
        this.entries.set(sourceId, { updatedTime, items: safeItems });
        this.pruneEntries();
        const payload = this.serialize();
        this.writeQueue = this.writeQueue
            .catch(() => undefined)
            .then(() => writeAtomically(this.options.path, payload));
        await this.writeQueue;
    }

    private ensureLoaded() {
        this.loadPromise ??= this.load();
        return this.loadPromise;
    }

    private async load() {
        try {
            const info = await stat(this.options.path);
            if (!info.isFile() || info.size > this.maxFileBytes) return;
            const parsed: unknown = JSON.parse(await readFile(this.options.path, "utf8"));
            if (!isCacheFile(parsed)) return;
            const entries: Array<[string, CrawlerCacheEntry]> = [];
            for (const [sourceId, candidate] of Object.entries(parsed.entries)) {
                if (!isSafeSourceId(sourceId) || !isCacheEntry(candidate)) continue;
                const items = candidate.items.filter(isNewsItem).slice(0, this.maxItemsPerSource);
                if (items.length > 0) entries.push([sourceId, { updatedTime: candidate.updatedTime, items }]);
            }
            this.entries = new Map(entries);
            this.pruneEntries();
        } catch {
            this.entries.clear();
        }
    }

    private pruneEntries() {
        const ordered = [...this.entries.entries()].sort((left, right) => right[1].updatedTime - left[1].updatedTime);
        this.entries = new Map(ordered.slice(0, this.maxSources));
    }

    private serialize() {
        while (this.entries.size > 0) {
            const payload: CrawlerCacheFile = {
                version: CACHE_VERSION,
                entries: Object.fromEntries(this.entries),
            };
            const serialized = JSON.stringify(payload) + "\n";
            if (Buffer.byteLength(serialized, "utf8") <= this.maxFileBytes) return serialized;

            const oldest = [...this.entries.entries()].sort(
                (left, right) => left[1].updatedTime - right[1].updatedTime
            )[0];
            if (!oldest) break;
            this.entries.delete(oldest[0]);
        }
        throw new Error("Crawler cache exceeds its file size limit.");
    }
}

async function writeAtomically(path: string, payload: string) {
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = path + "." + randomUUID() + ".tmp";
    try {
        await writeFile(temporaryPath, payload, { encoding: "utf8", flag: "wx", mode: 0o600 });
        await rename(temporaryPath, path);
    } finally {
        await rm(temporaryPath, { force: true });
    }
}

function isCacheFile(value: unknown): value is CrawlerCacheFile {
    if (!value || typeof value !== "object") return false;
    const candidate = value as { version?: unknown; entries?: unknown };
    return (
        candidate.version === CACHE_VERSION &&
        Boolean(candidate.entries) &&
        typeof candidate.entries === "object" &&
        !Array.isArray(candidate.entries)
    );
}

function isCacheEntry(value: unknown): value is CrawlerCacheEntry {
    if (!value || typeof value !== "object") return false;
    const candidate = value as { updatedTime?: unknown; items?: unknown };
    return (
        typeof candidate.updatedTime === "number" &&
        Number.isFinite(candidate.updatedTime) &&
        Array.isArray(candidate.items)
    );
}

function isSafeSourceId(value: string) {
    return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && value.length <= MAX_SOURCE_ID_LENGTH;
}

function isNewsItem(value: unknown): value is NewsItem {
    if (!value || typeof value !== "object") return false;
    const item = value as Partial<NewsItem>;
    return (
        (typeof item.id === "string" || typeof item.id === "number") &&
        typeof item.title === "string" &&
        typeof item.url === "string"
    );
}
