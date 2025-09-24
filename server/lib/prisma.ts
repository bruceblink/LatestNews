import pkg from "@prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";

// @ts-ignore
const { PrismaClient } = pkg;

// 实例类型
type PrismaBase = InstanceType<typeof PrismaClient>;

// Prisma + Accelerate 类型
export type PrismaAccelerate = PrismaBase & ReturnType<typeof withAccelerate>;

// 单例工厂
const prismaClientSingleton = (): PrismaAccelerate => {
    const client = new PrismaClient();
    return client.$extends(withAccelerate()) as unknown as PrismaAccelerate;
};

// 全局变量保持单例
declare global {
    var prismaGlobal: PrismaAccelerate | undefined;
}

export const prisma: PrismaAccelerate = globalThis.prismaGlobal ?? prismaClientSingleton();

if (process.env.NODE_ENV !== "production") {
    globalThis.prismaGlobal = prisma;
}

export default prisma;
