import type { UserInfo } from "#/types";
import type { Prisma } from "@root/generated/prisma";

import prisma from "#/lib/prisma";
import { logger } from "#/utils/logger";

export class UserTable {
    constructor() {}

    /** 初始化表（Prisma 会自动管理，不需要手动建表） */
    async init() {
        // Prisma 使用 migrate，无需手动建表
        logger.success("Prisma user table ready");
    }

    /** 新增或更新用户 */
    async addUser(id: string, email: string, type: string = "github") {
        const existing = await prisma.user_info.findUnique({
            where: { id: BigInt(id) },
        });

        const now = new Date();

        if (!existing) {
            await prisma.user_info.create({
                data: {
                    id: BigInt(id),
                    email,
                    type,
                    data: {}, // 默认空 JSON
                    created_at: now,
                    updated_at: now,
                },
            });
            logger.success(`add user ${id}`);
        } else if (existing.email !== email || existing.type !== type) {
            await prisma.user_info.update({
                where: { id: BigInt(id) },
                data: {
                    email,
                    type,
                    updated_at: now,
                },
            });
            logger.success(`update user ${id} email/type`);
        } else {
            logger.info(`user ${id} already exists`);
        }
    }

    /** 根据 id 获取用户 */
    async getUser(id: string): Promise<UserInfo | null> {
        const user = await prisma.user_info.findUnique({
            where: { id: BigInt(id) },
        });

        if (!user) return null;

        return {
            id: user.id.toString(),
            email: user.email,
            username: user.username,
            password: user.password,
            display_name: user.display_name,
            avatar_url: user.avatar_url,
            type: user.type,
            data: user.data,
            created: Number(user.created_at),
            updated: Number(user.updated_at),
        };
    }

    /** 设置用户 data 字段 */
    async setData(key: string, value: any) {
        const user = await prisma.user_info.update({
            where: { id: BigInt(key) },
            data: {
                data: value as unknown as Prisma.InputJsonValue,
                updated_at: new Date(),
            },
        });
        logger.success(`set data for user ${key}`);
        return user;
    }

    /** 获取用户 data 字段 */
    async getData(id: string): Promise<{ data: any; updated: number }> {
        const user = await prisma.user_info.findUnique({
            where: { id: BigInt(id) },
            select: { data: true, updated_at: true },
        });
        if (!user) throw new Error(`user ${id} not found`);

        return {
            data: user.data,
            updated: Number(user.updated_at),
        };
    }

    /** 删除用户 */
    async deleteUser(key: string) {
        await prisma.user_info.delete({ where: { id: BigInt(key) } });
        logger.success(`delete user ${key}`);
    }
}

let userTableSingleton: UserTable | null = null;

/**
 *  UserTable的单例实现
 */
export default function getUserTable() {
    if (!userTableSingleton) {
        userTableSingleton = new UserTable();
    }
    return userTableSingleton;
}
