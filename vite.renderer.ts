import type { UserConfig, PluginOption } from "vite";

import unocss from "unocss/vite";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react-swc";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

import pwa from "./pwa.config";
import initVoteNitro from "./nitro.config";

export type RendererPlatform = "web" | "electron";

export const rendererAliases = {
    "@root": fileURLToPath(new URL("./", import.meta.url)),
    "~": fileURLToPath(new URL("./src", import.meta.url)),
    "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
};

/** Keep route generation, styling, and React transforms identical for both renderers. */
export function createRendererPlugins(platform: RendererPlatform): PluginOption[] {
    const plugins: PluginOption[] = [
        TanStackRouterVite({
            // error with auto import and vite-plugin-pwa
            // autoCodeSplitting: true,
        }),
        unocss(),
        react(),
    ];

    if (platform === "web") plugins.push(pwa(), initVoteNitro());

    return plugins;
}

export function createRendererBuildConfig(): UserConfig["build"] {
    return {
        target: "es2022",
        chunkSizeWarningLimit: 1000,
        rollupOptions: {
            output: {
                manualChunks: {
                    router: ["@tanstack/react-router"],
                    query: ["@tanstack/react-query"],
                    motion: ["framer-motion"],
                    utils: ["dayjs", "clsx", "ofetch"],
                },
            },
        },
    };
}

/** Prevent generated desktop and production files from triggering development reloads. */
export function createRendererServerConfig(): UserConfig["server"] {
    return {
        watch: {
            ignored: ["**/dist/**", "**/out/**", "**/release/**"],
        },
    };
}
