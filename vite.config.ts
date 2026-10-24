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

export default defineConfig({
    resolve: {
        alias: rendererAliases,
    },
    define: createRendererDefines(appTitle),
    plugins: [...createRendererPlugins("web", appTitle), initVoteNitro()],
    build: createRendererBuildConfig(),
    server: createRendererServerConfig(),
});
