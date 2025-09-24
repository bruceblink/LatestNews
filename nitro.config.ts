import { join } from "node:path";
import process from "node:process";
import viteNitro from "vite-plugin-with-nitro";

import { projectDir } from "./shared/dir";
import { RollopGlob } from "./tools/rollup-glob";

const nitroOption: Parameters<typeof viteNitro>[0] = {
    experimental: {
        database: true,
    },
    rollupConfig: {
        plugins: [RollopGlob()] as any,
    },
    sourceMap: false,
    database: {
        default: {
            connector: "better-sqlite3",
        },
    },
    devDatabase: {
        default: {
            connector: "better-sqlite3",
        },
    },
    imports: {
        dirs: ["server/utils", "shared"],
    },
    preset: "node-server",
    alias: {
        "@shared": join(projectDir, "shared"),
        "#": join(projectDir, "server"),
        // 默认使用 node_modules 下的 Prisma Client
        "@prisma/client": join(projectDir, "node_modules/@prisma/client"),
    },
};

// 确保 alias 存在
if (!nitroOption.alias) nitroOption.alias = {};

// 本地开发使用生成的 Prisma Client
if (!process.env.VERCEL && !process.env.CF_PAGES) {
    nitroOption.alias["@prisma/client"] = join(projectDir, "./generated/prisma/client");
} else {
    // Vercel / Cloudflare 构建用 node_modules 下的 Prisma Client
    nitroOption.alias["@prisma/client"] = join(projectDir, "node_modules/@prisma/client");
}

// Vercel 特有配置
if (process.env.VERCEL) {
    nitroOption.preset = "vercel-edge";
    nitroOption.database = undefined;
}
// Cloudflare Pages 特有配置
else if (process.env.CF_PAGES) {
    nitroOption.preset = "cloudflare-pages";
    nitroOption.unenv = {
        alias: {
            "safer-buffer": "node:buffer",
        },
    };
    nitroOption.database = {
        default: {
            connector: "cloudflare-d1",
            options: {
                bindingName: "NEWSNOW_DB",
            },
        },
    };
}
// Bun 环境
else if (process.env.BUN) {
    nitroOption.preset = "bun";
    nitroOption.database = {
        default: {
            connector: "bun-sqlite",
        },
    };
}

export default function initVoteNitro() {
    return viteNitro(nitroOption);
}
