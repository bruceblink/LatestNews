import type { VitePWAOptions } from "vite-plugin-pwa";

import process from "node:process";
import { VitePWA } from "vite-plugin-pwa";

const APP_TITLE = process.env.VITE_APP_TITLE || "LatestNews";

const pwaOption: Partial<VitePWAOptions> = {
    includeAssets: ["icon.svg", "apple-touch-icon.png"],
    filename: "swx.js",
    manifest: {
        name: `${APP_TITLE}`,
        short_name: `${APP_TITLE}`,
        description: "Elegant reading of real-time and hottest news",
        theme_color: "#F14D42",
        icons: [
            {
                src: "pwa-192x192.png",
                sizes: "192x192",
                type: "image/png",
            },
            {
                src: "pwa-512x512.png",
                sizes: "512x512",
                type: "image/png",
            },
            {
                src: "pwa-512x512.png",
                sizes: "512x512",
                type: "image/png",
                purpose: "any",
            },
            {
                src: "pwa-512x512.png",
                sizes: "512x512",
                type: "image/png",
                purpose: "maskable",
            },
        ],
    },
    workbox: {
        navigateFallbackDenylist: [/^\/api/],
    },
    devOptions: {
        enabled: process.env.SW_DEV === "true",
        type: "module",
        navigateFallback: "index.html",
    },
};

export default function pwa() {
    return VitePWA(pwaOption);
}
