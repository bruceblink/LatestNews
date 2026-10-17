import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

import { normalizeServiceUrl } from "./electron/api-proxy";
import {
    rendererAliases,
    createRendererPlugins,
    createRendererBuildConfig,
    createRendererServerConfig,
} from "./vite.renderer";

const projectRoot = import.meta.dirname;
const isDevelopment = process.env.NODE_ENV !== "production";
const allowLocalHttp = isDevelopment;
const newsApiUrl = normalizeServiceUrl(process.env.LATESTNEWS_DESKTOP_API_URL ?? "https://news.likanug.top", {
    allowLocalHttp,
});
const authApiUrl = normalizeServiceUrl(process.env.LATESTNEWS_DESKTOP_AUTH_API_URL ?? "https://api.likanug.top", {
    allowLocalHttp,
});
const authCallbackUrl = new URL(
    process.env.LATESTNEWS_DESKTOP_AUTH_CALLBACK_URL ?? "https://news.likanug.top/auth/callback"
);
if (authCallbackUrl.protocol !== "https:" || authCallbackUrl.username || authCallbackUrl.password) {
    throw new Error("LATESTNEWS_DESKTOP_AUTH_CALLBACK_URL must be HTTPS and must not contain credentials.");
}

const electronPwaAdapter = resolve(projectRoot, "src/platform/electron/pwa-register.ts");

const disableWebAnalytics = {
    name: "latestnews-electron-disable-web-analytics",
    transformIndexHtml: {
        order: "pre" as const,
        handler(html: string) {
            return html.replace(/\s*<!-- Google Analytics -->[\s\S]*?(?=\s*<title>)/, "\n");
        },
    },
};

const appProtocolBase = {
    name: "latestnews-electron-app-protocol-base",
    enforce: "post" as const,
    config: () => ({ base: "/" }),
};

export default defineConfig({
    main: {
        define: {
            __LATESTNEWS_DESKTOP_API_URL__: JSON.stringify(newsApiUrl.href),
            __LATESTNEWS_DESKTOP_AUTH_API_URL__: JSON.stringify(authApiUrl.href),
            __LATESTNEWS_DESKTOP_AUTH_CALLBACK_URL__: JSON.stringify(authCallbackUrl.href),
        },
        build: {
            outDir: resolve(projectRoot, "out/main"),
            lib: {
                entry: resolve(projectRoot, "electron/main.ts"),
                formats: ["cjs"],
                fileName: "index.cjs",
            },
        },
    },
    preload: {
        build: {
            outDir: resolve(projectRoot, "out/preload"),
            lib: {
                entry: resolve(projectRoot, "electron/preload.ts"),
                formats: ["cjs"],
                fileName: "index.cjs",
            },
        },
    },
    renderer: {
        root: projectRoot,
        envDir: projectRoot,
        publicDir: resolve(projectRoot, "public"),
        base: "/",
        resolve: {
            alias: [
                ...Object.entries(rendererAliases).map(([find, replacement]) => ({ find, replacement })),
                { find: "virtual:pwa-register/react", replacement: electronPwaAdapter },
            ],
        },
        define: {
            "import.meta.env.LATESTNEWS_DESKTOP": "true",
            "import.meta.env.VITE_API_URL": JSON.stringify("app://bundle/__auth-api__"),
        },
        plugins: [...createRendererPlugins("electron"), disableWebAnalytics, appProtocolBase],
        server: {
            ...createRendererServerConfig(),
            host: "127.0.0.1",
            port: 5174,
            strictPort: true,
            proxy: {
                "/api": {
                    target: newsApiUrl.origin,
                    changeOrigin: true,
                    secure: newsApiUrl.protocol === "https:",
                },
            },
        },
        build: {
            ...createRendererBuildConfig(),
            outDir: resolve(projectRoot, "out/renderer"),
            emptyOutDir: true,
            rollupOptions: {
                ...createRendererBuildConfig()?.rollupOptions,
                input: resolve(projectRoot, "index.html"),
            },
        },
    },
});
