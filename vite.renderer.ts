import type { UserConfig, PluginOption } from "vite";

import unocss from "unocss/vite";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react-swc";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

import pwa from "./pwa.config";
import { escapeHtmlText } from "./shared/app-title";

export type RendererPlatform = "web" | "electron";

export const rendererAliases = {
    "@root": fileURLToPath(new URL("./", import.meta.url)),
    "~": fileURLToPath(new URL("./src", import.meta.url)),
    "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
};

/** Keep route generation, styling, app title and React transforms identical across renderers. */
export function createRendererPlugins(platform: RendererPlatform, appTitle: string): PluginOption[] {
    const plugins: PluginOption[] = [
        {
            name: "latestnews-renderer-app-title",
            transformIndexHtml: {
                order: "pre",
                handler(html) {
                    return html.replaceAll("%VITE_APP_TITLE%", escapeHtmlText(appTitle));
                },
            },
        },
        TanStackRouterVite({
            autoCodeSplitting: true,
        }),
        unocss(),
        react(),
    ];

    if (platform === "web") plugins.push(pwa(appTitle));

    return plugins;
}

export function createRendererDefines(appTitle: string): UserConfig["define"] {
    return { "import.meta.env.VITE_APP_TITLE": JSON.stringify(appTitle) };
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
