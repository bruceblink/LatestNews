import { defineConfig } from "vite";
import dotenvFlow from "dotenv-flow";

import initVoteNitro from "./vite-nitro.js";
import { resolveAppTitle } from "./shared/app-title.js";
import {
    rendererAliases,
    createRendererPlugins,
    createRendererDefines,
    createRendererBuildConfig,
    createRendererServerConfig,
} from "./vite.renderer.js";

// 自动按 .env、.env.local、.env.development 等文件顺序加载
dotenvFlow.config({
    path: import.meta.dirname,
});

const appTitle = resolveAppTitle(process.env.VITE_APP_TITLE);
// Keep the static PWA build independent from Nitro so its index.html can be served by the Web E2E harness.
const useStaticWebBuild = process.env.LATESTNEWS_WEB_STATIC_BUILD === "true";

export default defineConfig(async ({ command, isPreview }) => {
    const isDev = command === "serve" && !isPreview;
    if (isDev) {
        // Generate local metadata before UnoCSS and Nitro load it, without a separate process or icon downloads.
        const { generateSourceFiles } = await import("./tools/generate-sources.js");
        generateSourceFiles();
    }

    return {
        resolve: {
            alias: rendererAliases,
        },
        define: createRendererDefines(appTitle),
        plugins: [...createRendererPlugins("web", appTitle), ...(useStaticWebBuild ? [] : [initVoteNitro()])],
        build: createRendererBuildConfig(),
        server: createRendererServerConfig(),
    };
});
