import { join } from "node:path";
import { defineConfig } from "vite";
import dotenvFlow from "dotenv-flow";

import initVoteNitro from "./nitro.config";
import { resolveAppTitle } from "./shared/app-title";
import {
    rendererAliases,
    createRendererPlugins,
    createRendererDefines,
    createRendererBuildConfig,
    createRendererServerConfig,
} from "./vite.renderer";

// 自动按 .env、.env.local、.env.development 等文件顺序加载
dotenvFlow.config({
    path: join(__dirname),
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
