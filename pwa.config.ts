import type { VitePWAOptions } from "vite-plugin-pwa";

import process from "node:process";
import { VitePWA } from "vite-plugin-pwa";

export default function pwa(appTitle: string) {
    const pwaOption: Partial<VitePWAOptions> = {
        includeAssets: ["icon.svg", "apple-touch-icon.png"],
        filename: "swx.js",
        manifest: {
            name: appTitle,
            short_name: appTitle,
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

    return VitePWA(pwaOption);
}
