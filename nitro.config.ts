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
    },
};

if (process.env.VERCEL) {
    nitroOption.preset = "vercel-edge";
    // You can use other online database, do it yourself. For more info: https://db0.unjs.io/connectors
    nitroOption.database = undefined;
    // nitroOption.vercel = {
    //   config: {
    //     cache: []
    //   },
    // }
} else if (process.env.CF_PAGES) {
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
} else if (process.env.BUN) {
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
