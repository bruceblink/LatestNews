import type { UserDTO, UserInfo } from "#/types";
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
    async addUser(user: UserDTO) {
        const now = new Date();

        if (!user.username || !user.type) {
            throw new Error("username and type are required for upsert");
        }

        const newUser = await prisma.user_info.upsert({
            where: {
                username: user.username, // 这里假设 username 唯一
                type: user.type,
            },
            update: {
                ...user,
                updated_at: now,
            },
            create: {
                ...user,
                created_at: now,
                updated_at: now,
            },
        });

        logger.success(`upsert user ${newUser.id}`);
        return newUser.id;
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
    async setData(type: string, provide_id: string, value: any) {
        const user = await prisma.user_info.update({
            where: { type_provide_id: { type, provide_id } },
            data: {
                data: value as Prisma.InputJsonValue,
                updated_at: new Date(),
            },
        });
        logger.success(`set data for user ${provide_id} on ${type}`);
        return user;
    }

    /** 获取用户 data 字段 */
    async getData(type: string, provide_id: string | number) {
        const user = await prisma.user_info.findUnique({
            where: {
                type_provide_id: {
                    type,
                    provide_id: String(provide_id),
                },
            },
            select: { data: true, updated_at: true },
        });
        if (!user) throw new Error(`user ${provide_id} not found`);

        return { data: user.data, updated: Number(user.updated_at) };
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
