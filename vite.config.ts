import { join } from "node:path";
import unocss from "unocss/vite";
import { defineConfig } from "vite";
import dotenvFlow from "dotenv-flow";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react-swc";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

import pwa from "./pwa.config";
import initVoteNitro from "./nitro.config";

// 自动按 .env、.env.local、.env.development 等文件顺序加载
dotenvFlow.config({
    path: join(__dirname),
});

export default defineConfig({
    resolve: {
        alias: {
            "@root": fileURLToPath(new URL("./", import.meta.url)),
            "~": fileURLToPath(new URL("./src", import.meta.url)),
            "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
        },
    },
    plugins: [
        TanStackRouterVite({
            // error with auto import and vite-plugin-pwa
            // autoCodeSplitting: true,
        }),
        unocss(),
        react(),
        pwa(),
        initVoteNitro(),
    ],
});
