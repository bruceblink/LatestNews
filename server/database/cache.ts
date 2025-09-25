import type { NewsItem } from "@shared/types";
import type { Prisma } from "@root/generated/prisma";

import prisma from "#/lib/prisma.ts";

export class Cache {
    constructor() {}

    async init() {
        logger.success("cache table is ready (via Prisma)");
    }

    async set(key: string, value: NewsItem[]) {
        await prisma.cache.upsert({
            where: { id: key },
            update: { data: value as unknown as Prisma.InputJsonValue, updated_at: new Date() },
            create: { id: key, data: value as unknown as Prisma.InputJsonValue, updated_at: new Date() },
        });
        logger.success(`set ${key} cache`);
    }

    async get(key: string) {
        const row = await prisma.cache.findUnique({ where: { id: key } });
        if (!row) return undefined;
        logger.success(`get ${key} cache`);
        return { id: row.id, updated: row.updated_at.getTime(), items: row.data as unknown as NewsItem[] };
    }

    async getEntire(keys: string[]) {
        const rows = await prisma.cache.findMany({ where: { id: { in: keys } } });
        if (!rows.length) return [];
        logger.success("get entire (...) cache");
        // @ts-ignore
        return rows.map((row) => ({
            id: row.id,
            updated: row.updated_at.getTime(),
            items: row.data as unknown as NewsItem[],
        }));
    }

    async delete(key: string) {
        return prisma.cache.delete({ where: { id: key } });
    }
}

let cacheTable: Cache | undefined;

export async function getCacheTable(): Promise<Cache | undefined> {
    if (process.env.ENABLE_CACHE === "false") return undefined;
    if (!cacheTable) {
        cacheTable = new Cache();
        if (process.env.INIT_TABLE !== "false") await cacheTable.init();
    }
    return cacheTable;
}
