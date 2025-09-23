import { PrismaClient } from "@prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";

/**
 * 明确的交叉类型：
 *  - PrismaClient: 保证有 $on/$connect/$disconnect 等标准成员（避免 TS2742/TS2322 问题）
 *  - ReturnType<typeof withAccelerate>: 保留 accelerate 扩展可能添加的额外类型
 */
type PrismaAccelerate = PrismaClient & ReturnType<typeof withAccelerate>;

/** 构造并断言为我们明确的类型 */
const prismaClientSingleton = (): PrismaAccelerate => {
  // TS 在这里推导的类型会非常复杂且引用到 pnpm 内部路径，故先 as unknown 再断言为我们定义的稳定类型
  return new PrismaClient().$extends(withAccelerate()) as unknown as PrismaAccelerate;
};

type PrismaType = PrismaAccelerate;

declare const globalThis: {
  prismaGlobal?: PrismaType;
} & typeof global;

const prisma: PrismaType = globalThis.prismaGlobal ?? prismaClientSingleton();

if (process.env.NODE_ENV !== "production") {
  globalThis.prismaGlobal = prisma;
}

export default prisma;
