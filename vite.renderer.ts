import type { UserConfig, PluginOption } from "vite";

import unocss from "unocss/vite";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react-swc";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

import pwa from "./pwa.config.js";
import { escapeHtmlText } from "./shared/app-title.js";

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
                codeSplitting: {
                    groups: [
                        { name: "router", test: /[\\/]node_modules[\\/]@tanstack[\\/]react-router(?:[\\/]|$)/ },
                        { name: "query", test: /[\\/]node_modules[\\/]@tanstack[\\/]react-query(?:[\\/]|$)/ },
                        { name: "motion", test: /[\\/]node_modules[\\/]framer-motion(?:[\\/]|$)/ },
                        { name: "utils", test: /[\\/]node_modules[\\/](?:dayjs|clsx|ofetch)(?:[\\/]|$)/ },
                    ],
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
