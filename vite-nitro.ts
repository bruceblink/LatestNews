import { join } from "node:path";
import process from "node:process";
import { nitro } from "nitro/vite";

import { projectDir } from "./shared/dir.js";
import { RollopGlob } from "./tools/rollup-glob.js";

const useNodeRuntime = !process.env.CF_PAGES && !process.env.VERCEL;
const localRendererPath = join(projectDir, "server/renderer.ts");

const nitroOption: NonNullable<Parameters<typeof nitro>[0]> = {
    // Day.js ESM uses extensionless imports; compile it to preserve the patched duration behavior in Node.
    noExternals: ["dayjs"],

    experimental: {
        database: true,
    },

    rolldownConfig: {
        plugins: [RollopGlob()] as any,
    },

    sourcemap: false,

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

    preset: "node-server",

    serverDir: "./server",

    alias: {
        "@shared": join(projectDir, "shared"),
        "#": join(projectDir, "server"),
        "#/utils/crawler-plugin-runtime": join(
            projectDir,
            useNodeRuntime ? "server/crawler-plugin-runtime.node.ts" : "server/crawler-plugin-runtime.pages.ts"
        ),
    },

    ...(useNodeRuntime
        ? {
              renderer: { handler: localRendererPath, template: join(projectDir, "index.html") },
              output: {
                  dir: join(projectDir, "dist/output"),
                  serverDir: join(projectDir, "dist/output/server"),
                  publicDir: join(projectDir, "dist/output/public"),
              },
              // Nitro's Node asset reader is relative to the server entry module.
              inlineDynamicImports: true,
          }
        : {}),
};

if (process.env.VERCEL) {
    nitroOption.preset = "vercel-edge";
    nitroOption.database = undefined;
} else if (process.env.CF_PAGES) {
    nitroOption.preset = "cloudflare-pages";
    // Sources only parse HTML strings. The Node entry also loads Undici, which
    // reads process.versions.node during initialization and fails in Workers.
    nitroOption.alias = {
        ...nitroOption.alias,
        cheerio: join(projectDir, "node_modules/cheerio/dist/browser/index.js"),
    };

    // The Pages preset defaults to a modular worker. Its chunks import back into the
    // entry module, which current Wrangler versions cannot resolve at build time. Its
    // preset output config overrides the top-level switch, so set the output explicitly.
    // Keep the Pages worker self-contained; this does not affect the Node/Docker build.
    nitroOption.rollupConfig = {
        output: {
            inlineDynamicImports: true,
        },
    };

    // ⭐ 修复 node builtin
    nitroOption.unenv = {
        alias: {
            "node:buffer": "buffer",
        },
    };

    nitroOption.database = {
        default: {
            connector: "cloudflare-d1",
            options: {
                bindingName: "LATESTNEWS_DB",
            },
        },
    };
} else if (process.env.BUN) {
    nitroOption.preset = "bun";

    nitroOption.database = {
        default: {
            connector: "bun-sqlite",
        },
    };
}

export default function initVoteNitro() {
    const nitroPlugin = nitro(nitroOption);

    return [
        {
            name: "latestnews-nitro-dev-renderer",
            enforce: "pre" as const,
            config(_viteConfig: unknown, { command }: { command: string }) {
                // Vite serves the development SPA shell itself; Nitro's production HTML alias does not exist in dev.
                if (command === "serve" && useNodeRuntime) nitroOption.renderer = undefined;
            },
        },
        nitroPlugin,
    ];
}
