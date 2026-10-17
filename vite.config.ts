import { join } from "node:path";
import { defineConfig } from "vite";
import dotenvFlow from "dotenv-flow";

import {
    rendererAliases,
    createRendererPlugins,
    createRendererBuildConfig,
    createRendererServerConfig,
} from "./vite.renderer";

// 自动按 .env、.env.local、.env.development 等文件顺序加载
dotenvFlow.config({
    path: join(__dirname),
});

export default defineConfig({
    resolve: {
        alias: rendererAliases,
    },
    plugins: createRendererPlugins("web"),
    build: createRendererBuildConfig(),
    server: createRendererServerConfig(),
});
