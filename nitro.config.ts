import process from "node:process";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import viteNitro from "vite-plugin-with-nitro";

import { projectDir } from "./shared/dir";
import { RollopGlob } from "./tools/rollup-glob";

const useNodeRuntime = !process.env.CF_PAGES && !process.env.VERCEL;
const require = createRequire(import.meta.url);
const pluginRendererPath = join(dirname(require.resolve("vite-plugin-with-nitro")), "runtime/renderer.mjs").replaceAll(
    "\\",
    "/"
);
const pluginRendererUrl = `file:///${pluginRendererPath}`;
const localRendererPath = join(projectDir, "server/renderer.ts");

const nitroOption: NonNullable<Parameters<typeof viteNitro>[0]> = {
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
        "#/utils/crawler-plugin-runtime": join(
            projectDir,
            useNodeRuntime ? "server/crawler-plugin-runtime.node.ts" : "server/crawler-plugin-runtime.pages.ts"
        ),
        // The plugin emits an absolute renderer URL; keep the fallback in this repository so it can be bundled.
        [pluginRendererPath]: localRendererPath,
        [pluginRendererUrl]: localRendererPath,
    },

    ...(useNodeRuntime
        ? {
              renderer: localRendererPath,
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
    const nitroPlugin = viteNitro(nitroOption);

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
